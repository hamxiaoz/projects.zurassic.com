'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const WPM_MAX_DISPLAY = 320;       // bar fills at this WPM
const ENROLL_DURATION  = 10;       // seconds for voice enrollment
const ALERT_COOLDOWN   = 10000;    // ms before re-alerting
const VAD_INTERVAL     = 100;      // ms between VAD checks
const VAD_THRESHOLD    = 18;       // average frequency energy (0-255) to consider as speech
const PITCH_TOLERANCE  = 0.35;     // fraction: how much pitch can vary and still match speaker

// Speed tiers (WPM)
const TIERS = [
  { name: 'slow',      min: 0,   max: 100, label: 'Slow',      cssClass: 'slow'      },
  { name: 'normal',    min: 100, max: 160, label: 'Normal',     cssClass: 'normal'    },
  { name: 'fast',      min: 160, max: 220, label: 'Fast',       cssClass: 'fast'      },
  { name: 'very-fast', min: 220, max: Infinity, label: 'Very Fast', cssClass: 'very-fast' },
];

// ── State ──────────────────────────────────────────────────────────────────
let audioCtx       = null;
let analyser       = null;
let micStream      = null;
let recognition    = null;
let isMonitoring   = false;
let vadInterval    = null;
let lastAlertTime  = 0;
let alertSuppressed = false;

// Rolling word segments: { words: number, durationMs: number, timestamp: number }
let segments = [];

// Voice profile (from enrollment)
let voiceProfile = loadVoiceProfile();

// Settings (from localStorage)
let settings = loadSettings();

// Current transcript state
let finalTranscript   = '';
let interimTranscript = '';

// Segment timing
let segmentStart = null;
let segmentWords = 0;

// ── DOM refs ───────────────────────────────────────────────────────────────
const wpmNumber      = document.getElementById('wpm-number');
const speedBar       = document.getElementById('speed-bar');
const speedTier      = document.getElementById('speed-tier');
const alertBanner    = document.getElementById('alert-banner');
const thresholdMarker = document.getElementById('threshold-marker');
const transcript     = document.getElementById('transcript');
const monitorBtn     = document.getElementById('monitor-btn');
const micIndicator   = document.getElementById('mic-indicator');
const enrollBtn      = document.getElementById('enroll-btn');
const enrollStatus   = document.getElementById('enroll-status');
const enrollTimer    = document.getElementById('enroll-timer');
const enrollBar      = document.getElementById('enroll-bar');
const enrolledIndicator = document.getElementById('enrolled-indicator');
const clearEnrollBtn = document.getElementById('clear-enroll-btn');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdValue  = document.getElementById('threshold-value');
const windowSlider    = document.getElementById('window-slider');
const windowValue     = document.getElementById('window-value');
const speakerIdToggle = document.getElementById('speaker-id-toggle');

// ── Initialise UI from saved state ─────────────────────────────────────────
thresholdSlider.value = settings.threshold;
thresholdValue.textContent = settings.threshold + ' WPM';
windowSlider.value    = settings.windowSec;
windowValue.textContent   = settings.windowSec + ' s';
speakerIdToggle.checked   = settings.useSpeakerId;
document.querySelector(`input[name="alert-mode"][value="${settings.alertMode}"]`).checked = true;

updateThresholdMarker();
updateEnrolledUI();

// ── Settings listeners ─────────────────────────────────────────────────────
thresholdSlider.addEventListener('input', () => {
  settings.threshold = parseInt(thresholdSlider.value, 10);
  thresholdValue.textContent = settings.threshold + ' WPM';
  saveSettings();
  updateThresholdMarker();
});

windowSlider.addEventListener('input', () => {
  settings.windowSec = parseInt(windowSlider.value, 10);
  windowValue.textContent = settings.windowSec + ' s';
  saveSettings();
});

speakerIdToggle.addEventListener('change', () => {
  settings.useSpeakerId = speakerIdToggle.checked;
  saveSettings();
});

document.querySelectorAll('input[name="alert-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    settings.alertMode = radio.value;
    saveSettings();
  });
});

// ── Monitor button ─────────────────────────────────────────────────────────
monitorBtn.addEventListener('click', () => {
  if (isMonitoring) {
    stopMonitoring();
  } else {
    startMonitoring();
  }
});

// ── Enroll button ──────────────────────────────────────────────────────────
enrollBtn.addEventListener('click', () => {
  if (enrollBtn.classList.contains('recording')) return; // already enrolling
  startEnrollment();
});

clearEnrollBtn.addEventListener('click', () => {
  voiceProfile = null;
  localStorage.removeItem('vp_voiceProfile');
  updateEnrolledUI();
});

// ── Monitoring ─────────────────────────────────────────────────────────────
async function startMonitoring() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Speech recognition is not supported in this browser.\nPlease use Chrome or Edge.');
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    alert('Microphone access is required. Please allow microphone permission and try again.');
    return;
  }

  // Audio context for VAD
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  const source = audioCtx.createMediaStreamSource(micStream);
  source.connect(analyser);

  // Speech recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  recognition.onstart = () => {
    segmentStart = Date.now();
    segmentWords = 0;
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text   = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += text + ' ';
        const words = countWords(text);
        const now   = Date.now();
        const durationMs = now - (segmentStart || now);

        if (words > 0 && durationMs > 500) {
          // Speaker ID check: skip if enrollment is active and pitch doesn't match
          const skipSegment = settings.useSpeakerId && voiceProfile &&
                              !currentPitchMatchesProfile();
          if (!skipSegment) {
            segments.push({ words, durationMs, timestamp: now });
          }
        }

        segmentStart = Date.now();
        segmentWords = 0;
      } else {
        interim += text;
        segmentWords = countWords(interim);
      }
    }
    interimTranscript = interim;
    updateTranscript();
    updateWPM();
  };

  recognition.onend = () => {
    // Auto-restart if we're still supposed to be monitoring
    if (isMonitoring) {
      try { recognition.start(); } catch (_) {}
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed') {
      alert('Microphone access was denied. Please allow permission and restart.');
      stopMonitoring();
    }
    // 'no-speech', 'network' etc. — auto-restart handles it
  };

  recognition.start();

  // VAD loop — gives a "voice active" signal separate from transcription
  vadInterval = setInterval(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    // Focus on speech frequencies ~100 Hz – 4 kHz
    const sampleRate = audioCtx.sampleRate;
    const binHz = sampleRate / analyser.fftSize;
    const lo = Math.floor(100 / binHz);
    const hi = Math.min(Math.floor(4000 / binHz), data.length - 1);

    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += data[i];
    const avg = sum / (hi - lo + 1);

    const isActive = avg > VAD_THRESHOLD;
    micIndicator.style.opacity = isActive ? '1' : '0.4';
  }, VAD_INTERVAL);

  isMonitoring = true;
  monitorBtn.textContent = 'Stop Monitoring';
  monitorBtn.classList.add('active');
  micIndicator.classList.remove('hidden');
  transcript.textContent = '';
  segments = [];
  finalTranscript = '';
  interimTranscript = '';
  updateWPM();
}

function stopMonitoring() {
  isMonitoring = false;

  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  if (vadInterval)  { clearInterval(vadInterval); vadInterval = null; }
  if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx)     { audioCtx.close(); audioCtx = null; analyser = null; }

  monitorBtn.textContent = 'Start Monitoring';
  monitorBtn.classList.remove('active');
  micIndicator.classList.add('hidden');
  alertBanner.classList.add('hidden');

  wpmNumber.textContent = '—';
  wpmNumber.className   = 'wpm-number';
  speedBar.style.width  = '0%';
  speedTier.textContent = '—';
  transcript.innerHTML  = 'Waiting for speech…';
}

// ── WPM calculation ─────────────────────────────────────────────────────────
function updateWPM() {
  pruneSegments();

  const totalWords = segments.reduce((s, seg) => s + seg.words, 0);
  const totalMs    = segments.reduce((s, seg) => s + seg.durationMs, 0);

  if (totalWords < 3 || totalMs < 2000) {
    wpmNumber.textContent = '—';
    wpmNumber.className   = 'wpm-number';
    speedBar.style.width  = '0%';
    speedTier.textContent = '—';
    alertBanner.classList.add('hidden');
    return;
  }

  const wpm  = Math.round((totalWords / totalMs) * 60000);
  const tier = getTier(wpm);
  const pct  = Math.min((wpm / WPM_MAX_DISPLAY) * 100, 100);

  wpmNumber.textContent = wpm;
  wpmNumber.className   = 'wpm-number ' + tier.cssClass;
  speedBar.style.width  = pct + '%';
  speedTier.textContent = tier.label;

  // Alert logic
  const shouldAlert = wpm >= settings.threshold;
  if (shouldAlert) {
    const now = Date.now();
    if (now - lastAlertTime > ALERT_COOLDOWN) {
      triggerAlert();
      lastAlertTime = now;
    }
    alertBanner.classList.remove('hidden');
  } else {
    alertBanner.classList.add('hidden');
  }
}

function pruneSegments() {
  const cutoff = Date.now() - settings.windowSec * 1000;
  segments = segments.filter(s => s.timestamp >= cutoff);
}

function getTier(wpm) {
  return TIERS.find(t => wpm >= t.min && wpm < t.max) || TIERS[TIERS.length - 1];
}

// ── Alert ───────────────────────────────────────────────────────────────────
function triggerAlert() {
  const mode = settings.alertMode;

  if (mode === 'visual' || mode === 'both') {
    alertBanner.classList.remove('hidden');
  }

  if (mode === 'audio' || mode === 'both') {
    playChime();
  }
}

function playChime() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Soft descending two-tone chime
  const notes = [880, 660];
  notes.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;

    const t = ctx.currentTime + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.start(t);
    osc.stop(t + 0.4);
  });

  // Close context after chime finishes
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1200);
}

// ── Voice Enrollment ─────────────────────────────────────────────────────────
let enrollStream    = null;
let enrollAudioCtx  = null;
let enrollAnalyser  = null;
let pitchSamples    = [];
let centroidSamples = [];

async function startEnrollment() {
  try {
    enrollStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (err) {
    alert('Microphone access is required for voice enrollment.');
    return;
  }

  enrollAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  enrollAnalyser = enrollAudioCtx.createAnalyser();
  enrollAnalyser.fftSize = 2048;
  enrollAnalyser.smoothingTimeConstant = 0.3;
  const src = enrollAudioCtx.createMediaStreamSource(enrollStream);
  src.connect(enrollAnalyser);

  pitchSamples    = [];
  centroidSamples = [];

  enrollBtn.classList.add('recording');
  enrollBtn.textContent = 'Recording…';
  enrollBtn.disabled    = true;
  enrollStatus.classList.remove('hidden');
  enrolledIndicator.classList.add('hidden');

  let elapsed = 0;
  enrollBar.style.transform = 'scaleX(1)';
  enrollTimer.textContent   = ENROLL_DURATION;

  const tick = setInterval(() => {
    elapsed++;
    const remaining = ENROLL_DURATION - elapsed;
    enrollTimer.textContent    = remaining;
    enrollBar.style.transform  = `scaleX(${remaining / ENROLL_DURATION})`;

    // Sample pitch and spectral centroid every second
    sampleVoiceFeatures();

    if (elapsed >= ENROLL_DURATION) {
      clearInterval(tick);
      finishEnrollment();
    }
  }, 1000);
}

function sampleVoiceFeatures() {
  if (!enrollAnalyser) return;
  const bufLen = enrollAnalyser.frequencyBinCount;
  const freqData = new Float32Array(bufLen);
  enrollAnalyser.getFloatFrequencyData(freqData);

  // Convert dB to linear magnitude
  const magnitudes = freqData.map(db => Math.pow(10, db / 20));

  const sampleRate = enrollAudioCtx.sampleRate;
  const binHz      = sampleRate / enrollAnalyser.fftSize;

  // Spectral centroid (weighted average frequency)
  let weightedSum = 0, magSum = 0;
  for (let i = 1; i < bufLen; i++) {
    const freq = i * binHz;
    if (freq < 80 || freq > 6000) continue;
    weightedSum += freq * magnitudes[i];
    magSum      += magnitudes[i];
  }
  const centroid = magSum > 0 ? weightedSum / magSum : 0;
  if (centroid > 100) centroidSamples.push(centroid);

  // Pitch via autocorrelation on time-domain data
  const timeBuf = new Float32Array(enrollAnalyser.fftSize);
  enrollAnalyser.getFloatTimeDomainData(timeBuf);
  const pitch = detectPitch(timeBuf, sampleRate);
  if (pitch > 50 && pitch < 600) pitchSamples.push(pitch);
}

function finishEnrollment() {
  // Clean up audio
  if (enrollStream)   { enrollStream.getTracks().forEach(t => t.stop()); enrollStream = null; }
  if (enrollAudioCtx) { enrollAudioCtx.close(); enrollAudioCtx = null; enrollAnalyser = null; }

  enrollBtn.classList.remove('recording');
  enrollBtn.textContent = 'Enroll My Voice (10s)';
  enrollBtn.disabled    = false;
  enrollStatus.classList.add('hidden');

  if (pitchSamples.length < 3) {
    alert('Not enough voice detected during enrollment. Please speak clearly for the full 10 seconds and try again.');
    return;
  }

  // Compute median pitch and centroid range
  pitchSamples.sort((a, b) => a - b);
  centroidSamples.sort((a, b) => a - b);

  const medianPitch    = pitchSamples[Math.floor(pitchSamples.length / 2)];
  const pitchP10       = pitchSamples[Math.floor(pitchSamples.length * 0.1)];
  const pitchP90       = pitchSamples[Math.floor(pitchSamples.length * 0.9)];
  const medianCentroid = centroidSamples.length > 0
    ? centroidSamples[Math.floor(centroidSamples.length / 2)]
    : 2000;

  voiceProfile = {
    pitchMin: pitchP10 * (1 - PITCH_TOLERANCE),
    pitchMax: pitchP90 * (1 + PITCH_TOLERANCE),
    medianPitch,
    medianCentroid,
  };

  saveVoiceProfile(voiceProfile);
  updateEnrolledUI();
}

// ── Pitch detection (autocorrelation) ─────────────────────────────────────
function detectPitch(buffer, sampleRate) {
  const SIZE        = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);

  // Compute RMS — skip if too quiet
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  // Autocorrelation
  const correlations = new Float32Array(MAX_SAMPLES);
  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let corr = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      corr += buffer[i] * buffer[i + offset];
    }
    correlations[offset] = corr;
  }

  // Find first drop then best peak
  let d = 0;
  while (d < MAX_SAMPLES && correlations[d] > correlations[d + 1]) d++;

  let maxCorr = -1, bestOffset = -1;
  for (let i = d; i < MAX_SAMPLES; i++) {
    if (correlations[i] > maxCorr) {
      maxCorr    = correlations[i];
      bestOffset = i;
    }
  }

  if (bestOffset <= 0 || maxCorr < correlations[0] * 0.5) return -1;
  return sampleRate / bestOffset;
}

// ── Real-time pitch comparison for speaker ID ──────────────────────────────
function currentPitchMatchesProfile() {
  if (!voiceProfile || !analyser || !audioCtx) return true; // no data → allow

  const timeBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(timeBuf);
  const pitch = detectPitch(timeBuf, audioCtx.sampleRate);

  if (pitch < 0) return false; // silence or undetectable

  return pitch >= voiceProfile.pitchMin && pitch <= voiceProfile.pitchMax;
}

// ── Transcript display ─────────────────────────────────────────────────────
function updateTranscript() {
  // Keep only last ~200 chars of final transcript for display
  const display = finalTranscript.slice(-200);
  transcript.innerHTML =
    `<span class="final">${escapeHtml(display)}</span>` +
    (interimTranscript
      ? `<span class="interim"> ${escapeHtml(interimTranscript)}</span>`
      : '');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Utilities ──────────────────────────────────────────────────────────────
function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function updateThresholdMarker() {
  const pct = Math.min((settings.threshold / WPM_MAX_DISPLAY) * 100, 100);
  thresholdMarker.style.left = pct + '%';
}

function updateEnrolledUI() {
  if (voiceProfile) {
    enrolledIndicator.classList.remove('hidden');
    enrollBtn.classList.add('hidden');
  } else {
    enrolledIndicator.classList.add('hidden');
    enrollBtn.classList.remove('hidden');
  }
}

// ── Persistence ────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('vp_settings') || '{}');
    return {
      threshold:     saved.threshold     ?? 160,
      alertMode:     saved.alertMode     ?? 'both',
      windowSec:     saved.windowSec     ?? 20,
      useSpeakerId:  saved.useSpeakerId  ?? false,
    };
  } catch (_) {
    return { threshold: 160, alertMode: 'both', windowSec: 20, useSpeakerId: false };
  }
}

function saveSettings() {
  localStorage.setItem('vp_settings', JSON.stringify(settings));
}

function loadVoiceProfile() {
  try {
    const raw = localStorage.getItem('vp_voiceProfile');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveVoiceProfile(profile) {
  localStorage.setItem('vp_voiceProfile', JSON.stringify(profile));
}
