(async function() {
  const video = document.getElementById('camera-preview');
  const timerEl = document.getElementById('timer');
  const statusEl = document.getElementById('status');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const thresholdRange = document.getElementById('threshold-range');
  const thresholdVal = document.getElementById('threshold-val');
  const thresholdDisplay = document.getElementById('threshold-display');
  const loadingEl = document.getElementById('loading');
  const landingEl = document.getElementById('landing');
  const startBtn = document.getElementById('start-btn');
  const muteBtn = document.getElementById('mute-btn');
  const fxPrevBtn = document.getElementById('fx-prev');
  const fxNextBtn = document.getElementById('fx-next');
  const fxGearBtn = document.getElementById('fx-gear');
  const fxNameEl = document.getElementById('fx-name');
  const presetBtns = document.querySelectorAll('.quick-presets button');
  const breathPlaceholder = document.getElementById('breath-placeholder');

  let thresholdSec = 20 * 60;
  let sittingSec = 0;
  let personPresent = false;
  let lastSeenTime = 0;
  const GRACE_MS = 5000;
  let isWarning = false;
  let audioCtx = null;
  let warnInterval = null;
  let running = false;
  let muted = false;
  let detectTimeout = null;
  let tickInterval = null;
  let stream = null;

  initStats();

  // Hand gesture dismissal
  let handModel = null;
  let model = null;
  let openHandStart = null;
  const HAND_DISMISS_MS = 3000;
  let handDetectTimeout = null;

  const cameraContainer = document.getElementById('camera-wrap');

  // Camera canvas — tracking overlay + video FX
  const cameraCanvas = document.getElementById('camera-canvas');
  const cameraCtx = cameraCanvas.getContext('2d');
  let videoFxRAF = null;
  let activeVideoFx = localStorage.getItem('fbVideoFx') !== null ? Number(localStorage.getItem('fbVideoFx')) : 0;
  let lastDetectedBbox = null; // [x, y, w, h] in video native coords


  const videofxPreviewCanvas = document.getElementById('videofx-preview');
  const videofxPreviewCtx = videofxPreviewCanvas.getContext('2d');

  function drawTrackingBrackets(ctx, cw, ch) {
    if (!lastDetectedBbox) return;
    const sx = cw / (video.videoWidth || 320);
    const sy = ch / (video.videoHeight || 240);
    const [bx, by, bw, bh] = lastDetectedBbox.map((v, i) => v * (i % 2 === 0 ? sx : sy));
    const c = Math.min(18, bw * 0.25, bh * 0.25);
    ctx.save();
    ctx.strokeStyle = personPresent ? 'rgba(76,175,80,0.9)' : 'rgba(255,107,107,0.7)';
    ctx.lineWidth = 2;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(bx+c, by);     ctx.lineTo(bx, by);     ctx.lineTo(bx, by+c);
    ctx.moveTo(bx+bw-c, by);  ctx.lineTo(bx+bw, by);  ctx.lineTo(bx+bw, by+c);
    ctx.moveTo(bx, by+bh-c);  ctx.lineTo(bx, by+bh);  ctx.lineTo(bx+c, by+bh);
    ctx.moveTo(bx+bw-c, by+bh); ctx.lineTo(bx+bw, by+bh); ctx.lineTo(bx+bw, by+bh-c);
    ctx.stroke();
    ctx.restore();
  }

  function renderCameraLoop() {
    if (!running) { videoFxRAF = null; return; }
    if (video.readyState >= 2) {
      const cw = cameraCanvas.width, ch = cameraCanvas.height;
      if (activeVideoFx > 0) {
        cameraCtx.save(); cameraCtx.scale(-1, 1); cameraCtx.drawImage(video, -cw, 0, cw, ch); cameraCtx.restore();
        const imgData = cameraCtx.getImageData(0, 0, cw, ch);
        VIDEO_FX[activeVideoFx].apply(imgData);
        cameraCtx.putImageData(imgData, 0, 0);
        if (VIDEO_FX[activeVideoFx].overlay) VIDEO_FX[activeVideoFx].overlay(cameraCtx, cw, ch);
      } else {
        cameraCtx.clearRect(0, 0, cw, ch);
      }
      drawTrackingBrackets(cameraCtx, cw, ch);

      // Update modal preview if open
      if (document.getElementById('videofx-modal').classList.contains('open')) {
        const pw = videofxPreviewCanvas.width, ph = videofxPreviewCanvas.height;
        if (activeVideoFx > 0) {
          videofxPreviewCtx.drawImage(cameraCanvas, 0, 0, pw, ph);
        } else {
          videofxPreviewCtx.save(); videofxPreviewCtx.scale(-1, 1); videofxPreviewCtx.drawImage(video, -pw, 0, pw, ph); videofxPreviewCtx.restore();
          drawTrackingBrackets(videofxPreviewCtx, pw, ph);
        }
      }
    }
    videoFxRAF = requestAnimationFrame(renderCameraLoop);
  }

  // Anime effect
  const handFxCanvas = document.getElementById('hand-fx');
  const handFxCtx = handFxCanvas.getContext('2d');
  let handFxCx = 0.5, handFxCy = 0.5; // normalized hand position (0-1)
  let handFxRAF = null;
  let handFxBurstTime = 0;
  let activeHandFx = localStorage.getItem('fbHandFx') !== null ? Number(localStorage.getItem('fbHandFx')) : 2;

  function drawHandFx(ctx, w, h, progress, time) {
    ctx.clearRect(0, 0, w, h);
    if (progress <= 0 && handFxBurstTime === 0) return;

    const hx = handFxCx * w;
    const hy = handFxCy * h;

    // Burst effect when complete
    if (handFxBurstTime > 0) {
      const burstProgress = (Date.now() - handFxBurstTime) / 500;
      if (burstProgress < 1) {
        const burstR = burstProgress * Math.max(w, h) * 1.5;
        const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, burstR);
        grad.addColorStop(0, `rgba(255,255,255,${0.8 * (1 - burstProgress)})`);
        grad.addColorStop(0.3, `rgba(100,200,255,${0.6 * (1 - burstProgress)})`);
        grad.addColorStop(1, 'rgba(100,200,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      } else {
        handFxBurstTime = 0;
      }
      return;
    }

    // Translate so theme draw functions' (w/2, h/2) maps to actual hand position
    ctx.save();
    ctx.translate(hx - w / 2, hy - h / 2);
    HAND_FX_THEMES[activeHandFx].draw(ctx, w, h, progress, time);
    ctx.restore();
  }

  function animateHandFx() {
    if (!openHandStart && handFxBurstTime === 0) {
      handFxCtx.clearRect(0, 0, handFxCanvas.width, handFxCanvas.height);
      handFxRAF = null;
      return;
    }
    const elapsed = openHandStart ? Date.now() - openHandStart : 0;
    const progress = Math.min(elapsed / HAND_DISMISS_MS, 1);
    drawHandFx(handFxCtx, handFxCanvas.width, handFxCanvas.height, progress, Date.now() / 1000);
    handFxRAF = requestAnimationFrame(animateHandFx);
  }

  function startHandFx() {
    if (!handFxRAF) {
      handFxRAF = requestAnimationFrame(animateHandFx);
    }
  }

  function triggerBurst() {
    handFxBurstTime = Date.now();
    if (!handFxRAF) {
      handFxRAF = requestAnimationFrame(animateHandFx);
    }
  }

  // Hand FX Picker
  const handFxBtn = document.getElementById('handfx-btn');
  const handFxModal = document.getElementById('handfx-modal');
  const handFxGrid = document.getElementById('handfx-grid');
  const handFxClose = document.getElementById('handfx-close');

  const handFxCardCanvases = [];
  HAND_FX_THEMES.forEach((theme, i) => {
    const card = document.createElement('div');
    card.className = 'handfx-card' + (i === 0 ? ' selected' : '');
    card.dataset.index = i;
    const cvs = document.createElement('canvas');
    cvs.width = 100; cvs.height = 75;
    card.appendChild(cvs);
    const lbl = document.createElement('div');
    lbl.className = 'label';
    lbl.textContent = theme.name;
    card.appendChild(lbl);
    handFxGrid.appendChild(card);
    handFxCardCanvases.push(cvs);
    card.addEventListener('click', () => {
      handFxGrid.querySelectorAll('.handfx-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  let handFxPickerRAF = null;
  function animateHandFxPicker(ts) {
    if (!handFxModal.classList.contains('open')) { handFxPickerRAF = null; return; }
    const t = ts / 1000;
    const p = (Math.sin(t * 1.5) + 1) / 2 * 0.7 + 0.3; // Oscillate between 0.3 and 1
    handFxCardCanvases.forEach((cvs, i) => {
      const ctx = cvs.getContext('2d');
      ctx.clearRect(0, 0, 100, 75);
      HAND_FX_THEMES[i].draw(ctx, 100, 75, p, t);
    });
    handFxPickerRAF = requestAnimationFrame(animateHandFxPicker);
  }

  handFxBtn.addEventListener('click', () => {
    handFxModal.classList.add('open');
    const cards = handFxGrid.querySelectorAll('.handfx-card');
    cards.forEach((c, i) => c.classList.toggle('selected', i === activeHandFx));
    if (!handFxPickerRAF) handFxPickerRAF = requestAnimationFrame(animateHandFxPicker);
  });

  handFxClose.addEventListener('click', () => {
    const sel = handFxGrid.querySelector('.handfx-card.selected');
    if (sel) { activeHandFx = parseInt(sel.dataset.index); localStorage.setItem('fbHandFx', activeHandFx); }
    handFxModal.classList.remove('open');
  });

  handFxModal.addEventListener('click', (e) => {
    if (e.target === handFxModal) handFxModal.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && handFxModal.classList.contains('open')) {
      handFxModal.classList.remove('open');
    }
  });

  function updateThreshold(minutes) {
    thresholdSec = minutes * 60;
    thresholdVal.textContent = minutes;
    thresholdRange.value = minutes;
    thresholdDisplay.textContent = `Alarm after sitting ${minutes} min`;
    presetBtns.forEach(b => b.classList.toggle('selected', parseInt(b.dataset.min) === minutes));
  }

  // Settings
  settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('open'));
  thresholdRange.addEventListener('input', () => updateThreshold(parseInt(thresholdRange.value)));
  presetBtns.forEach(b => b.addEventListener('click', () => updateThreshold(parseInt(b.dataset.min))));

  // Mute
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.innerHTML = muted ? '<i data-lucide="volume-x"></i> Muted' : '<i data-lucide="volume-2"></i> Sound On';
    lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 14, height: 14}});
    muteBtn.classList.toggle('muted', muted);
    if (muted && warnInterval) {
      clearInterval(warnInterval);
      warnInterval = null;
    }
    if (!muted && isWarning) {
      playTone();
      warnInterval = setInterval(playTone, 3000);
    }
  });

  async function startCamera() {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = s;
    await new Promise(resolve => {
      if (video.videoWidth) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
    });
    const w = video.videoWidth;
    const h = video.videoHeight;
cameraContainer.style.aspectRatio = `${w} / ${h}`;
    cameraCanvas.width = w;
    cameraCanvas.height = h;
    handFxCanvas.width = w;
    handFxCanvas.height = h;
    return s;
  }

  // Start / Stop
  startBtn.addEventListener('click', async () => {
    if (!running) {
      try {
        stream = await startCamera();
      } catch(e) {
        alert('Camera access is required for monitoring.');
        return;
      }
      running = true;
      startBtn.innerHTML = '<i data-lucide="square"></i> Stop';
      lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 14, height: 14}});
      startBtn.classList.add('active');
      sittingSec = 0;
      isWarning = false;
      document.body.classList.remove('warning');
      detect();
      tickInterval = setInterval(tick, 1000);
      if (!videoFxRAF) videoFxRAF = requestAnimationFrame(renderCameraLoop);
    } else {
      stop();
    }
  });

  function stop() {
    running = false;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }
    if (videoFxRAF) { cancelAnimationFrame(videoFxRAF); videoFxRAF = null; }
    cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    lastDetectedBbox = null;
    startBtn.innerHTML = '<i data-lucide="play"></i> Start';
    lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 14, height: 14}});
    startBtn.classList.remove('active');
    personPresent = false;
    isWarning = false;
    sittingSec = 0;
    openHandStart = null;
    document.body.classList.remove('warning');
    if (warnInterval) { clearInterval(warnInterval); warnInterval = null; }
    if (detectTimeout) { clearTimeout(detectTimeout); detectTimeout = null; }
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    if (handDetectTimeout) { clearTimeout(handDetectTimeout); handDetectTimeout = null; }
    cancelAlarmAwayTimer();
    if (handFxRAF) { cancelAnimationFrame(handFxRAF); handFxRAF = null; }
    handFxCtx.clearRect(0, 0, handFxCanvas.width, handFxCanvas.height);
    closeAllOpenSessions();
    statusEl.textContent = 'Stopped';
    statusEl.className = 'stopped';
    timerEl.textContent = '00:00';
    timerEl.className = 'stopped';
  }

  // Audio helpers
  function _tone(ctx, type, freq, gain, startOffset, duration) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime + startOffset);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + startOffset);
    o.stop(ctx.currentTime + startOffset + duration + 0.05);
  }
  function _bell(ctx, freq, gain, duration, startOffset = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime + startOffset);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + startOffset);
    o.stop(ctx.currentTime + startOffset + duration + 0.05);
  }
  function _sweep(ctx, type, f0, f1, gain, duration) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(f1, ctx.currentTime + duration);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + duration + 0.05);
  }
  function _warble(ctx, baseFreq, depth, gain, duration) {
    const o = ctx.createOscillator(), lfo = ctx.createOscillator();
    const lfoG = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = baseFreq;
    lfo.frequency.value = 10; lfoG.gain.value = depth;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    o.connect(g); g.connect(ctx.destination);
    lfo.start(); o.start();
    lfo.stop(ctx.currentTime + duration + 0.05);
    o.stop(ctx.currentTime + duration + 0.05);
  }

  let activeAlarmSound = localStorage.getItem('fbAlarmSound') !== null ? Number(localStorage.getItem('fbAlarmSound')) : 15;
  const ALARM_SOUNDS = [
    { name: 'Classic Beep',    play: c => _tone(c,'square',880,0.3,0,0.3) },
    { name: 'Double Beep',     play: c => { _tone(c,'square',880,0.3,0,0.2); _tone(c,'square',880,0.3,0.3,0.2); } },
    { name: 'Triple Beep',     play: c => [0,0.28,0.56].forEach(t=>_tone(c,'square',880,0.3,t,0.2)) },
    { name: 'Rising Tone',     play: c => _sweep(c,'sine',440,1200,0.3,0.45) },
    { name: 'Falling Tone',    play: c => _sweep(c,'sine',1200,440,0.3,0.45) },
    { name: 'Warble',          play: c => _warble(c,660,200,0.28,0.5) },
    { name: 'Chime',           play: c => _bell(c,1047,0.3,0.7) },
    { name: 'Low Drone',       play: c => _tone(c,'square',220,0.25,0,0.5) },
    { name: 'High Ping',       play: c => _bell(c,1760,0.2,0.3) },
    { name: 'Siren',           play: c => [0,0.1,0.2,0.3,0.4,0.5].forEach((t,i)=>_tone(c,'square',i%2?440:880,0.22,t,0.1)) },
    { name: 'Soft Bell',       play: c => _bell(c,523,0.2,0.8) },
    { name: 'Alert',           play: c => _tone(c,'sawtooth',1000,0.2,0,0.25) },
    { name: 'Foghorn',         play: c => _tone(c,'sawtooth',110,0.3,0,0.65) },
    { name: 'Bird Tweet',      play: c => _warble(c,1760,400,0.15,0.3) },
    { name: 'Quick Blip',      play: c => _tone(c,'square',1200,0.3,0,0.08) },
    { name: 'Ascending',       play: c => [523,659,784].forEach((f,i)=>_bell(c,f,0.25,0.3,i*0.18)) },
    { name: 'Buzz',            play: c => _tone(c,'square',150,0.35,0,0.4) },
    { name: 'Ding',            play: c => _bell(c,784,0.25,0.55) },
    { name: 'Pulse',           play: c => [0,0.15,0.3,0.45].forEach(t=>_tone(c,'sine',660,0.22,t,0.12)) },
    { name: 'Two Tone',        play: c => { _tone(c,'square',660,0.25,0,0.2); _tone(c,'square',880,0.25,0.25,0.2); } },
  ];

  function playTone() {
    if (muted) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    ALARM_SOUNDS[activeAlarmSound].play(audioCtx);
  }

  function previewSound(index) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    ALARM_SOUNDS[index].play(audioCtx);
  }

  // Alarm sound picker
  const alarmSoundBtn = document.getElementById('alarm-sound-btn');
  const alarmSoundModal = document.getElementById('alarm-sound-modal');
  const alarmSoundList = document.getElementById('alarm-sound-list');
  const alarmSoundClose = document.getElementById('alarm-sound-close');

  ALARM_SOUNDS.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'alarm-sound-item' + (i === activeAlarmSound ? ' selected' : '');
    item.dataset.index = i;
    item.innerHTML = `<span class="sound-dot"></span><span class="sound-name">${s.name}</span>`;
    const previewBtn = document.createElement('button');
    previewBtn.className = 'alarm-sound-preview';
    previewBtn.textContent = '▶ Play';
    previewBtn.addEventListener('click', (e) => { e.stopPropagation(); previewSound(i); });
    item.appendChild(previewBtn);
    item.addEventListener('click', () => {
      alarmSoundList.querySelectorAll('.alarm-sound-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      previewSound(i);
    });
    alarmSoundList.appendChild(item);
  });

  alarmSoundBtn.addEventListener('click', () => {
    alarmSoundList.querySelectorAll('.alarm-sound-item').forEach((el, i) => el.classList.toggle('selected', i === activeAlarmSound));
    alarmSoundModal.classList.add('open');
    settingsPanel.classList.remove('open');
  });
  alarmSoundClose.addEventListener('click', () => {
    const sel = alarmSoundList.querySelector('.alarm-sound-item.selected');
    if (sel) { activeAlarmSound = parseInt(sel.dataset.index); localStorage.setItem('fbAlarmSound', activeAlarmSound); }
    alarmSoundModal.classList.remove('open');
  });
  alarmSoundModal.addEventListener('click', (e) => {
    if (e.target === alarmSoundModal) alarmSoundModal.classList.remove('open');
  });

  // Video FX picker
  const videofxBtn = document.getElementById('videofx-btn');
  const videofxModal = document.getElementById('videofx-modal');
  const videofxList = document.getElementById('videofx-list');
  const videofxClose = document.getElementById('videofx-close');

  VIDEO_FX.forEach((fx, i) => {
    const item = document.createElement('div');
    item.className = 'alarm-sound-item' + (i === activeVideoFx ? ' selected' : '');
    item.dataset.index = i;
    item.innerHTML = `<span class="sound-dot"></span><span class="sound-name">${fx.name}</span>`;
    item.addEventListener('click', () => {
      videofxList.querySelectorAll('.alarm-sound-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      activeVideoFx = i;
      localStorage.setItem('fbVideoFx', i);
    });
    videofxList.appendChild(item);
  });

  videofxBtn.addEventListener('click', () => {
    videofxList.querySelectorAll('.alarm-sound-item').forEach((el, i) => el.classList.toggle('selected', i === activeVideoFx));
    videofxModal.classList.add('open');
    settingsPanel.classList.remove('open');
    if (!running) {
      videofxPreviewCtx.fillStyle = '#0a0a15';
      videofxPreviewCtx.fillRect(0, 0, videofxPreviewCanvas.width, videofxPreviewCanvas.height);
      videofxPreviewCtx.fillStyle = '#444';
      videofxPreviewCtx.font = '13px sans-serif';
      videofxPreviewCtx.textAlign = 'center';
      videofxPreviewCtx.fillText('Start monitoring to preview', videofxPreviewCanvas.width/2, videofxPreviewCanvas.height/2);
    }
  });
  function updateFxDisplay() {
    fxNameEl.textContent = VIDEO_FX[activeVideoFx].name;
  }

  videofxClose.addEventListener('click', () => {
    videofxModal.classList.remove('open');
    updateFxDisplay();
  });
  videofxModal.addEventListener('click', (e) => { if (e.target === videofxModal) videofxModal.classList.remove('open'); });

  // FX bar: prev/next cycle, gear opens modal
  fxPrevBtn.addEventListener('click', () => {
    activeVideoFx = (activeVideoFx - 1 + VIDEO_FX.length) % VIDEO_FX.length;
    localStorage.setItem('fbVideoFx', activeVideoFx);
    updateFxDisplay();
  });
  fxNextBtn.addEventListener('click', () => {
    activeVideoFx = (activeVideoFx + 1) % VIDEO_FX.length;
    localStorage.setItem('fbVideoFx', activeVideoFx);
    updateFxDisplay();
  });
  fxGearBtn.addEventListener('click', () => {
    videofxList.querySelectorAll('.alarm-sound-item').forEach((el, i) => el.classList.toggle('selected', i === activeVideoFx));
    videofxModal.classList.add('open');
    settingsPanel.classList.remove('open');
    if (!running) {
      videofxPreviewCtx.fillStyle = '#0a0a15';
      videofxPreviewCtx.fillRect(0, 0, videofxPreviewCanvas.width, videofxPreviewCanvas.height);
      videofxPreviewCtx.fillStyle = '#444';
      videofxPreviewCtx.font = '13px sans-serif';
      videofxPreviewCtx.textAlign = 'center';
      videofxPreviewCtx.fillText('Start monitoring to preview', videofxPreviewCanvas.width/2, videofxPreviewCanvas.height/2);
    }
  });

  const testBtn = document.getElementById('test-btn');

  // Test alarm button
  testBtn.addEventListener('click', async () => {
    if (!running) {
      // Auto-start if not running
      try {
        stream = await startCamera();
      } catch(e) { /* camera optional for test */ }
      running = true;
      startBtn.innerHTML = '<i data-lucide="square"></i> Stop';
      lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 14, height: 14}});
      startBtn.classList.add('active');
      personPresent = true;
      detect();
      tickInterval = setInterval(tick, 1000);
      if (!videoFxRAF) videoFxRAF = requestAnimationFrame(renderCameraLoop);
    }
    // Trigger warning state immediately
    isWarning = true;
    document.body.classList.add('warning');
    playTone();
    if (!muted && !warnInterval) warnInterval = setInterval(playTone, 3000);
    statusEl.textContent = 'WARNING — Stand up!';
    statusEl.className = 'warn';
    timerEl.className = 'warn';
    // Start hand detection for dismissal
    if (!handDetectTimeout) detectHand();
  });


  lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 14, height: 14}});
  updateFxDisplay();

  const loadingText = document.getElementById('loading-text');
  const loadingBar = document.getElementById('loading-bar');

  // Animate progress bar toward a target using exponential creep
  let _creepRAF = null;
  function creepTo(target) {
    if (_creepRAF) cancelAnimationFrame(_creepRAF);
    function step() {
      const cur = parseFloat(loadingBar.style.width) || 0;
      const next = cur + (target - cur) * 0.035;
      loadingBar.style.width = next + '%';
      if (Math.abs(next - target) > 0.3) _creepRAF = requestAnimationFrame(step);
    }
    _creepRAF = requestAnimationFrame(step);
  }

  // Landing page CTA — load models with progress then start monitoring
  document.getElementById('landing-cta').addEventListener('click', async () => {
    landingEl.classList.add('hidden');
    loadingBar.style.width = '5%';
    loadingEl.style.display = 'flex';

    loadingText.textContent = 'Loading detection model…';
    creepTo(72);
    model = await cocoSsd.load();

    loadingBar.style.width = '80%';
    loadingText.textContent = 'Loading hand model…';
    creepTo(94);
    handModel = await handPoseDetection.createDetector(
      handPoseDetection.SupportedModels.MediaPipeHands,
      { runtime: 'mediapipe', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands', modelType: 'lite' }
    );

    loadingBar.style.width = '100%';
    await new Promise(r => setTimeout(r, 280));
    loadingEl.style.display = 'none';
    startBtn.click();
  });

  // Check if hand is open (fingers extended)
  function isOpenHand(hand) {
    const kp = hand.keypoints;
    if (kp.length < 21) return false;

    const wrist = kp[0];
    // tip indices: thumb=4, index=8, middle=12, ring=16, pinky=20
    // mcp/base indices: thumb=2, index=5, middle=9, ring=13, pinky=17
    const tips = [kp[4], kp[8], kp[12], kp[16], kp[20]];
    const bases = [kp[2], kp[5], kp[9], kp[13], kp[17]];

    let extendedCount = 0;
    for (let i = 0; i < 5; i++) {
      const tipDist = Math.hypot(tips[i].x - wrist.x, tips[i].y - wrist.y);
      const baseDist = Math.hypot(bases[i].x - wrist.x, bases[i].y - wrist.y);
      if (tipDist > baseDist * 1.05) extendedCount++;
    }
    return extendedCount >= 3; // At least 3 fingers extended
  }

  // Hand detection for alarm dismissal
  async function detectHand() {
    if (!isWarning || !running || !handModel) {
      openHandStart = null;
      return;
    }

    // Wait for video to have frames
    if (video.readyState < 2) {
      handDetectTimeout = setTimeout(detectHand, 300);
      return;
    }

    try {
      const hands = await handModel.estimateHands(video);
      const hasOpenHand = hands.some(h => isOpenHand(h));

      // Track palm center (average of wrist + middle finger base) for FX position
      if (hands.length > 0) {
        const kp = hands[0].keypoints;
        const palmX = (kp[0].x + kp[9].x) / 2;
        const palmY = (kp[0].y + kp[9].y) / 2;
        const vw = video.videoWidth || 320;
        const vh = video.videoHeight || 240;
        handFxCx = palmX / vw;
        handFxCy = palmY / vh;
      }

      if (hasOpenHand) {
        if (!openHandStart) {
          openHandStart = Date.now();
          startHandFx();
        } else {
          const elapsed = Date.now() - openHandStart;
          // Update status to show progress
          const remaining = Math.ceil((HAND_DISMISS_MS - elapsed) / 1000);
          if (remaining > 0) {
            statusEl.textContent = `Hold hand open: ${remaining}s`;
          }
          if (elapsed >= HAND_DISMISS_MS) {
            // Trigger burst effect then dismiss alarm
            triggerBurst();
            dismissAlarm();
            return;
          }
        }
      } else {
        openHandStart = null;
        if (isWarning) {
          statusEl.textContent = 'WARNING — Stand up!';
        }
      }
    } catch(e) { /* skip frame */ }

    handDetectTimeout = setTimeout(detectHand, 200);
  }

  function dismissAlarm() {
    cancelAlarmAwayTimer();
    isWarning = false;
    sittingSec = 0;
    openHandStart = null;
    document.body.classList.remove('warning');
    if (warnInterval) { clearInterval(warnInterval); warnInterval = null; }
    if (handDetectTimeout) { clearTimeout(handDetectTimeout); handDetectTimeout = null; }
    statusEl.textContent = 'Sitting';
    statusEl.className = 'sitting';
    timerEl.className = 'sitting';
    timerEl.textContent = '00:00';
    // Keep burst animation running briefly
    setTimeout(() => {
      if (!isWarning) {
        handFxCtx.clearRect(0, 0, handFxCanvas.width, handFxCanvas.height);
      }
    }, 600);
  }

  // Detection loop
  async function detect() {
    if (!running || !model) return;
    try {
      const predictions = await model.detect(video);
      const person = predictions.find(p => p.class === 'person' && p.score > 0.5);
      const trackPerson = predictions.find(p => p.class === 'person' && p.score > 0.2);
      if (trackPerson) lastDetectedBbox = trackPerson.bbox;
      if (person) {
        lastSeenTime = Date.now();
        if (!personPresent) { personPresent = true; onPresenceGained(); }
      } else if (personPresent && Date.now() - lastSeenTime > GRACE_MS) {
        personPresent = false;
        onPresenceLost(isWarning, dismissAlarm);
      }
    } catch(e) { /* skip frame */ }
    detectTimeout = setTimeout(detect, 1000);
  }

  // Breath animations
  const breathBtn = document.getElementById('breath-btn');
  const breathModal = document.getElementById('breath-modal');
  const breathGrid = document.getElementById('breath-grid');
  const breathClose = document.getElementById('breath-close');
  const breathNone = document.getElementById('breath-none');
  const breathCanvas = document.getElementById('breath-canvas');
  const breathCtx = breathCanvas.getContext('2d');
  const breathLabel = document.getElementById('breath-label');
  const breathOverlay = document.getElementById('breath-overlay');

  let activeBreath = localStorage.getItem('fbBreath') !== null ? Number(localStorage.getItem('fbBreath')) : -1;
  let breathRAF = null;

  // breathe cycle: 4s in, 4s out = 8s total
  function breathPhase(t) {
    const cycle = (t % 8000) / 8000;
    if (cycle < 0.5) return cycle * 2;
    return 1 - (cycle - 0.5) * 2;
  }
  function breathText(t) {
    const cycle = (t % 8000) / 8000;
    let label, sec;
    if (cycle < 0.5) {
      label = 'Breathe in';
      sec = Math.floor(cycle * 8) + 1;
    } else {
      label = 'Breathe out';
      sec = Math.floor((cycle - 0.5) * 8) + 1;
    }
    const dots = Array.from({length: 4}, (_, i) => i < sec ? '●' : '○').join('  ');
    return `${label}\n${dots}`;
  }

  const BW = 600, BH = 600;

  // Build picker grid
  const cardCanvases = [];
  BREATH_THEMES.forEach((theme, i) => {
    const card = document.createElement('div');
    card.className = 'breath-card';
    card.dataset.index = i;
    const cvs = document.createElement('canvas');
    cvs.width = 120; cvs.height = 120;
    card.appendChild(cvs);
    const lbl = document.createElement('div');
    lbl.className = 'label';
    lbl.textContent = theme.name;
    card.appendChild(lbl);
    breathGrid.appendChild(card);
    cardCanvases.push(cvs);
    card.addEventListener('click', () => {
      breathGrid.querySelectorAll('.breath-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Animate picker previews
  let pickerRAF = null;
  function animatePicker(ts) {
    if (!breathModal.classList.contains('open')) { pickerRAF = null; return; }
    const p = breathPhase(ts);
    cardCanvases.forEach((cvs, i) => {
      const c = cvs.getContext('2d');
      c.clearRect(0, 0, 120, 120);
      BREATH_THEMES[i].draw(c, 120, 120, p);
    });
    pickerRAF = requestAnimationFrame(animatePicker);
  }

  breathBtn.addEventListener('click', () => {
    breathModal.classList.add('open');
    if (activeBreath >= 0) {
      const cards = breathGrid.querySelectorAll('.breath-card');
      cards.forEach((c, i) => c.classList.toggle('selected', i === activeBreath));
    }
    if (!pickerRAF) pickerRAF = requestAnimationFrame(animatePicker);
  });

  breathClose.addEventListener('click', () => {
    const sel = breathGrid.querySelector('.breath-card.selected');
    if (sel) {
      activeBreath = parseInt(sel.dataset.index);
      localStorage.setItem('fbBreath', activeBreath);
      breathLabel.textContent = BREATH_THEMES[activeBreath].name;
      breathOverlay.style.display = '';
      breathPlaceholder.style.display = 'none';
      startBreathOverlay();
    }
    breathModal.classList.remove('open');
  });

  breathNone.addEventListener('click', () => {
    activeBreath = -1;
    localStorage.setItem('fbBreath', -1);
    breathOverlay.style.display = 'none';
    breathPlaceholder.style.display = '';
    if (breathRAF) { cancelAnimationFrame(breathRAF); breathRAF = null; }
    breathModal.classList.remove('open');
    breathGrid.querySelectorAll('.breath-card').forEach(c => c.classList.remove('selected'));
  });

  breathModal.addEventListener('click', (e) => {
    if (e.target === breathModal) breathModal.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && breathModal.classList.contains('open')) {
      breathModal.classList.remove('open');
    }
  });

  function startBreathOverlay() {
    if (breathRAF) cancelAnimationFrame(breathRAF);
    function loop(ts) {
      if (activeBreath < 0) return;
      breathCtx.clearRect(0, 0, BW, BH);
      const p = breathPhase(ts);
      BREATH_THEMES[activeBreath].draw(breathCtx, BW, BH, p);
      breathLabel.innerHTML = breathText(ts).replace('\n', '<br>');
      breathRAF = requestAnimationFrame(loop);
    }
    breathRAF = requestAnimationFrame(loop);
  }

  breathOverlay.style.display = 'none';

  initStatsModal();
  let tickCount = 0;

  // Timer tick
  function tick() {
    if (!running) return;
    if (++tickCount % 10 === 0) refreshTodayStats();
    if (personPresent) {
      if (!isWarning) sittingSec++;
      if (sittingSec >= thresholdSec && !isWarning) {
        isWarning = true;
        document.body.classList.add('warning');
        playTone();
        if (!muted) warnInterval = setInterval(playTone, 3000);
        // Start hand detection for dismissal
        if (!handDetectTimeout) detectHand();
      }
      if (isWarning) {
        statusEl.textContent = 'WARNING — Stand up!';
        statusEl.className = 'warn';
        timerEl.className = 'warn';
      } else {
        statusEl.textContent = 'Sitting';
        statusEl.className = 'sitting';
        timerEl.className = 'sitting';
      }
    } else {
      if (!isWarning) {
        statusEl.textContent = 'Away';
        statusEl.className = 'away';
        timerEl.className = 'away';
      }
      // isWarning + !personPresent: alarm keeps ringing until ALARM_AWAY_MS elapses
      // (alarmAwayTimer handles the delayed dismissal — nothing to do here)
    }
    const m = String(Math.floor(sittingSec / 60)).padStart(2, '0');
    const s = String(sittingSec % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }
})();