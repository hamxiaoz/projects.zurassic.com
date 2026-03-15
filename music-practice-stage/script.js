// Webcam setup
const video = document.getElementById('webcam');
const camMsg = document.getElementById('camMsg');
const camToggle = document.getElementById('camToggle');
const calibrateBtn = document.getElementById('calibrateBtn');
const camExperimentsGroup = document.getElementById('camExperimentsGroup');
const puffBanner = document.getElementById('puffBanner');
const calibrationOverlay = document.getElementById('calibrationOverlay');
let camStream = null;
let camOn = false;

function startCamera() {
  const constraints = { video: true, audio: false };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      camStream = stream;
      video.srcObject = stream;
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.play().catch(() => {});
      camMsg.style.display = 'none';
      video.style.display = '';
      camToggle.textContent = 'Stop Camera';
      camOn = true;
      camExperimentsGroup.style.display = '';
      initFaceMesh();
    })
    .catch(() => {
      camMsg.textContent = 'Camera not available';
      camMsg.style.display = '';
    });
}

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  video.srcObject = null;
  video.style.display = 'none';
  camMsg.textContent = 'Start your camera to see yourself in the mirror';
  camMsg.style.display = '';
  camToggle.textContent = 'Start Camera';
  camOn = false;
  camExperimentsGroup.style.display = 'none';
  meshCanvas.style.display = 'none';
  showMesh = false;
  puffBanner.style.display = 'none';
}

camToggle.addEventListener('click', () => {
  if (camOn) stopCamera(); else startCamera();
});

// --- Cheek Puff Detection via MediaPipe Face Mesh ---
const meshCanvas = document.getElementById('meshCanvas');
const meshCtx = meshCanvas.getContext('2d');
const meshToggle = document.getElementById('meshToggle');
let showMesh = false;
let faceLandmarker = null;
let faceMeshReady = false;
let faceMeshLoading = false;
let calibrating = false;
let puffThreshold = localStorage.getItem('puffThreshold') ? Number(localStorage.getItem('puffThreshold')) : null;
let calibrationSamples = [];
let calibrationBaseline = 0;
let detectionRAF = null;
let lastLandmarks = null;
const landmarkTooltip = document.getElementById('landmarkTooltip');

// Configurable cheek landmarks — click mesh to change
let leftCheekIdx = Number(localStorage.getItem('leftCheekIdx')) || 234;
let rightCheekIdx = Number(localStorage.getItem('rightCheekIdx')) || 454;
let pickingLandmark = null; // null | 'left' | 'right'

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getCheekRatio(landmarks) {
  const cheekWidth = dist(landmarks[leftCheekIdx], landmarks[rightCheekIdx]);
  const eyeDist = dist(landmarks[33], landmarks[263]);
  return cheekWidth / eyeDist;
}

function findNearestLandmark(mouseX, mouseY) {
  if (!lastLandmarks) return -1;
  const w = meshCanvas.offsetWidth, h = meshCanvas.offsetHeight;
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < lastLandmarks.length; i++) {
    // canvas is scaleX(-1), so mirror the x
    const px = (1 - lastLandmarks[i].x) * w;
    const py = lastLandmarks[i].y * h;
    const d = (px - mouseX) ** 2 + (py - mouseY) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return bestDist < 400 ? best : -1; // within ~20px
}

meshCanvas.style.pointerEvents = 'none';
// Enable pointer events only when mesh is visible
function updateMeshPointerEvents() {
  meshCanvas.style.pointerEvents = showMesh ? 'auto' : 'none';
}

meshCanvas.addEventListener('mousemove', (e) => {
  if (!lastLandmarks) return;
  const rect = meshCanvas.getBoundingClientRect();
  const idx = findNearestLandmark(e.clientX - rect.left, e.clientY - rect.top);
  if (idx >= 0) {
    landmarkTooltip.style.display = 'block';
    landmarkTooltip.style.left = (e.clientX - rect.left + 12) + 'px';
    landmarkTooltip.style.top = (e.clientY - rect.top - 8) + 'px';
    let label = `#${idx}`;
    if (idx === leftCheekIdx) label += ' (L cheek)';
    if (idx === rightCheekIdx) label += ' (R cheek)';
    if (pickingLandmark) label += ` — click to set ${pickingLandmark} cheek`;
    landmarkTooltip.textContent = label;
  } else {
    landmarkTooltip.style.display = 'none';
  }
});

meshCanvas.addEventListener('mouseleave', () => {
  landmarkTooltip.style.display = 'none';
});

meshCanvas.addEventListener('click', (e) => {
  if (!lastLandmarks) return;
  const rect = meshCanvas.getBoundingClientRect();
  const idx = findNearestLandmark(e.clientX - rect.left, e.clientY - rect.top);
  if (idx < 0) return;
  if (!pickingLandmark) {
    pickingLandmark = 'left';
    calibrationOverlay.style.display = 'block';
    calibrationOverlay.textContent = 'Click a landmark for LEFT cheek';
  } else if (pickingLandmark === 'left') {
    leftCheekIdx = idx;
    localStorage.setItem('leftCheekIdx', idx);
    pickingLandmark = 'right';
    calibrationOverlay.textContent = `Left cheek = #${idx}. Now click RIGHT cheek`;
  } else {
    rightCheekIdx = idx;
    localStorage.setItem('rightCheekIdx', idx);
    pickingLandmark = null;
    calibrationOverlay.textContent = `Cheek landmarks: L=#${leftCheekIdx} R=#${rightCheekIdx}`;
    // Clear old calibration since landmarks changed
    puffThreshold = null;
    localStorage.removeItem('puffThreshold');
    setTimeout(() => { calibrationOverlay.style.display = 'none'; }, 2000);
  }
});

async function initFaceMesh() {
  if (faceLandmarker || faceMeshLoading) return;
  faceMeshLoading = true;
  calibrateBtn.textContent = 'Loading model...';
  calibrateBtn.disabled = true;
  try {
    // Wait for the module script to load
    if (!window._mediapipeReady) {
      await new Promise(r => window.addEventListener('mediapipe-ready', r, { once: true }));
    }
    const FaceLandmarker = window._FaceLandmarker;
    const FilesetResolver = window._FilesetResolver;
    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    });
    faceMeshReady = true;
    console.log('FaceMesh model loaded successfully');
    calibrateBtn.textContent = 'Calibrate';
    calibrateBtn.disabled = false;
    startDetectionLoop();
  } catch (e) {
    console.error('FaceMesh load failed:', e);
    calibrateBtn.textContent = 'Load failed';
    faceMeshLoading = false;
  }
}

function drawMesh(landmarks) {
  const w = meshCanvas.width = meshCanvas.offsetWidth;
  const h = meshCanvas.height = meshCanvas.offsetHeight;
  meshCtx.clearRect(0, 0, w, h);
  meshCtx.fillStyle = 'rgba(0,255,128,0.6)';
  for (const pt of landmarks) {
    meshCtx.beginPath();
    meshCtx.arc(pt.x * w, pt.y * h, 1.5, 0, Math.PI * 2);
    meshCtx.fill();
  }
  // highlight cheek + eye landmarks used for detection
  const highlights = { [leftCheekIdx]: '#ff0', [rightCheekIdx]: '#ff0', '33': '#0ff', '263': '#0ff' };
  for (const [idx, color] of Object.entries(highlights)) {
    const pt = landmarks[Number(idx)];
    meshCtx.fillStyle = color;
    meshCtx.beginPath();
    meshCtx.arc(pt.x * w, pt.y * h, 4, 0, Math.PI * 2);
    meshCtx.fill();
  }
}

function startDetectionLoop() {
  function tick() {
    detectionRAF = requestAnimationFrame(tick);
    if (!camOn || !faceMeshReady || !faceLandmarker) return;
    if (video.readyState < 2) return;
    const now = performance.now();
    const result = faceLandmarker.detectForVideo(video, now);
    if (!result.faceLandmarks || !result.faceLandmarks.length) return;
    const landmarks = result.faceLandmarks[0];
    lastLandmarks = landmarks;
    const ratio = getCheekRatio(landmarks);

    if (showMesh) drawMesh(landmarks);

    if (calibrating) {
      calibrationSamples.push(ratio);
      return;
    }

    if (puffThreshold !== null) {
      puffBanner.style.display = ratio > puffThreshold ? '' : 'none';
    }
  }
  if (!detectionRAF) tick();
}

meshToggle.addEventListener('click', () => {
  showMesh = !showMesh;
  meshToggle.textContent = showMesh ? 'Hide Mesh' : 'Show Mesh';
  meshCanvas.style.display = showMesh ? 'block' : 'none';
  updateMeshPointerEvents();
  if (!showMesh) {
    meshCtx.clearRect(0, 0, meshCanvas.width, meshCanvas.height);
    landmarkTooltip.style.display = 'none';
    if (pickingLandmark) { pickingLandmark = null; calibrationOverlay.style.display = 'none'; }
  }
});

calibrateBtn.addEventListener('click', async () => {
  if (calibrating) return;
  if (!faceMeshReady) {
    calibrationOverlay.style.display = 'block';
    calibrationOverlay.textContent = 'Model still loading, please wait...';
    setTimeout(() => { calibrationOverlay.style.display = 'none'; }, 2000);
    return;
  }
  calibrating = true;
  calibrationOverlay.style.display = 'block';

  // Step 1: baseline
  calibrationOverlay.textContent = 'Relax your face...';
  calibrationSamples = [];
  await new Promise(r => setTimeout(r, 2000));
  calibrationBaseline = calibrationSamples.length ? calibrationSamples.reduce((a, b) => a + b) / calibrationSamples.length : 0;

  // Step 2: puffed
  calibrationOverlay.textContent = 'Now puff your cheeks!';
  calibrationSamples = [];
  await new Promise(r => setTimeout(r, 2000));
  const puffedAvg = calibrationSamples.length ? calibrationSamples.reduce((a, b) => a + b) / calibrationSamples.length : 0;

  if (calibrationBaseline > 0 && puffedAvg > calibrationBaseline) {
    puffThreshold = (calibrationBaseline + puffedAvg) / 2;
    localStorage.setItem('puffThreshold', puffThreshold);

    // Verification phase: 3 test rounds
    for (let i = 1; i <= 3; i++) {
      calibrationOverlay.textContent = `Test ${i}/3 — puff now to verify...`;
      calibrating = false; // allow detection loop to check threshold
      await new Promise(r => setTimeout(r, 2500));
      const detected = puffBanner.style.display !== 'none';
      calibrationOverlay.textContent = `Test ${i}/3 — ${detected ? 'Puff detected!' : 'No puff detected'}`;
      await new Promise(r => setTimeout(r, 1000));
    }
    calibrating = true;
    puffBanner.style.display = 'none';
    calibrationOverlay.textContent = 'Calibration complete!';
  } else {
    calibrationOverlay.textContent = 'Calibration failed — try again';
  }

  setTimeout(() => { calibrationOverlay.style.display = 'none'; }, 1500);
  calibrating = false;
});

// Metronome
let audioCtx = null;
let bpm = 120;
let beatsPerMeasure = 4;
let isRunning = false;
let currentBeat = 0;
let nextNoteTime = 0;
let timerID = null;
const scheduleAheadTime = 0.1;
const lookahead = 25;

const bpmInput = document.getElementById('bpmInput');
const bpmSlider = document.getElementById('bpmSlider');
const startBtn = document.getElementById('startBtn');
const tapBtn = document.getElementById('tapBtn');
const timeSig = document.getElementById('timeSig');
const presetSelect = document.getElementById('presetSelect');
const beatDisplay = document.getElementById('beatDisplay');
const elapsedEl = document.getElementById('elapsed');
const elapsedPauseBtn = document.getElementById('elapsedPauseBtn');
const elapsedResetBtn = document.getElementById('elapsedResetBtn');
let elapsedInterval = null;
let elapsedStart = 0;
let elapsedAccum = 0;
let elapsedPaused = false;
let elapsedEverStarted = false;

function updateElapsedDisplay() {
  const total = elapsedAccum + (elapsedPaused ? 0 : Date.now() - elapsedStart);
  const s = Math.floor(total / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  elapsedEl.textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function startElapsed() {
  elapsedAccum = 0;
  elapsedPaused = false;
  elapsedEverStarted = true;
  elapsedStart = Date.now();
  elapsedEl.textContent = '00:00';
  elapsedPauseBtn.disabled = false;
  elapsedPauseBtn.textContent = '⏸';
  elapsedResetBtn.disabled = false;
  clearInterval(elapsedInterval);
  elapsedInterval = setInterval(updateElapsedDisplay, 1000);
}

function resetElapsed() {
  clearInterval(elapsedInterval);
  elapsedAccum = 0;
  elapsedPaused = false;
  elapsedEverStarted = false;
  elapsedEl.textContent = '00:00';
  elapsedPauseBtn.disabled = true;
  elapsedPauseBtn.textContent = '⏸';
  elapsedResetBtn.disabled = true;
}

elapsedPauseBtn.addEventListener('click', () => {
  if (elapsedPaused) {
    elapsedStart = Date.now();
    elapsedPaused = false;
    elapsedPauseBtn.textContent = '⏸';
    elapsedInterval = setInterval(updateElapsedDisplay, 1000);
  } else {
    elapsedAccum += Date.now() - elapsedStart;
    elapsedPaused = true;
    clearInterval(elapsedInterval);
    elapsedPauseBtn.textContent = '▶';
  }
});

elapsedResetBtn.addEventListener('click', resetElapsed);

function buildDots() {
  beatDisplay.innerHTML = '';
  for (let i = 0; i < beatsPerMeasure; i++) {
    const dot = document.createElement('div');
    dot.className = 'beat-dot';
    beatDisplay.appendChild(dot);
  }
}
buildDots();

function setBpm(v) {
  bpm = Math.min(300, Math.max(20, Math.round(v)));
  bpmInput.value = bpm;
  bpmSlider.value = bpm;
}

bpmInput.addEventListener('change', () => setBpm(Number(bpmInput.value)));
bpmSlider.addEventListener('input', () => setBpm(Number(bpmSlider.value)));

timeSig.addEventListener('change', () => {
  beatsPerMeasure = Number(timeSig.value);
  currentBeat = 0;
  buildDots();
});

presetSelect.addEventListener('change', () => {
  if (presetSelect.value) setBpm(Number(presetSelect.value));
  presetSelect.value = '';
});

function playClick(time, accent) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(accent ? 1 : 0.5, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.start(time);
  osc.stop(time + 0.05);
}

function flashBeat(beat, time) {
  const delay = (time - audioCtx.currentTime) * 1000;
  setTimeout(() => {
    const dots = beatDisplay.querySelectorAll('.beat-dot');
    dots.forEach(d => d.classList.remove('active', 'accent'));
    if (dots[beat]) {
      dots[beat].classList.add(beat === 0 ? 'accent' : 'active');
      setTimeout(() => dots[beat]?.classList.remove('active', 'accent'), 100);
    }
  }, Math.max(0, delay));
}

function scheduler() {
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    const accent = currentBeat === 0;
    playClick(nextNoteTime, accent);
    flashBeat(currentBeat, nextNoteTime);
    nextNoteTime += 60.0 / bpm;
    currentBeat = (currentBeat + 1) % beatsPerMeasure;
  }
}

function start() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  isRunning = true;
  currentBeat = 0;
  nextNoteTime = audioCtx.currentTime;
  timerID = setInterval(scheduler, lookahead);
  startBtn.textContent = 'Stop';
  startBtn.classList.add('running');
  if (!elapsedEverStarted) startElapsed();
}

function stop() {
  isRunning = false;
  clearInterval(timerID);
  startBtn.textContent = 'Start';
  startBtn.classList.remove('running');
  beatDisplay.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active', 'accent'));
}

startBtn.addEventListener('click', () => isRunning ? stop() : showNotesModal(() => start()));

// Tap tempo
let tapTimes = [];
tapBtn.addEventListener('click', () => {
  const now = performance.now();
  tapTimes.push(now);
  tapTimes = tapTimes.filter(t => now - t < 3000);
  if (tapTimes.length > 1) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    const avg = intervals.reduce((a, b) => a + b) / intervals.length;
    setBpm(60000 / avg);
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (e.code === 'Space' && !inField) {
    e.preventDefault();
    isRunning ? stop() : showNotesModal(() => start());
  }
  if (e.key === 'n' && !inField && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    if (!notesPanel.classList.contains('open')) openNotesPanel();
    noteInput.focus();
  }
});

// Practice timer
const timerDisplay = document.getElementById('timerDisplay');
const timerBtn = document.getElementById('timerBtn');
const timerReset = document.getElementById('timerReset');
const timerPresetBtn = document.getElementById('timerPresetBtn');
const timerPresetMenu = document.getElementById('timerPresetMenu');
const timerPresetWrap = document.getElementById('timerPresetWrap');
let timerSeconds = 30 * 60;
let timerRemaining = timerSeconds;
let timerInterval = null;
let timerRunning = false;

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(timerRemaining);
  timerDisplay.classList.toggle('timer-done', timerRemaining === 0);
}

timerPresetBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  timerPresetMenu.classList.toggle('hidden');
});

timerPresetMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-value]');
  if (!btn) return;
  timerPresetMenu.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  timerSeconds = Number(btn.dataset.value) * 60;
  timerRemaining = timerSeconds;
  timerPresetMenu.classList.add('hidden');
  stopTimer();
  updateTimerDisplay();
});

document.addEventListener('click', (e) => {
  if (!timerPresetWrap.contains(e.target)) timerPresetMenu.classList.add('hidden');
});

function startTimer() {
  if (!elapsedEverStarted) startElapsed();
  timerRunning = true;
  timerBtn.textContent = '⏸';
  timerBtn.classList.add('running');
  timerInterval = setInterval(() => {
    if (timerRemaining > 0) {
      timerRemaining--;
      updateTimerDisplay();
      if (timerRemaining === 0) {
        stopTimer();
        playTimerAlert();
      }
    }
  }, 1000);
}

function stopTimer() {
  timerRunning = false;
  clearInterval(timerInterval);
  timerBtn.textContent = timerRemaining === 0 ? '✓' : '▶';
  timerBtn.classList.remove('running');
}

let alertInterval = null;
function playAlertChime() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  [0, 0.3, 0.6].forEach((offset, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = [880, 660, 440][i];
    gain.gain.setValueAtTime(0.5, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.25);
    osc.start(now + offset);
    osc.stop(now + offset + 0.25);
  });
}
function playTimerAlert() {
  playAlertChime();
  alertInterval = setInterval(playAlertChime, 1500);
}
function stopTimerAlert() {
  if (alertInterval) { clearInterval(alertInterval); alertInterval = null; }
}

// timerBtn click is handled by the Practice Notes section below

timerReset.addEventListener('click', () => {
  stopTimer();
  stopTimerAlert();
  timerRemaining = timerSeconds;
  updateTimerDisplay();
});

// Practice Notes
const NOTES_KEY = 'practiceNotes';
const notesPanel = document.getElementById('notesPanel');
const notesList = document.getElementById('notesList');
const noteInput = document.getElementById('noteInput');
const addNoteBtn = document.getElementById('addNoteBtn');
const notesToggleBtn = document.getElementById('notesToggleBtn');
const notesPanelClose = document.getElementById('notesPanelClose');
const notesModalBackdrop = document.getElementById('notesModalBackdrop');
const notesModalList = document.getElementById('notesModalList');
const notesUnderstoodBtn = document.getElementById('notesUnderstoodBtn');
const notesModalAddBtn = document.getElementById('notesModalAddBtn');
const notesModalAddForm = document.getElementById('notesModalAddForm');
const notesModalInput = document.getElementById('notesModalInput');
const notesModalSaveBtn = document.getElementById('notesModalSaveBtn');
const notesModalCancelBtn = document.getElementById('notesModalCancelBtn');
let pendingTimerStart = false;

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; }
  catch { return []; }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function formatNoteDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function renderNotesList() {
  const notes = loadNotes();
  notesList.innerHTML = '';
  notes.slice().reverse().forEach(note => {
    const entry = document.createElement('div');
    entry.className = 'note-entry';
    entry.dataset.id = note.id;
    entry.innerHTML = `
      <div class="note-entry-date">${formatNoteDate(note.id)}</div>
      <div class="note-entry-text">${escapeHtml(note.text)}</div>
      <div class="note-entry-actions">
        <button class="edit-btn" title="Edit">&#9998;</button>
        <button class="delete-btn" title="Delete">&times;</button>
      </div>
    `;
    notesList.appendChild(entry);
  });
}

function enterEditMode(entry) {
  if (entry.classList.contains('editing')) return;
  entry.classList.add('editing');
  const textEl = entry.querySelector('.note-entry-text');
  const originalText = textEl.textContent;
  const actionsEl = entry.querySelector('.note-entry-actions');
  actionsEl.style.display = 'none';

  const textarea = document.createElement('textarea');
  textarea.className = 'note-entry-edit-area';
  textarea.value = originalText;
  entry.appendChild(textarea);

  const editActions = document.createElement('div');
  editActions.className = 'note-entry-edit-actions';
  editActions.innerHTML = '<button class="note-save-btn">Save</button><button class="note-cancel-btn">Cancel</button>';
  entry.appendChild(editActions);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  editActions.querySelector('.note-save-btn').addEventListener('click', () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    const id = Number(entry.dataset.id);
    const notes = loadNotes().map(n => n.id === id ? { ...n, text: newText } : n);
    saveNotes(notes);
    renderNotesList();
  });

  editActions.querySelector('.note-cancel-btn').addEventListener('click', () => {
    renderNotesList();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) editActions.querySelector('.note-save-btn').click();
    if (e.key === 'Escape') editActions.querySelector('.note-cancel-btn').click();
  });
}

function renderNotesModal() {
  const notes = loadNotes();
  notesModalList.innerHTML = '';
  if (notes.length === 0) {
    notesModalList.innerHTML = '<div class="notes-modal-empty">No practice notes yet.</div>';
    return;
  }
  notes.slice().reverse().forEach(note => {
    const entry = document.createElement('div');
    entry.className = 'notes-modal-entry';
    entry.dataset.id = note.id;
    entry.innerHTML = `
      <div class="notes-modal-entry-date">${formatNoteDate(note.id)}</div>
      <div class="notes-modal-entry-text">${escapeHtml(note.text)}</div>
      <div class="note-entry-actions">
        <button class="edit-btn" title="Edit">&#9998;</button>
        <button class="delete-btn" title="Delete">&times;</button>
      </div>
    `;
    notesModalList.appendChild(entry);
  });
}

function enterEditModeModal(entry) {
  if (entry.classList.contains('editing')) return;
  entry.classList.add('editing');
  const textEl = entry.querySelector('.notes-modal-entry-text');
  const originalText = textEl.textContent;
  const actionsEl = entry.querySelector('.note-entry-actions');
  actionsEl.style.display = 'none';

  const textarea = document.createElement('textarea');
  textarea.className = 'note-entry-edit-area';
  textarea.value = originalText;
  entry.appendChild(textarea);

  const editActions = document.createElement('div');
  editActions.className = 'note-entry-edit-actions';
  editActions.innerHTML = '<button class="note-save-btn">Save</button><button class="note-cancel-btn">Cancel</button>';
  entry.appendChild(editActions);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  editActions.querySelector('.note-save-btn').addEventListener('click', () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    const id = Number(entry.dataset.id);
    const notes = loadNotes().map(n => n.id === id ? { ...n, text: newText } : n);
    saveNotes(notes);
    renderNotesModal();
    renderNotesList();
  });

  editActions.querySelector('.note-cancel-btn').addEventListener('click', () => {
    renderNotesModal();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) editActions.querySelector('.note-save-btn').click();
    if (e.key === 'Escape') editActions.querySelector('.note-cancel-btn').click();
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function openNotesPanel() {
  renderNotesList();
  notesPanel.classList.add('open');
  notesToggleBtn.classList.add('active');
}

function closeNotesPanel() {
  notesPanel.classList.remove('open');
  notesToggleBtn.classList.remove('active');
}

function showNotesModal(onConfirm) {
  renderNotesModal();
  notesModalBackdrop.classList.add('open');
  pendingTimerStart = onConfirm;
}

function closeNotesModal() {
  notesModalBackdrop.classList.remove('open');
  pendingTimerStart = false;
}

notesToggleBtn.addEventListener('click', () => {
  notesPanel.classList.contains('open') ? closeNotesPanel() : openNotesPanel();
});


notesPanelClose.addEventListener('click', closeNotesPanel);

addNoteBtn.addEventListener('click', () => {
  const text = noteInput.value.trim();
  if (!text) return;
  const notes = loadNotes();
  notes.push({ id: Date.now(), text });
  saveNotes(notes);
  noteInput.value = '';
  renderNotesList();
});

noteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNoteBtn.click();
});

notesList.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) {
    if (deleteBtn.dataset.confirming) {
      const id = Number(deleteBtn.closest('.note-entry').dataset.id);
      saveNotes(loadNotes().filter(n => n.id !== id));
      renderNotesList();
    } else {
      deleteBtn.dataset.confirming = '1';
      deleteBtn.textContent = 'Sure?';
      deleteBtn.style.color = '#e94560';
      const cancel = setTimeout(() => {
        if (deleteBtn.dataset.confirming) {
          delete deleteBtn.dataset.confirming;
          deleteBtn.textContent = '×';
          deleteBtn.style.color = '';
        }
      }, 3000);
      deleteBtn.dataset.cancelTimeout = cancel;
    }
    return;
  }
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    enterEditMode(editBtn.closest('.note-entry'));
  }
});

notesUnderstoodBtn.addEventListener('click', () => {
  const cb = pendingTimerStart;
  closeNotesModal();
  if (typeof cb === 'function') cb();
});

notesModalBackdrop.addEventListener('click', (e) => {
  if (e.target === notesModalBackdrop) closeNotesModal();
});

notesModalAddBtn.addEventListener('click', () => {
  const isOpen = !notesModalAddForm.classList.contains('hidden');
  if (isOpen) {
    notesModalAddForm.classList.add('hidden');
    notesModalInput.value = '';
  } else {
    notesModalAddForm.classList.remove('hidden');
    notesModalInput.focus();
  }
});

notesModalSaveBtn.addEventListener('click', () => {
  const text = notesModalInput.value.trim();
  if (!text) return;
  const notes = loadNotes();
  notes.push({ id: Date.now(), text });
  saveNotes(notes);
  notesModalInput.value = '';
  notesModalAddForm.classList.add('hidden');
  renderNotesModal();
  renderNotesList();
});

notesModalCancelBtn.addEventListener('click', () => {
  notesModalInput.value = '';
  notesModalAddForm.classList.add('hidden');
});

notesModalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) notesModalSaveBtn.click();
  if (e.key === 'Escape') notesModalCancelBtn.click();
});

notesModalList.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) {
    if (deleteBtn.dataset.confirming) {
      const id = Number(deleteBtn.closest('.notes-modal-entry').dataset.id);
      saveNotes(loadNotes().filter(n => n.id !== id));
      renderNotesModal();
      renderNotesList();
    } else {
      deleteBtn.dataset.confirming = '1';
      deleteBtn.textContent = 'Sure?';
      deleteBtn.style.color = '#e94560';
      setTimeout(() => {
        if (deleteBtn.dataset.confirming) {
          delete deleteBtn.dataset.confirming;
          deleteBtn.textContent = '×';
          deleteBtn.style.color = '';
        }
      }, 3000);
    }
    return;
  }
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    enterEditModeModal(editBtn.closest('.notes-modal-entry'));
  }
});

// ── Notes Backup & Import ──
function noteDateToISO(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function backupNotes() {
  const notes = loadNotes();
  if (notes.length === 0) { alert('No notes to backup.'); return; }
  const lines = notes.slice().reverse().map(n => `# ${noteDateToISO(n.id)}\n${n.text}`);
  const content = lines.join('\n\n');
  const today = noteDateToISO(Date.now());
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `music-notes-${today}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseNotesMarkdown(text) {
  const results = [];
  const lines = text.split('\n');
  let currentDate = null;
  let currentLines = [];
  for (const line of lines) {
    const header = line.match(/^#\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (header) {
      if (currentDate !== null) {
        const noteText = currentLines.join('\n').trim();
        if (noteText) results.push({ date: currentDate, text: noteText });
      }
      currentDate = header[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentDate !== null) {
    const noteText = currentLines.join('\n').trim();
    if (noteText) results.push({ date: currentDate, text: noteText });
  }
  return results;
}

function importNotes(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const parsed = parseNotesMarkdown(e.target.result);
    if (parsed.length === 0) { alert('No valid notes found in file.'); return; }
    const existing = loadNotes();
    const msg = existing.length > 0
      ? `Import ${parsed.length} note(s)? This will ADD to your existing ${existing.length} note(s).\n\nNote: imported notes will use midnight of their date as timestamp.`
      : `Import ${parsed.length} note(s)?`;
    if (!confirm(msg)) return;
    const imported = parsed.map(n => ({
      id: new Date(n.date + 'T12:00:00').getTime(),
      text: n.text
    }));
    const merged = [...existing, ...imported];
    merged.sort((a, b) => a.id - b.id);
    saveNotes(merged);
    renderNotesList();
    alert(`Imported ${parsed.length} note(s).`);
  };
  reader.readAsText(file);
}

document.getElementById('notesBackupBtn').addEventListener('click', backupNotes);
document.getElementById('notesImportBtn').addEventListener('click', () => {
  document.getElementById('notesImportInput').click();
});
document.getElementById('notesImportInput').addEventListener('change', (e) => {
  if (e.target.files[0]) { importNotes(e.target.files[0]); e.target.value = ''; }
});

// Changelog
const CHANGELOG = [
  { date: '2026-03-15', desc: 'Notes dates now show date only (no time); added Backup (download .md) and Import (.md) buttons to notes panel' },
  { date: '2026-03-09', desc: 'Mobile responsive layout: camera panel moves to bottom on small screens, navbar title truncates gracefully, footer sticks to bottom' },
  { date: '2026-03-09', desc: 'Nav buttons updated with icons: color wheel for Theme, pencil for Practice Notes' },
  { date: '2026-03-09', desc: 'Timer duration select replaced with compact gear icon dropdown; fixes timer row overflow on narrow/iPad screens' },
  { date: '2026-03-09', desc: 'Notes modal CTA changed to "ok, let\'s go"; clicking outside the modal cancels and does not start the timer' },
  { date: '2026-03-08', desc: 'Renamed app to Music Practice Stage; nav title uses Playfair Display bold italic with theme accent colour on first word' },
  { date: '2026-03-08', desc: 'Split into separate CSS and JS files; dark/light theme toggle with 25 themes per mode; Bluey light as default; themes sorted by colour-wheel order; camera controls moved to top-left as compact horizontal row with Experiments group' },
  { date: '2026-03-07', desc: 'Design overhaul: BPM number switched to DM Mono for clear digit rendering, beat dots more visible, new Mint and Flame themes added, theme-aware CSS variables replace all hardcoded warm colors' },
  { date: '2026-03-07', desc: 'Casio LCD-style 7-segment display for timer and elapsed time; elapsed section moved to bottom of panel; notes modal shown on metronome and timer start; camera button centred with helper text' },
  { date: '2026-03-07', desc: 'Elapsed time section with pause/resume and reset; timer and elapsed redesigned as compact single rows; panel layout swapped (metronome left, camera right); practice notes moved to right-side panel' },
  { date: '2026-03-01', desc: 'Add navbar, footer, changelog view, practice notes with inline editing, delete confirmation, and keyboard shortcuts' },
  { date: '2026-03-01', desc: 'Add practice notes panel with localStorage persistence, timer-start modal, and show/hide toggle' },
  { date: '2026-02-01', desc: 'Add webcam mirror, practice timer, and elapsed time display' },
  { date: '2026-02-01', desc: 'Add web-based metronome with Web Audio API' },
];

const changelogBackdrop = document.getElementById('changelogBackdrop');
const changelogList = document.getElementById('changelogList');
const changelogCloseBtn = document.getElementById('changelogCloseBtn');
const changelogLink = document.getElementById('changelogLink');

function openChangelog() {
  changelogList.innerHTML = '';
  CHANGELOG.forEach(entry => {
    const el = document.createElement('div');
    el.className = 'changelog-entry';
    el.innerHTML = `<span class="changelog-date">${entry.date}</span><span class="changelog-desc">${escapeHtml(entry.desc)}</span>`;
    changelogList.appendChild(el);
  });
  changelogBackdrop.classList.add('open');
}

changelogLink.addEventListener('click', (e) => { e.preventDefault(); openChangelog(); });
changelogCloseBtn.addEventListener('click', () => changelogBackdrop.classList.remove('open'));
changelogBackdrop.addEventListener('click', (e) => { if (e.target === changelogBackdrop) changelogBackdrop.classList.remove('open'); });

// Hook timer start to show notes modal first
timerBtn.addEventListener('click', () => {
  if (timerRemaining === 0) { stopTimerAlert(); timerReset.click(); return; }
  if (!timerRunning) {
    showNotesModal(() => startTimer());
  } else {
    stopTimer();
  }
});

// ── Theme Picker ──
const THEMES_DARK = [
  // Blues
  { id:'bluey',      name:'Bluey',     accent:'#4898CC', hi:'#68B8EE', '--bg':'#080C14','--surface':'#101820','--panel':'#18222E','--border':'#0E1418','--border-hi':'#203040','--cream':'#E4F0F8','--cream-dim':'#80A4C0','--muted':'#446480', lcd:'#68C8FF','lcd-bg':'#060A0E','lcd-border':'#12202C' },
  { id:'doraemon',   name:'Doraemon',  accent:'#2878C8', hi:'#4098E8', '--bg':'#060810','--surface':'#0E1420','--panel':'#141C2A','--border':'#0C1018','--border-hi':'#1A2840','--cream':'#E0ECF8','--cream-dim':'#789CC0','--muted':'#3C5C80', lcd:'#FF4444','lcd-bg':'#0A0404','lcd-border':'#1E0E0E' },
  { id:'cinderella', name:'Cinderella',accent:'#4080C8', hi:'#5898E0', '--bg':'#D8E4F0','--surface':'#C8D8E8','--panel':'#B8CCE0','--border':'#A8BCD4','--border-hi':'#90A8C8','--cream':'#1A2840','--cream-dim':'#4C6080','--muted':'#8098B8', lcd:'#40A8FF','lcd-bg':'#0A0C10','lcd-border':'#182030' },
  { id:'stitch',     name:'Stitch',    accent:'#3088D0', hi:'#48A8F0', '--bg':'#060A12','--surface':'#0E1420','--panel':'#161E2C','--border':'#0C1218','--border-hi':'#1C2C44','--cream':'#DEF0FC','--cream-dim':'#7CA4C8','--muted':'#3C6088', lcd:'#40A8FF','lcd-bg':'#06080E','lcd-border':'#101C2C' },
  { id:'elsa',       name:'Elsa',      accent:'#58B4E8', hi:'#7CD0FF', '--bg':'#060C14','--surface':'#0E1622','--panel':'#141E2E','--border':'#0C1420','--border-hi':'#1C2E48','--cream':'#E0F0FC','--cream-dim':'#7CA0C4','--muted':'#3C6088', lcd:'#40A8FF','lcd-bg':'#060810','lcd-border':'#101C2C' },
  { id:'trooper',    name:'Trooper',   accent:'#A8B8C8', hi:'#C4D4E4', '--bg':'#0A0C10','--surface':'#121620','--panel':'#1A2030','--border':'#101420','--border-hi':'#242E40','--cream':'#E8ECF4','--cream-dim':'#8892A4','--muted':'#484E5E', lcd:'#E0E8F0','lcd-bg':'#08080C','lcd-border':'#1A1E28' },
  // Teals
  { id:'totoro',     name:'Totoro',    accent:'#6C98A0', hi:'#88B8C0', '--bg':'#080C0C','--surface':'#101A1A','--panel':'#182424','--border':'#0E1616','--border-hi':'#1E3434','--cream':'#E0F0F0','--cream-dim':'#84A8A8','--muted':'#466060', lcd:'#A8E063','lcd-bg':'#060A06','lcd-border':'#121E10' },
  // Greens
  { id:'buzz',       name:'Buzz',      accent:'#40B870', hi:'#5CD888', '--bg':'#060E0A','--surface':'#0E1A14','--panel':'#16261E','--border':'#0C1610','--border-hi':'#1C3628','--cream':'#DCF6E8','--cream-dim':'#78B490','--muted':'#3C6850', lcd:'#40FF90','lcd-bg':'#040A06','lcd-border':'#0E1E14' },
  { id:'hulk',       name:'Hulk',      accent:'#50C030', hi:'#6CE048', '--bg':'#060E06','--surface':'#0E1A0E','--panel':'#162616','--border':'#0C160C','--border-hi':'#1C361C','--cream':'#E0F6D8','--cream-dim':'#7CB46C','--muted':'#3E6830', lcd:'#A8E063','lcd-bg':'#040A04','lcd-border':'#101E10' },
  { id:'shrek',      name:'Shrek',     accent:'#6CA830', hi:'#88CC48', '--bg':'#080E06','--surface':'#121A0E','--panel':'#1C2618','--border':'#0E160C','--border-hi':'#223418','--cream':'#E8F4D4','--cream-dim':'#8CA86C','--muted':'#4C5C30', lcd:'#A8E063','lcd-bg':'#060A04','lcd-border':'#121E10' },
  { id:'yoda',       name:'Yoda',      accent:'#7DA848', hi:'#98C860', '--bg':'#080C06','--surface':'#101810','--panel':'#1A2418','--border':'#0E1610','--border-hi':'#20301C','--cream':'#E8F2E0','--cream-dim':'#8AA878','--muted':'#4A5C38', lcd:'#A8E063','lcd-bg':'#060A04','lcd-border':'#141E10' },
  // Earthy / Browns
  { id:'groot',      name:'Groot',     accent:'#A07040', hi:'#C08C58', '--bg':'#0C0A06','--surface':'#18140E','--panel':'#221E16','--border':'#12100A','--border-hi':'#302A1C','--cream':'#F4EAD8','--cream-dim':'#AC9874','--muted':'#605038', lcd:'#A8E063','lcd-bg':'#060A04','lcd-border':'#141E10' },
  // Yellows / Golds
  { id:'pooh',       name:'Pooh',      accent:'#C88820', hi:'#E0A438', '--bg':'#F0E8D4','--surface':'#E4DABC','--panel':'#D8CEA8','--border':'#C8BC9C','--border-hi':'#B0A480','--cream':'#2A2010','--cream-dim':'#6C5830','--muted':'#A09470', lcd:'#E8A020','lcd-bg':'#0A0806','lcd-border':'#1E1810' },
  { id:'batman',     name:'Batman',    accent:'#D4A820', hi:'#F0C440', '--bg':'#0A0A06','--surface':'#141408','--panel':'#1E1E14','--border':'#10100A','--border-hi':'#2C2C1A','--cream':'#F4F0DC','--cream-dim':'#A8A478','--muted':'#5C5C3A', lcd:'#E8A020','lcd-bg':'#0A0806','lcd-border':'#1C1810' },
  { id:'pikachu',    name:'Pikachu',   accent:'#F8D030', hi:'#FFE660', '--bg':'#100E04','--surface':'#1E1A0C','--panel':'#2A2414','--border':'#181408','--border-hi':'#3A321A','--cream':'#FFFADC','--cream-dim':'#BCAC64','--muted':'#706030', lcd:'#F8D030','lcd-bg':'#0A0804','lcd-border':'#1E1A0C' },
  { id:'minions',    name:'Minions',   accent:'#F0C020', hi:'#FFD84C', '--bg':'#100E06','--surface':'#1C1810','--panel':'#262018','--border':'#181408','--border-hi':'#382E1C','--cream':'#FCF4DC','--cream-dim':'#B4A474','--muted':'#6A5C36', lcd:'#E8A020','lcd-bg':'#0A0804','lcd-border':'#201A0C' },
  { id:'spongebob',  name:'SpongeBob', accent:'#F0D028', hi:'#FFE858', '--bg':'#0E0C04','--surface':'#1A180C','--panel':'#262214','--border':'#14120A','--border-hi':'#383018','--cream':'#FFF6D4','--cream-dim':'#B8A868','--muted':'#6C5E2E', lcd:'#40C8FF','lcd-bg':'#060A0E','lcd-border':'#101C28' },
  // Reds
  { id:'ironman',    name:'Iron Man',  accent:'#CC3020', hi:'#EE4838', '--bg':'#100806','--surface':'#1C1010','--panel':'#281A16','--border':'#160E08','--border-hi':'#38201A','--cream':'#F8ECDC','--cream-dim':'#B49470','--muted':'#6A5038', lcd:'#40C8FF','lcd-bg':'#060A0E','lcd-border':'#101C28' },
  { id:'cartman',    name:'Cartman',   accent:'#E04030', hi:'#F85848', '--bg':'#0E0808','--surface':'#1A1010','--panel':'#241818','--border':'#161010','--border-hi':'#341E1E','--cream':'#F8EAE4','--cream-dim':'#B4887C','--muted':'#6C4840', lcd:'#40D8B0','lcd-bg':'#060A08','lcd-border':'#10201A' },
  { id:'deadpool',   name:'Deadpool',  accent:'#CC2030', hi:'#EE3848', '--bg':'#100608','--surface':'#1E0E12','--panel':'#2A161A','--border':'#160C10','--border-hi':'#3A1C20','--cream':'#FAE2E6','--cream-dim':'#B48088','--muted':'#6C4048', lcd:'#FF4444','lcd-bg':'#0A0404','lcd-border':'#200E0E' },
  { id:'vader',      name:'Vader',     accent:'#CC2030', hi:'#EE3848', '--bg':'#0C0606','--surface':'#141010','--panel':'#1E1616','--border':'#121010','--border-hi':'#2C1E1E','--cream':'#F0E6E6','--cream-dim':'#A08080','--muted':'#5C4444', lcd:'#FF4444','lcd-bg':'#0A0404','lcd-border':'#1E0E0E' },
  { id:'maul',       name:'D. Maul',   accent:'#D01010', hi:'#F02828', '--bg':'#100404','--surface':'#1C0808','--panel':'#280E0E','--border':'#140606','--border-hi':'#3C1010','--cream':'#F8DCDC','--cream-dim':'#B86C6C','--muted':'#6C3636', lcd:'#FF2020','lcd-bg':'#0A0404','lcd-border':'#200C0C' },
  { id:'spidey',     name:'Spidey',    accent:'#D42030', hi:'#F03848', '--bg':'#0C0810','--surface':'#141018','--panel':'#1E1824','--border':'#101018','--border-hi':'#2A1E38','--cream':'#F2E6F0','--cream-dim':'#A08498','--muted':'#584466', lcd:'#4088FF','lcd-bg':'#080810','lcd-border':'#181828' },
  // Purples
  { id:'joker',      name:'Joker',     accent:'#8844CC', hi:'#A660EE', '--bg':'#0C0812','--surface':'#16101E','--panel':'#201A2A','--border':'#120E1A','--border-hi':'#2A1E3C','--cream':'#F0E6FA','--cream-dim':'#9C80B8','--muted':'#584470', lcd:'#44FF44','lcd-bg':'#060A06','lcd-border':'#141E14' },
  { id:'thanos',     name:'Thanos',    accent:'#9040CC', hi:'#AC5CEE', '--bg':'#0C0614','--surface':'#160E20','--panel':'#20162C','--border':'#100C1A','--border-hi':'#2C1C3E','--cream':'#F0E2FC','--cream-dim':'#A478C0','--muted':'#5E3C78', lcd:'#F0C020','lcd-bg':'#0A0804','lcd-border':'#1E180C' },
];

const THEMES_LIGHT = [
  // Blues
  { id:'bluey-light',     name:'Bluey',     accent:'#3480B0', hi:'#2C74A0', '--bg':'#E6EEF4','--surface':'#D8E4EE','--panel':'#CCD8E6','--border':'#B4C8DC','--border-hi':'#94B0CC','--cream':'#081018','--cream-dim':'#2C5474','--muted':'#80A4BC', lcd:'#68C8FF','lcd-bg':'#060A0E','lcd-border':'#12202C' },
  { id:'doraemon-light',  name:'Doraemon',  accent:'#1C64AA', hi:'#18589A', '--bg':'#E0ECF6','--surface':'#D2E0EE','--panel':'#C4D4E4','--border':'#ACC0D8','--border-hi':'#8CACCC','--cream':'#06101C','--cream-dim':'#284C6C','--muted':'#789CB8', lcd:'#FF4444','lcd-bg':'#0A0404','lcd-border':'#1E0E0E' },
  { id:'cinderella-light',name:'Cinderella',accent:'#3470B0', hi:'#2C64A0', '--bg':'#E4EEF6','--surface':'#D6E2EE','--panel':'#C8D6E6','--border':'#B0C4DA','--border-hi':'#90B0CC','--cream':'#0C1828','--cream-dim':'#345878','--muted':'#88A8C4', lcd:'#40A8FF','lcd-bg':'#0A0C10','lcd-border':'#182030' },
  { id:'stitch-light',    name:'Stitch',    accent:'#2470B4', hi:'#1C64A4', '--bg':'#E2EEF6','--surface':'#D4E2F0','--panel':'#C6D6E6','--border':'#ACC4DA','--border-hi':'#8CB0CC','--cream':'#060E18','--cream-dim':'#28506C','--muted':'#7CA4C0', lcd:'#40A8FF','lcd-bg':'#06080E','lcd-border':'#101C2C' },
  { id:'elsa-light',      name:'Elsa',      accent:'#2E8CC0', hi:'#2480B4', '--bg':'#E4F0F8','--surface':'#D4E4F0','--panel':'#C4D8E8','--border':'#ACC8DC','--border-hi':'#8CB4D0','--cream':'#081420','--cream-dim':'#2C5C80','--muted':'#80ACCC', lcd:'#40A8FF','lcd-bg':'#060810','lcd-border':'#101C2C' },
  { id:'trooper-light',   name:'Trooper',   accent:'#5C7088', hi:'#4A6078', '--bg':'#E8ECF2','--surface':'#DCE2EA','--panel':'#D0D8E2','--border':'#BCC6D2','--border-hi':'#A0AEBC','--cream':'#101824','--cream-dim':'#4C5C70','--muted':'#94A0B0', lcd:'#E0E8F0','lcd-bg':'#08080C','lcd-border':'#1A1E28' },
  // Teals
  { id:'totoro-light',    name:'Totoro',    accent:'#4C7880', hi:'#406C74', '--bg':'#E4F0F0','--surface':'#D4E4E4','--panel':'#C8D8D8','--border':'#B0C4C4','--border-hi':'#90ACAC','--cream':'#081010','--cream-dim':'#305050','--muted':'#7CA0A0', lcd:'#A8E063','lcd-bg':'#060A06','lcd-border':'#121E10' },
  // Greens
  { id:'buzz-light',      name:'Buzz',      accent:'#2C9858', hi:'#248848', '--bg':'#E0F2EA','--surface':'#D0E8DC','--panel':'#C4DCD0','--border':'#ACC8BC','--border-hi':'#8CB8A4','--cream':'#061008','--cream-dim':'#285C3C','--muted':'#78AC90', lcd:'#40FF90','lcd-bg':'#040A06','lcd-border':'#0E1E14' },
  { id:'hulk-light',      name:'Hulk',      accent:'#38A020', hi:'#2C9018', '--bg':'#E4F2E0','--surface':'#D4E8D0','--panel':'#C8DCC0','--border':'#B0CCB0','--border-hi':'#90B888','--cream':'#061006','--cream-dim':'#2C5C20','--muted':'#80AC74', lcd:'#A8E063','lcd-bg':'#040A04','lcd-border':'#101E10' },
  { id:'shrek-light',     name:'Shrek',     accent:'#548820', hi:'#487818', '--bg':'#E8F0E0','--surface':'#DCE8D0','--panel':'#D0DCC4','--border':'#B8CCB0','--border-hi':'#9CB890','--cream':'#081008','--cream-dim':'#3C5820','--muted':'#8CA870', lcd:'#A8E063','lcd-bg':'#060A04','lcd-border':'#121E10' },
  { id:'yoda-light',      name:'Yoda',      accent:'#5C8830', hi:'#4C7828', '--bg':'#E8F0E4','--surface':'#DCE8D4','--panel':'#D0DEC8','--border':'#B8CCB0','--border-hi':'#98B48C','--cream':'#0C1808','--cream-dim':'#3C5C2C','--muted':'#88A87C', lcd:'#A8E063','lcd-bg':'#060A04','lcd-border':'#141E10' },
  // Earthy / Browns
  { id:'groot-light',     name:'Groot',     accent:'#805830', hi:'#704C28', '--bg':'#F0EAE0','--surface':'#E6DED0','--panel':'#DCD2C2','--border':'#CCC0AC','--border-hi':'#B4A890','--cream':'#100C06','--cream-dim':'#5C4820','--muted':'#A89870', lcd:'#A8E063','lcd-bg':'#060A04','lcd-border':'#141E10' },
  // Yellows / Golds
  { id:'pooh-light',      name:'Pooh',      accent:'#B07810', hi:'#9C6C08', '--bg':'#F4ECDA','--surface':'#E8E0C8','--panel':'#DCD4B6','--border':'#CCC49C','--border-hi':'#B8AC80','--cream':'#1C1808','--cream-dim':'#5C4C1C','--muted':'#A89868', lcd:'#E8A020','lcd-bg':'#0A0806','lcd-border':'#1E1810' },
  { id:'batman-light',    name:'Batman',    accent:'#B48C10', hi:'#A07C08', '--bg':'#F0F0E0','--surface':'#E4E4D0','--panel':'#D8D8C0','--border':'#C8C8A8','--border-hi':'#B0B08C','--cream':'#101004','--cream-dim':'#50500C','--muted':'#9C9C6C', lcd:'#E8A020','lcd-bg':'#0A0806','lcd-border':'#1C1810' },
  { id:'pikachu-light',   name:'Pikachu',   accent:'#C8A810', hi:'#B89808', '--bg':'#F6F2DC','--surface':'#ECE8CC','--panel':'#E2DCBC','--border':'#D4CCA4','--border-hi':'#C0B888','--cream':'#141004','--cream-dim':'#5C5018','--muted':'#A89C60', lcd:'#F8D030','lcd-bg':'#0A0804','lcd-border':'#1E1A0C' },
  { id:'minions-light',   name:'Minions',   accent:'#C89C10', hi:'#B88C08', '--bg':'#F4F0DC','--surface':'#EAE4CC','--panel':'#E0D8BC','--border':'#D0C8A4','--border-hi':'#BCB088','--cream':'#181404','--cream-dim':'#5C5020','--muted':'#A89C68', lcd:'#E8A020','lcd-bg':'#0A0804','lcd-border':'#201A0C' },
  { id:'spongebob-light', name:'SpongeBob', accent:'#C8A810', hi:'#B89808', '--bg':'#F4F0D8','--surface':'#ECE6C8','--panel':'#E2DAB8','--border':'#D2CC9C','--border-hi':'#C0B880','--cream':'#100E04','--cream-dim':'#5C5018','--muted':'#A89C60', lcd:'#40C8FF','lcd-bg':'#060A0E','lcd-border':'#101C28' },
  // Reds
  { id:'ironman-light',   name:'Iron Man',  accent:'#B82418', hi:'#A41C10', '--bg':'#F4ECE0','--surface':'#EAE0D2','--panel':'#DED4C4','--border':'#CCC0AC','--border-hi':'#B8A890','--cream':'#180806','--cream-dim':'#6C3C20','--muted':'#AC9070', lcd:'#40C8FF','lcd-bg':'#060A0E','lcd-border':'#101C28' },
  { id:'cartman-light',   name:'Cartman',   accent:'#CC2C20', hi:'#B82018', '--bg':'#F4EAEA','--surface':'#EADCDC','--panel':'#DED0D0','--border':'#D0BCBC','--border-hi':'#BCA0A0','--cream':'#140808','--cream-dim':'#6C3428','--muted':'#AC8480', lcd:'#40D8B0','lcd-bg':'#060A08','lcd-border':'#10201A' },
  { id:'deadpool-light',  name:'Deadpool',  accent:'#B41820', hi:'#A01018', '--bg':'#F4E6E8','--surface':'#EAD8DC','--panel':'#DECCD0','--border':'#CEB8BC','--border-hi':'#BC9CA0','--cream':'#140608','--cream-dim':'#6C2C34','--muted':'#AC7C84', lcd:'#FF4444','lcd-bg':'#0A0404','lcd-border':'#200E0E' },
  { id:'vader-light',     name:'Vader',     accent:'#B81820', hi:'#A01018', '--bg':'#F2E8E8','--surface':'#E8DCDC','--panel':'#DCD0D0','--border':'#CCB8B8','--border-hi':'#B89C9C','--cream':'#1C0808','--cream-dim':'#6C3030','--muted':'#A88080', lcd:'#FF4444','lcd-bg':'#0A0404','lcd-border':'#1E0E0E' },
  { id:'maul-light',      name:'D. Maul',   accent:'#B80808', hi:'#A00404', '--bg':'#F4E4E4','--surface':'#EAD6D6','--panel':'#DEC8C8','--border':'#D0B4B4','--border-hi':'#BC9898','--cream':'#140404','--cream-dim':'#6C2020','--muted':'#AC7070', lcd:'#FF2020','lcd-bg':'#0A0404','lcd-border':'#200C0C' },
  { id:'spidey-light',    name:'Spidey',    accent:'#C01828', hi:'#A81020', '--bg':'#F0E8EE','--surface':'#E4DCE4','--panel':'#D8D0DA','--border':'#C4B8C8','--border-hi':'#AC9CB4','--cream':'#100810','--cream-dim':'#584060','--muted':'#A088A0', lcd:'#4088FF','lcd-bg':'#080810','lcd-border':'#181828' },
  // Purples
  { id:'joker-light',     name:'Joker',     accent:'#7030B4', hi:'#6028A0', '--bg':'#EEE6F4','--surface':'#E2D8EC','--panel':'#D6CCE2','--border':'#C4B4D4','--border-hi':'#AC98C4','--cream':'#0E0814','--cream-dim':'#4C3468','--muted':'#9880B0', lcd:'#44FF44','lcd-bg':'#060A06','lcd-border':'#141E14' },
  { id:'thanos-light',    name:'Thanos',    accent:'#7830B0', hi:'#682898', '--bg':'#ECE4F4','--surface':'#E0D6EC','--panel':'#D4C8E2','--border':'#C0B0D4','--border-hi':'#A894C4','--cream':'#0E0614','--cream-dim':'#4C3070','--muted':'#9878B4', lcd:'#F0C020','lcd-bg':'#0A0804','lcd-border':'#1E180C' },
];

let themeMode = localStorage.getItem('themeMode') || 'light';
const root = document.documentElement;

function applyTheme(theme) {
  root.style.setProperty('--brass',         theme.accent);
  root.style.setProperty('--brass-hi',      theme.hi);
  root.style.setProperty('--brass-glow',    hexToRgba(theme.accent, 0.15));
  root.style.setProperty('--brass-glow-hi', hexToRgba(theme.accent, 0.5));
  ['--bg','--surface','--panel','--border','--border-hi','--cream','--cream-dim','--muted'].forEach(k => {
    root.style.setProperty(k, theme[k]);
  });
  const lcd    = theme.lcd    || '#a8e063';
  const lcdBg  = theme['lcd-bg']  || '#0a0a0a';
  root.style.setProperty('--lcd',          lcd);
  root.style.setProperty('--lcd-bg',       lcdBg);
  root.style.setProperty('--lcd-border',   theme['lcd-border'] || lcdBg);
  root.style.setProperty('--lcd-glow',     hexToRgba(lcd, 0.7));
  root.style.setProperty('--lcd-glow-far', hexToRgba(lcd, 0.3));
  root.style.setProperty('--lcd-ghost',    hexToRgba(lcd, 0.12));
  localStorage.setItem('selectedTheme', theme.id);
  document.querySelectorAll('.theme-swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.id === theme.id)
  );
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function getCounterpart(themeId, targetMode) {
  const baseId = themeId.replace(/-light$/, '');
  if (targetMode === 'light') {
    return THEMES_LIGHT.find(t => t.id === baseId + '-light') || THEMES_LIGHT[0];
  } else {
    return THEMES_DARK.find(t => t.id === baseId) || THEMES_DARK[0];
  }
}

const themeGrid = document.getElementById('themeGrid');

function buildThemeGrid() {
  themeGrid.innerHTML = '';
  const themes = themeMode === 'dark' ? THEMES_DARK : THEMES_LIGHT;
  themes.forEach(theme => {
    const sw = document.createElement('button');
    sw.className = 'theme-swatch';
    sw.dataset.id = theme.id;
    sw.innerHTML = `<div class="theme-dot" style="background:${theme.accent}"></div><span class="theme-label">${theme.name}</span>`;
    sw.addEventListener('click', () => applyTheme(theme));
    themeGrid.appendChild(sw);
  });
  const currentId = localStorage.getItem('selectedTheme');
  document.querySelectorAll('.theme-swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.id === currentId)
  );
}

// Popup open/close
const themePopup = document.getElementById('themePopup');
const themeBtn   = document.getElementById('themeBtn');
document.getElementById('themePopupClose').addEventListener('click', () => themePopup.classList.remove('open'));
themeBtn.addEventListener('click', (e) => { e.stopPropagation(); themePopup.classList.toggle('open'); });
document.addEventListener('click', (e) => { if (!themePopup.contains(e.target)) themePopup.classList.remove('open'); });

// Mode toggle
document.querySelectorAll('.theme-mode-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const newMode = btn.dataset.mode;
    if (newMode === themeMode) return;
    themeMode = newMode;
    localStorage.setItem('themeMode', themeMode);
    document.querySelectorAll('.theme-mode-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === themeMode));
    const currentId = localStorage.getItem('selectedTheme') || 'bluey-light';
    applyTheme(getCounterpart(currentId, themeMode));
    buildThemeGrid();
  });
});

// Restore saved theme
themeMode = localStorage.getItem('themeMode') || 'light';
document.querySelectorAll('.theme-mode-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === themeMode));
const savedId = localStorage.getItem('selectedTheme') || 'bluey-light';
const allThemes = themeMode === 'dark' ? THEMES_DARK : THEMES_LIGHT;
applyTheme(allThemes.find(t => t.id === savedId) || allThemes[0]);
buildThemeGrid();
