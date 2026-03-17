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

  // ── Session history (IndexedDB) ───────────────────────────────────────────
  let statsDb = null;
  let openSitSession = null;  // { date, start } — written to DB on close
  let breakStart = null;      // timestamp when person left; written when they return or app stops
  let alarmAwayTimer = null;  // fires if person stays away 15s during alarm → real break
  const ALARM_AWAY_MS = 15000;

  (function initStatsDb() {
    const req = indexedDB.open('flowBreakDB', 1);
    req.onupgradeneeded = e => {
      const store = e.target.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      store.createIndex('date', 'date', { unique: false });
    };
    req.onsuccess = e => { statsDb = e.target.result; recoverStaleSession(); refreshTodayStats(); };
  })();

  function saveCheckpoint() {
    if (openSitSession) {
      localStorage.setItem('flowBreakSession', JSON.stringify({ type: 'sit', date: openSitSession.date, start: openSitSession.start }));
    } else if (breakStart) {
      localStorage.setItem('flowBreakSession', JSON.stringify({ type: 'break', date: todayKey(), start: breakStart }));
    }
  }

  function clearCheckpoint() {
    localStorage.removeItem('flowBreakSession');
  }

  function recoverStaleSession() {
    const raw = localStorage.getItem('flowBreakSession');
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      if (s.end) writeRecord({ date: s.date, type: s.type, start: s.start, end: s.end, durationMin: s.durationMin });
    } catch(e) {}
    clearCheckpoint();
  }

  async function refreshTodayStats() {
    const el = document.getElementById('today-stats');
    if (!el) return;
    let sessions = await fetchDaySessions(todayKey());
    // Append any in-progress session so the view reflects current state
    const now = Date.now();
    if (openSitSession && openSitSession.date === todayKey()) {
      sessions = [...sessions, { type: 'sit', date: openSitSession.date, start: openSitSession.start, end: now, durationMin: (now - openSitSession.start) / 60000 }];
    } else if (breakStart) {
      sessions = [...sessions, { type: 'break', date: todayKey(), start: breakStart, end: now, durationMin: (now - breakStart) / 60000 }];
    }
    if (sessions.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const totalSitMin = sessions.filter(s => s.type === 'sit').reduce((acc, s) => acc + s.durationMin, 0);
    const summaryEl = document.getElementById('today-stats-summary');
    if (summaryEl) summaryEl.textContent = totalSitMin >= 0.5 ? fmtMin(totalSitMin) + ' sitting' : '';
    renderDayTimeline(document.getElementById('today-timeline'), sessions);
    const list = document.getElementById('today-session-list');
    list.innerHTML = '';
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = `stats-row stats-row-${s.type}`;
      row.innerHTML = `<span class="stats-row-label">${s.type === 'sit' ? '● Sitting' : '○ Break'}</span>`
        + `<span class="stats-row-time">${fmtTime(s.start)} – ${fmtTime(s.end)}</span>`
        + `<span class="stats-row-dur">${fmtMin(s.durationMin)}</span>`;
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function writeRecord(rec) {
    if (!statsDb) return;
    const req = statsDb.transaction('sessions', 'readwrite').objectStore('sessions').add(rec);
    req.onsuccess = () => refreshTodayStats();
  }

  function closeSitSession() {
    if (!openSitSession) return;
    const now = Date.now();
    writeRecord({ date: openSitSession.date, type: 'sit', start: openSitSession.start, end: now, durationMin: (now - openSitSession.start) / 60000 });
    openSitSession = null;
    clearCheckpoint();
  }

  function closeBreakSession(endTime) {
    if (!breakStart) return;
    writeRecord({ date: todayKey(), type: 'break', start: breakStart, end: endTime, durationMin: (endTime - breakStart) / 60000 });
    breakStart = null;
    clearCheckpoint();
  }

  function onPresenceGained() {
    if (alarmAwayTimer) { clearTimeout(alarmAwayTimer); alarmAwayTimer = null; }
    closeBreakSession(Date.now());
    openSitSession = { date: todayKey(), start: Date.now() };
    saveCheckpoint();
    refreshTodayStats();
  }

  function onPresenceLost() {
    if (isWarning) {
      // Don't dismiss immediately — give ALARM_AWAY_MS before treating it as a real break
      alarmAwayTimer = setTimeout(() => {
        alarmAwayTimer = null;
        dismissAlarm();
        closeSitSession();
        breakStart = Date.now();
        saveCheckpoint();
      }, ALARM_AWAY_MS);
    } else {
      closeSitSession();
      breakStart = Date.now();
      saveCheckpoint();
    }
  }

  function closeAllOpenSessions() {
    closeSitSession();
    closeBreakSession(Date.now());
  }

  window.addEventListener('beforeunload', () => {
    const now = Date.now();
    if (openSitSession) {
      localStorage.setItem('flowBreakSession', JSON.stringify({ type: 'sit', date: openSitSession.date, start: openSitSession.start, end: now, durationMin: (now - openSitSession.start) / 60000 }));
    } else if (breakStart) {
      localStorage.setItem('flowBreakSession', JSON.stringify({ type: 'break', date: todayKey(), start: breakStart, end: now, durationMin: (now - breakStart) / 60000 }));
    }
    closeAllOpenSessions(); // best-effort async fallback
  });

  // Hand gesture dismissal
  let handModel = null;
  let model = null;
  let openHandStart = null;
  const HAND_DISMISS_MS = 3000;
  let handDetectTimeout = null;

  // Camera canvas — tracking overlay + video FX
  const cameraCanvas = document.getElementById('camera-canvas');
  const cameraCtx = cameraCanvas.getContext('2d');
  let videoFxRAF = null;
  let activeVideoFx = localStorage.getItem('fbVideoFx') !== null ? Number(localStorage.getItem('fbVideoFx')) : 0;
  let lastDetectedBbox = null; // [x, y, w, h] in video native coords

  // Predator thermal palette: maps 0-255 luma to FLIR-style heat colors
  // cold (dark) → deep blue → teal → green → yellow → orange → red → white-hot
  const _predatorPalette = (() => {
    const lut = new Uint8Array(256 * 3);
    const stops = [
      [0,   0,  0,  18],  // black-blue
      [40,  0,  0,  80],  // deep indigo
      [80,  0, 20, 140],  // dark blue
      [110, 0, 80, 180],  // blue
      [140, 0,160, 160],  // teal
      [165, 0,200,  80],  // cyan-green
      [185, 80,210,  0],  // green
      [205,200,200,  0],  // yellow
      [225,255,100,  0],  // orange
      [240,255, 20,  0],  // red-orange
      [250,255,  0,  0],  // red
      [255,255,255,220],  // white-hot
    ];
    for (let v = 0; v < 256; v++) {
      let lo = stops[0], hi = stops[stops.length-1];
      for (let s = 0; s < stops.length-1; s++) {
        if (v >= stops[s][0] && v <= stops[s+1][0]) { lo = stops[s]; hi = stops[s+1]; break; }
      }
      const span = hi[0] - lo[0] || 1;
      const t = (v - lo[0]) / span;
      lut[v*3]   = Math.round(lo[1] + (hi[1]-lo[1]) * t);
      lut[v*3+1] = Math.round(lo[2] + (hi[2]-lo[2]) * t);
      lut[v*3+2] = Math.round(lo[3] + (hi[3]-lo[3]) * t);
    }
    return lut;
  })();

  const VIDEO_FX = [
    { name: 'None' },
    { name: 'Terminator', apply(d) {
      const p = d.data, w = d.width;
      for (let i = 0; i < p.length; i += 4) {
        const row = Math.floor(i/4/w);
        const sl = row % 3 === 0 ? 0.65 : 1;
        const g = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        p[i]   = Math.min(255, g * 1.5 * sl);
        p[i+1] = Math.min(255, g * 0.12 * sl);
        p[i+2] = Math.min(255, g * 0.08 * sl);
      }
    }, overlay: (() => {
      let scanX = null, scanY = null, targetX = null, targetY = null, lastT = 0;
      const SPEED = 8.4; // px/s (slowed 30% from 12)
      return function(ctx, cw, ch) {
        const t = performance.now();
        const dt = lastT ? Math.min(50, t - lastT) : 0;
        lastT = t;
        // Scanning grid in top-right corner
        const gw = Math.round(cw * 0.28), gh = Math.round(ch * 0.28);
        const gx = cw - 12 - gw, gy = 12;
        const cols = 8, rows = 6;
        const cellW = gw / cols, cellH = gh / rows;
        // Init scan and target positions
        if (scanX === null) { scanX = Math.random() * gw; scanY = Math.random() * gh; }
        if (targetX === null) { targetX = Math.random() * gw; targetY = Math.random() * gh; }
        // Move cross toward target
        const dx = targetX - scanX, dy = targetY - scanY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const step = SPEED * dt / 1000;
        if (dist < step + 0.5) {
          scanX = targetX; scanY = targetY;
          targetX = Math.random() * gw; targetY = Math.random() * gh;
        } else {
          scanX += (dx / dist) * step;
          scanY += (dy / dist) * step;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(255,55,0,0.65)';
        ctx.lineWidth = 0.8;
        ctx.shadowColor = 'rgba(255,60,0,0.4)';
        ctx.shadowBlur = 3;
        for (let i = 0; i <= cols; i++) {
          ctx.beginPath(); ctx.moveTo(gx + i*cellW, gy); ctx.lineTo(gx + i*cellW, gy + gh); ctx.stroke();
        }
        for (let j = 0; j <= rows; j++) {
          ctx.beginPath(); ctx.moveTo(gx, gy + j*cellH); ctx.lineTo(gx + gw, gy + j*cellH); ctx.stroke();
        }
        // Cross lines converging on target point
        ctx.strokeStyle = 'rgba(255,130,40,0.95)';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(gx + scanX, gy); ctx.lineTo(gx + scanX, gy + gh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, gy + scanY); ctx.lineTo(gx + gw, gy + scanY); ctx.stroke();
        ctx.restore();
      };
    })()},
    { name: 'Terminator Mk II', apply(d) {
      // Red tint: preserve luminance detail, push heavily to red with vignette + scanlines
      const p = d.data, w = d.width, h = d.height;
      for (let i = 0; i < p.length; i += 4) {
        const x = (i/4) % w, y = Math.floor(i/4/w);
        const lum = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2;
        const vig = Math.max(0.25, 1 - (nx*nx + ny*ny) * 0.5);
        const scan = y % 3 === 0 ? 0.6 : 1.0;
        const v = lum * vig * scan;
        // Tinted red: blend original red channel with luminance boost, suppress others
        p[i]   = Math.min(255, p[i] * 0.45 * vig * scan + v * 1.1);
        p[i+1] = Math.min(255, p[i+1] * 0.08 * vig * scan);
        p[i+2] = Math.min(255, p[i+2] * 0.06 * vig * scan);
      }
    }, overlay(ctx, cw, ch) {
      // Full-width red scanning bar bouncing up and down
      const t = performance.now();
      let pos = (t * 0.09) % (ch * 2);
      if (pos > ch) pos = ch * 2 - pos;
      const barH = 18;
      const grad = ctx.createLinearGradient(0, pos - barH, 0, pos + barH);
      grad.addColorStop(0,   'rgba(255,0,0,0)');
      grad.addColorStop(0.3, 'rgba(255,30,0,0.55)');
      grad.addColorStop(0.5, 'rgba(255,60,0,0.9)');
      grad.addColorStop(0.7, 'rgba(255,30,0,0.55)');
      grad.addColorStop(1,   'rgba(255,0,0,0)');
      ctx.save();
      ctx.shadowColor = 'rgba(255,0,0,0.6)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = grad;
      ctx.fillRect(0, pos - barH, cw, barH * 2);
      ctx.restore();
    }},
    { name: 'Game Boy', apply(d) {
      const p = d.data, w = d.width, h = d.height;
      const bs = 7;
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          let r=0, g=0, b=0, cnt=0;
          for (let dy = 0; dy < bs && by+dy < h; dy++)
            for (let dx = 0; dx < bs && bx+dx < w; dx++) {
              const i = ((by+dy)*w + (bx+dx)) * 4;
              r += p[i]; g += p[i+1]; b += p[i+2]; cnt++;
            }
          r/=cnt; g/=cnt; b/=cnt;
          const nr = Math.min(255, r * 0.88 + 12);
          const ng = Math.min(255, g * 0.92 + 8);
          const nb = Math.min(255, b * 0.70);
          for (let dy = 0; dy < bs && by+dy < h; dy++)
            for (let dx = 0; dx < bs && bx+dx < w; dx++) {
              const i = ((by+dy)*w + (bx+dx)) * 4;
              const isGrid = dy === bs-1 || dx === bs-1;
              p[i]   = isGrid ? nr * 0.25 : nr;
              p[i+1] = isGrid ? ng * 0.25 : ng;
              p[i+2] = isGrid ? nb * 0.25 : nb;
            }
        }
      }
    }},
    { name: 'Apple Lisa', apply(d) {
      const p = d.data, w = d.width, h = d.height;
      const bs = 3;
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          let lum = 0, cnt = 0;
          for (let dy = 0; dy < bs && by+dy < h; dy++)
            for (let dx = 0; dx < bs && bx+dx < w; dx++) {
              const i = ((by+dy)*w + (bx+dx)) * 4;
              lum += 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2]; cnt++;
            }
          lum /= cnt;
          const v = lum > 128 ? Math.min(255, lum * 1.3 + 20) : Math.max(0, lum * 0.5);
          for (let dy = 0; dy < bs && by+dy < h; dy++)
            for (let dx = 0; dx < bs && bx+dx < w; dx++) {
              const i = ((by+dy)*w + (bx+dx)) * 4;
              p[i] = p[i+1] = Math.round(v);
              p[i+2] = Math.round(Math.min(255, v * 1.02 + 5));
            }
        }
      }
    }},
    { name: 'Predator', apply(d) {
      const p = d.data, lut = _predatorPalette;
      for (let i = 0; i < p.length; i += 4) {
        // Boost contrast before palette lookup so background reads cold, body reads hot
        const raw = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        const v = Math.min(255, Math.max(0, (raw - 60) * 1.45));
        const vi = Math.round(v) * 3;
        p[i]   = lut[vi];
        p[i+1] = lut[vi+1];
        p[i+2] = lut[vi+2];
      }
    }, overlay(ctx, cw, ch) {
      const alpha = (Math.sin(performance.now() * 0.0015) + 1) / 2; // slow pulse ~0.24Hz
      if (alpha < 0.02) return;
      const margin = 18;
      const R = Math.min(cw, ch) * 0.11;
      const r = R * 0.52;
      const cx = cw - margin - R * 0.9, cy = margin + R;
      ctx.save();
      ctx.strokeStyle = `rgba(210,40,80,${alpha * 0.95})`;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = `rgba(255,60,100,${alpha})`;
      ctx.shadowBlur = 12;
      // Outer triangle pointing up
      ctx.beginPath();
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx + R * 0.866, cy + R * 0.5);
      ctx.lineTo(cx - R * 0.866, cy + R * 0.5);
      ctx.closePath();
      ctx.stroke();
      // Inner triangle pointing down (inverted)
      ctx.beginPath();
      ctx.moveTo(cx, cy + r);
      ctx.lineTo(cx + r * 0.866, cy - r * 0.5);
      ctx.lineTo(cx - r * 0.866, cy - r * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }},
    { name: 'Matrix', apply(d) {
      const p = d.data, w = d.width, h = d.height;
      const bs = 5;
      for (let by = 0; by < h; by += bs) {
        for (let bx = 0; bx < w; bx += bs) {
          let lum = 0, cnt = 0;
          for (let dy = 0; dy < bs && by+dy < h; dy++)
            for (let dx = 0; dx < bs && bx+dx < w; dx++) {
              const i = ((by+dy)*w + (bx+dx)) * 4;
              lum += 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2]; cnt++;
            }
          lum /= cnt;
          const v = Math.min(255, lum * 1.35);
          for (let dy = 0; dy < bs && by+dy < h; dy++) {
            const scan = (by+dy) % 2 === 0 ? 0.6 : 1.0;
            for (let dx = 0; dx < bs && bx+dx < w; dx++) {
              const i = ((by+dy)*w + (bx+dx)) * 4;
              p[i]   = Math.round(v * 0.07 * scan);
              p[i+1] = Math.round(v * scan);
              p[i+2] = Math.round(v * 0.10 * scan);
            }
          }
        }
      }
    }, overlay: (() => {
      const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
      const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];
      let cols = [], lastT = 0, lastCw = -1;
      return function(ctx, cw, ch) {
        const t = performance.now();
        const dt = lastT ? Math.min(50, t - lastT) : 0;
        lastT = t;
        const FS = 11, OW = Math.round(cw * 0.22), OH = Math.round(ch * 0.70);
        const OX = cw - OW, OY = 0;
        const numCols = Math.floor(OW / FS), numRows = Math.ceil(OH / FS) + 2;
        // Init or resize
        if (lastCw !== cw || cols.length !== numCols) {
          lastCw = cw;
          cols = Array.from({ length: numCols }, (_, i) => ({
            x: OX + i * FS,
            y: -(1 + Math.random() * numRows) * FS,
            speed: 55 + Math.random() * 95,
            chars: Array.from({ length: numRows }, randomChar),
            mutateTimer: Math.random() * 120
          }));
        }
        // Update
        for (const col of cols) {
          col.y += col.speed * dt / 1000;
          col.mutateTimer -= dt;
          if (col.mutateTimer <= 0) {
            col.chars[Math.floor(Math.random() * numRows)] = randomChar();
            col.mutateTimer = 40 + Math.random() * 80;
          }
          if (col.y - numRows * FS > OH) {
            col.y = -(2 + Math.random() * numRows) * FS;
            col.speed = 55 + Math.random() * 95;
          }
        }
        // Draw
        ctx.save();
        ctx.beginPath();
        ctx.rect(OX, OY, OW, OH);
        ctx.clip();
        ctx.font = `bold ${FS}px monospace`;
        ctx.textBaseline = 'top';
        const trailLen = numRows * 0.55;
        for (const col of cols) {
          const headRow = Math.floor(col.y / FS);
          for (let r = headRow; r >= headRow - numRows; r--) {
            const charY = OY + r * FS;
            if (charY + FS < OY || charY > OY + OH) continue;
            const dist = headRow - r;
            const char = col.chars[((r % numRows) + numRows) % numRows];
            if (dist === 0) {
              ctx.shadowColor = 'rgba(180,255,180,0.9)';
              ctx.shadowBlur = 6;
              ctx.fillStyle = 'rgba(255,255,255,1.0)';
            } else {
              const fade = Math.max(0, 1 - dist / trailLen);
              if (fade < 0.03) continue;
              ctx.shadowBlur = 0;
              ctx.fillStyle = `rgba(0,${Math.round(180 + fade * 75)},40,${fade.toFixed(2)})`;
            }
            ctx.fillText(char, col.x, charY);
          }
        }
        ctx.restore();
      };
    })()},
    { name: 'RoboCop', apply(d) {
      // 80s VHS: chroma bleed, noise, scanlines, washed-out green cast
      const p = d.data, w = d.width, h = d.height;
      const bleed = 6; // chroma horizontal offset
      // First pass: desaturate + VHS color cast
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i+1], b = p[i+2];
        const lum = 0.299*r + 0.587*g + 0.114*b;
        // Blend toward lum (desaturate ~40%) then tint green-cast
        p[i]   = Math.min(255, lum * 0.4 + r * 0.6) * 0.82;
        p[i+1] = Math.min(255, lum * 0.4 + g * 0.6) * 0.96;
        p[i+2] = Math.min(255, lum * 0.4 + b * 0.6) * 0.70;
      }
      // Second pass: chroma bleed — shift green channel right, blue channel left
      const copy = new Uint8ClampedArray(p);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const gi = (y * w + Math.min(w - 1, x + bleed)) * 4;
          const bi = (y * w + Math.max(0, x - bleed)) * 4;
          p[i+1] = copy[gi+1];
          p[i+2] = copy[bi+2];
        }
      }
      // Third pass: scanlines + noise
      for (let i = 0; i < p.length; i += 4) {
        const row = Math.floor(i / 4 / w);
        const sl = row % 2 === 0 ? 0.78 : 1.0;
        const noise = (Math.random() - 0.5) * 18;
        p[i]   = Math.min(255, Math.max(0, p[i]   * sl + noise));
        p[i+1] = Math.min(255, Math.max(0, p[i+1] * sl + noise));
        p[i+2] = Math.min(255, Math.max(0, p[i+2] * sl + noise));
      }
    }, overlay: (() => {
      let scanX = null, scanY = null, targetX = null, targetY = null, lastT = 0;
      const SPEED = 8.4; // px/s — matches Terminator grid speed
      return function(ctx, cw, ch) {
        const t = performance.now();
        const dt = lastT ? Math.min(50, t - lastT) : 0;
        lastT = t;
        // Full-frame greenish grid
        const cols = 10, rows = 7;
        const cellW = cw / cols, cellH = ch / rows;
        ctx.save();
        ctx.strokeStyle = 'rgba(60,220,80,0.22)';
        ctx.lineWidth = 0.7;
        ctx.shadowColor = 'rgba(60,220,80,0.3)';
        ctx.shadowBlur = 2;
        for (let i = 0; i <= cols; i++) {
          ctx.beginPath(); ctx.moveTo(i * cellW, 0); ctx.lineTo(i * cellW, ch); ctx.stroke();
        }
        for (let j = 0; j <= rows; j++) {
          ctx.beginPath(); ctx.moveTo(0, j * cellH); ctx.lineTo(cw, j * cellH); ctx.stroke();
        }
        // Moving crosshair converging on a target — full-frame
        if (scanX === null) { scanX = Math.random() * cw; scanY = Math.random() * ch; }
        if (targetX === null) { targetX = Math.random() * cw; targetY = Math.random() * ch; }
        const dx = targetX - scanX, dy = targetY - scanY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const step = SPEED * dt / 1000;
        if (dist < step + 0.5) {
          scanX = targetX; scanY = targetY;
          targetX = Math.random() * cw; targetY = Math.random() * ch;
        } else {
          scanX += (dx / dist) * step;
          scanY += (dy / dist) * step;
        }
        ctx.strokeStyle = 'rgba(80,255,100,0.85)';
        ctx.lineWidth = 1.2;
        ctx.shadowColor = 'rgba(60,220,80,0.6)';
        ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.moveTo(scanX, 0); ctx.lineTo(scanX, ch); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(cw, scanY); ctx.stroke();
        ctx.restore();
      };
    })()},
    { name: 'CRT', apply(d) {
      const p = d.data, w = d.width, h = d.height;
      for (let i = 0; i < p.length; i += 4) {
        const x = (i/4) % w, y = Math.floor(i/4/w);
        const scan = y % 2 === 0 ? 0.72 : 1.0;
        const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2;
        const vig = Math.max(0.3, 1 - (nx*nx + ny*ny) * 0.55);
        const dim = scan * vig;
        p[i]   = Math.min(255, p[i]   * dim);
        p[i+1] = Math.min(255, p[i+1] * dim);
        p[i+2] = Math.min(255, p[i+2] * dim + 10);
      }
    }, overlay(ctx, cw, ch) {
      const t = performance.now();
      // Full-frame horizontal scan line
      let pos = (t * 0.08) % (ch * 2);
      if (pos > ch) pos = ch * 2 - pos;
      const grad = ctx.createLinearGradient(0, pos - 12, 0, pos + 12);
      grad.addColorStop(0, 'rgba(160,210,255,0)');
      grad.addColorStop(0.5, 'rgba(180,220,255,0.7)');
      grad.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, pos - 12, cw, 24);
      // Pulsing corner triangle
      const alpha = (Math.sin(t * 0.0015) + 1) / 2;
      if (alpha < 0.02) return;
      const size = Math.min(cw, ch) * 0.09;
      const margin = 14;
      ctx.save();
      ctx.fillStyle = `rgba(180,220,255,${alpha * 0.85})`;
      ctx.shadowColor = `rgba(160,210,255,${alpha})`;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(cw - margin, margin);
      ctx.lineTo(cw - margin - size, margin);
      ctx.lineTo(cw - margin, margin + size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }},
    { name: 'How flies see you', apply(d) {
      // Compound-eye hexagonal mosaic — flat-top hex grid via axial coordinates
      const p = d.data, w = d.width, h = d.height;
      const s = 5; // hex circumradius in pixels
      const sq3 = Math.sqrt(3);

      function hexKey(px, py) {
        const qf = (2 / 3 * px) / s;
        const rf = (-px / 3 + sq3 / 3 * py) / s;
        let x = qf, z = rf, y = -x - z;
        let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
        const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
        if (dx > dy && dx > dz) rx = -ry - rz;
        else if (dy > dz) ry = -rx - rz;
        else rz = -rx - ry;
        return rx * 100000 + rz;
      }

      // Pass 1: assign pixels to hex cells, accumulate color sums
      const hexIdx = new Int32Array(w * h);
      const hexColors = new Map();
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const key = hexKey(px, py);
          hexIdx[py * w + px] = key;
          const i = (py * w + px) * 4;
          let c = hexColors.get(key);
          if (!c) { c = [0, 0, 0, 0]; hexColors.set(key, c); }
          c[0] += p[i]; c[1] += p[i+1]; c[2] += p[i+2]; c[3]++;
        }
      }
      hexColors.forEach(c => { c[0] /= c[3]; c[1] /= c[3]; c[2] /= c[3]; });

      // Pass 2: write averaged hex color; darken pixels on cell boundaries
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const idx = py * w + px;
          const i = idx * 4;
          const key = hexIdx[idx];
          const border =
            (px > 0   && hexIdx[idx - 1] !== key) ||
            (px < w-1 && hexIdx[idx + 1] !== key) ||
            (py > 0   && hexIdx[idx - w] !== key) ||
            (py < h-1 && hexIdx[idx + w] !== key);
          if (border) {
            p[i] = p[i+1] = p[i+2] = 25;
          } else {
            const c = hexColors.get(key);
            p[i] = c[0]; p[i+1] = c[1]; p[i+2] = c[2];
          }
        }
      }
    }},
    { name: 'Glitch', apply(d) {
      const p = d.data, w = d.width;
      const off = 10;
      for (let i = 0; i < p.length; i += 4) {
        const x = (i/4) % w;
        const y = Math.floor(i/4/w);
        const ri = (y * w + Math.min(w-1, x+off)) * 4;
        const bi = (y * w + Math.max(0, x-off)) * 4;
        p[i]   = p[ri];
        p[i+2] = p[bi+2];
      }
    }},
    { name: 'Anime', apply(d) {
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        p[i]   = Math.round(p[i]   / 64) * 64;
        p[i+1] = Math.round(p[i+1] / 64) * 64;
        p[i+2] = Math.round(p[i+2] / 64) * 64;
      }
    }},
    { name: 'Night Vision', apply(d) {
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const g = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        const bright = Math.min(255, g * 1.6 + (Math.random()-0.5)*25);
        p[i]=0; p[i+1]=Math.max(0,Math.min(255,bright)); p[i+2]=0;
      }
    }},
    { name: 'Amber CRT', apply(d) {
      const p = d.data, w = d.width, h = d.height;
      for (let i = 0; i < p.length; i += 4) {
        const x = (i/4) % w, y = Math.floor(i/4/w);
        const scan = y % 2 === 0 ? 0.62 : 1.0;
        const nx = (x / w - 0.5) * 2, ny = (y / h - 0.5) * 2;
        const vig = Math.max(0.3, 1 - (nx*nx + ny*ny) * 0.5);
        const lum = (0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2]) / 255;
        const v = Math.min(1, lum * 1.5 * scan * vig);
        p[i]   = Math.round(Math.min(255, v * 280));
        p[i+1] = Math.round(v * 155);
        p[i+2] = 0;
      }
    }},
    { name: 'Heatmap', apply(d) {
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const g = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        const t = g / 255;
        if (t < 0.25)      { p[i]=0;   p[i+1]=Math.round(t*4*255); p[i+2]=255; }
        else if (t < 0.5)  { p[i]=0;   p[i+1]=255; p[i+2]=Math.round((0.5-t)*4*255); }
        else if (t < 0.75) { p[i]=Math.round((t-0.5)*4*255); p[i+1]=255; p[i+2]=0; }
        else               { p[i]=255; p[i+1]=Math.round((1-t)*4*255); p[i+2]=0; }
      }
    }},
    { name: 'X-Ray', apply(d) {
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const g = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        const v = Math.min(255, Math.max(0, (255 - g - 128) * 2.2 + 128));
        p[i] = p[i+1] = p[i+2] = v;
      }
    }},
    { name: 'Noir', apply(d) {
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const g = 0.299*p[i] + 0.587*p[i+1] + 0.114*p[i+2];
        const v = Math.min(255, Math.max(0, (g - 128) * 1.9 + 128));
        p[i] = p[i+1] = p[i+2] = v;
      }
    }},
    { name: 'Infrared', apply(d) {
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i+1], b = p[i+2];
        p[i]   = Math.min(255, b * 0.4 + (255-r) * 0.7);
        p[i+1] = Math.min(255, (r+g) * 0.35);
        p[i+2] = Math.min(255, (255-b) * 0.7 + r * 0.3);
      }
    }},
  ];

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

  const HAND_FX_THEMES = [
    { name: 'Energy Charge', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      // Aura
      const auraR = 30 + p * 20;
      const auraGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraR);
      auraGrad.addColorStop(0, `rgba(100,180,255,${0.1 + p * 0.2})`);
      auraGrad.addColorStop(1, 'rgba(100,150,255,0)');
      ctx.fillStyle = auraGrad; ctx.fillRect(0, 0, w, h);
      // Rings
      for (let i = 0; i < 3; i++) {
        const rp = (t * 2 + i * 0.4) % 1;
        ctx.beginPath(); ctx.arc(cx, cy, 10 + rp * 35 * p, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(100,200,255,${(1 - rp) * p * 0.6})`; ctx.lineWidth = 2; ctx.stroke();
      }
      // Particles
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 / 12) * i + t * 2;
        const d = 45 * (1 - p * 0.6);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + p * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.5 + p * 0.5})`; ctx.fill();
      }
      // Orb
      const orbR = 8 + p * 5 + Math.sin(t * 10) * 2 * p;
      const orbGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
      orbGrad.addColorStop(0, `rgba(255,255,255,${0.7 + p * 0.3})`);
      orbGrad.addColorStop(1, 'rgba(100,150,255,0)');
      ctx.fillStyle = orbGrad; ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.fill();
    }},
    { name: 'Fire Burst', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      // Flames
      for (let i = 0; i < 15; i++) {
        const a = (Math.PI * 2 / 15) * i + Math.sin(t * 3 + i) * 0.2;
        const len = (15 + p * 25) * (0.7 + Math.sin(t * 8 + i * 2) * 0.3);
        const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        grad.addColorStop(0, `rgba(255,200,50,${0.6 + p * 0.4})`);
        grad.addColorStop(0.5, `rgba(255,100,20,${0.4 + p * 0.3})`);
        grad.addColorStop(1, 'rgba(255,50,0,0)');
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.strokeStyle = grad; ctx.lineWidth = 3 + p * 2; ctx.lineCap = 'round'; ctx.stroke();
      }
      // Core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12 + p * 8);
      coreGrad.addColorStop(0, `rgba(255,255,200,${0.8 + p * 0.2})`);
      coreGrad.addColorStop(0.5, `rgba(255,150,50,${0.5 + p * 0.3})`);
      coreGrad.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = coreGrad; ctx.fillRect(cx - 20, cy - 20, 40, 40);
    }},
    { name: 'Lightning', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      // Background glow
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
      glow.addColorStop(0, `rgba(150,200,255,${p * 0.3})`);
      glow.addColorStop(1, 'rgba(100,150,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      // Bolts
      const bolts = 6 + Math.floor(p * 6);
      for (let i = 0; i < bolts; i++) {
        const a = (Math.PI * 2 / bolts) * i + t * 0.5;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        let x = cx, y = cy;
        const segments = 4 + Math.floor(p * 3);
        for (let j = 0; j < segments; j++) {
          const dist = (8 + p * 12) / segments;
          const jitter = (Math.random() - 0.5) * 8 * p;
          x += Math.cos(a) * dist + jitter * Math.cos(a + Math.PI/2);
          y += Math.sin(a) * dist + jitter * Math.sin(a + Math.PI/2);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(200,220,255,${0.4 + p * 0.5 + Math.random() * 0.2})`;
        ctx.lineWidth = 1 + p; ctx.stroke();
      }
    }},
    { name: 'Spiral Galaxy', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      const arms = 3;
      for (let a = 0; a < arms; a++) {
        for (let i = 0; i < 30; i++) {
          const angle = (Math.PI * 2 / arms) * a + (i / 30) * Math.PI * 2 * p + t;
          const dist = (5 + i * 1.2) * p;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          const size = (1 + (1 - i/30) * 2) * p;
          ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${220 + a * 40 + i * 2},80%,70%,${(1 - i/30) * p * 0.8})`; ctx.fill();
        }
      }
      // Core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8 + p * 4);
      coreGrad.addColorStop(0, `rgba(255,255,220,${0.6 + p * 0.4})`);
      coreGrad.addColorStop(1, 'rgba(255,255,200,0)');
      ctx.fillStyle = coreGrad; ctx.fillRect(cx - 12, cy - 12, 24, 24);
    }},
    { name: 'Hexagon Shield', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      for (let layer = 0; layer < 3; layer++) {
        const r = (15 + layer * 12) * (0.3 + p * 0.7);
        const rot = t * (layer % 2 ? 1 : -1) + layer * 0.3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + rot;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(100,255,200,${(0.3 + p * 0.4) * (1 - layer * 0.2)})`;
        ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = `rgba(100,255,200,${0.03 + p * 0.05})`; ctx.fill();
      }
    }},
    { name: 'Cherry Blossom', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      const petals = 12 + Math.floor(p * 8);
      for (let i = 0; i < petals; i++) {
        const a = (Math.PI * 2 / petals) * i + t * 0.3;
        const dist = 10 + p * 30 * (0.5 + Math.sin(t * 2 + i) * 0.5);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        const size = 3 + p * 3;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a + t);
        ctx.beginPath();
        ctx.moveTo(0, -size); ctx.quadraticCurveTo(size, 0, 0, size);
        ctx.quadraticCurveTo(-size, 0, 0, -size);
        ctx.fillStyle = `rgba(255,180,200,${0.3 + p * 0.4})`; ctx.fill();
        ctx.restore();
      }
      // Center glow
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10 + p * 5);
      cg.addColorStop(0, `rgba(255,220,230,${0.5 + p * 0.4})`);
      cg.addColorStop(1, 'rgba(255,200,210,0)');
      ctx.fillStyle = cg; ctx.fillRect(cx - 15, cy - 15, 30, 30);
    }},
    { name: 'Matrix Code', draw(ctx, w, h, p, t) {
      ctx.font = '8px monospace';
      const chars = '01アイウエオカキクケコ';
      const cols = 10;
      const rows = 8;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = (c / cols) * w + 5;
          const y = ((r + t * 3 + c * 0.3) % rows) / rows * h;
          const char = chars[Math.floor((t * 5 + c + r) % chars.length)];
          const alpha = (1 - r / rows) * p * 0.8;
          ctx.fillStyle = r === 0 ? `rgba(200,255,200,${alpha + 0.2})` : `rgba(0,255,100,${alpha})`;
          ctx.fillText(char, x, y);
        }
      }
    }},
    { name: 'Water Ripple', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      for (let i = 0; i < 5; i++) {
        const rp = (t * 0.8 + i * 0.2) % 1;
        const r = rp * 50 * p;
        const alpha = (1 - rp) * p * 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(100,180,255,${alpha})`; ctx.lineWidth = 2 + (1 - rp) * 2; ctx.stroke();
      }
      // Water sparkles
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 / 8) * i + t;
        const d = 20 * p + Math.sin(t * 3 + i) * 5;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,230,255,${0.4 + Math.sin(t * 5 + i) * 0.3})`; ctx.fill();
      }
    }},
    { name: 'Dragon Aura', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      // Swirling energy
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 4 + t * 3;
        const d = 5 + (i / 20) * 35 * p;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const size = (1 + (1 - i/20) * 3) * p;
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
        const hue = 30 - (i / 20) * 30;
        ctx.fillStyle = `hsla(${hue},100%,50%,${(1 - i/20) * p * 0.7})`; ctx.fill();
      }
      // Core flame
      const flameGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12 + p * 5);
      flameGrad.addColorStop(0, `rgba(255,255,200,${0.7 + p * 0.3})`);
      flameGrad.addColorStop(0.5, `rgba(255,150,0,${0.4 + p * 0.3})`);
      flameGrad.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.fillStyle = flameGrad; ctx.fillRect(cx - 17, cy - 17, 34, 34);
    }},
    { name: 'Neon Pulse', draw(ctx, w, h, p, t) {
      const cx = w/2, cy = h/2;
      const pulse = Math.sin(t * 8) * 0.3 + 0.7;
      // Concentric neon rings
      const colors = ['#ff00ff', '#00ffff', '#ff00ff'];
      for (let i = 0; i < 3; i++) {
        const r = (12 + i * 10) * (0.5 + p * 0.5) * pulse;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = colors[i]; ctx.lineWidth = 2;
        ctx.shadowColor = colors[i]; ctx.shadowBlur = 10 * p;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // Center dot
      ctx.beginPath(); ctx.arc(cx, cy, 4 + p * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.6 + pulse * 0.4})`; ctx.fill();
      // Cross flare
      if (p > 0.5) {
        const flareLen = (p - 0.5) * 2 * 30;
        ctx.strokeStyle = `rgba(255,255,255,${(p - 0.5) * 0.6})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - flareLen, cy); ctx.lineTo(cx + flareLen, cy);
        ctx.moveTo(cx, cy - flareLen); ctx.lineTo(cx, cy + flareLen);
        ctx.stroke();
      }
    }}
  ];

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
    lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 16, height: 16}});
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

  // Start / Stop
  startBtn.addEventListener('click', async () => {
    if (!running) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
        video.srcObject = stream;
      } catch(e) {
        alert('Camera access is required for monitoring.');
        return;
      }
      running = true;
      startBtn.innerHTML = '<i data-lucide="square"></i> Stop';
      lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 16, height: 16}});
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
    startBtn.innerHTML = '<i data-lucide="play"></i> Start Monitoring';
    lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 16, height: 16}});
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
    if (alarmAwayTimer) { clearTimeout(alarmAwayTimer); alarmAwayTimer = null; }
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
  videofxClose.addEventListener('click', () => videofxModal.classList.remove('open'));
  videofxModal.addEventListener('click', (e) => { if (e.target === videofxModal) videofxModal.classList.remove('open'); });

  const testBtn = document.getElementById('test-btn');

  // Test alarm button
  testBtn.addEventListener('click', async () => {
    if (!running) {
      // Auto-start if not running
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
        video.srcObject = stream;
      } catch(e) { /* camera optional for test */ }
      running = true;
      startBtn.innerHTML = '<i data-lucide="square"></i> Stop';
      lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 16, height: 16}});
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


  lucide.createIcons({nameAttr: 'data-lucide', attrs: {width: 16, height: 16}});

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
    if (alarmAwayTimer) { clearTimeout(alarmAwayTimer); alarmAwayTimer = null; }
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
        onPresenceLost();
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

  const BREATH_THEMES = [
    { name: 'Pulse Circle', draw(ctx, w, h, p) {
      const u = w/120;
      const r = 8*u + p * (w/2 - 12*u);
      ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(100,200,255,${0.15 + p*0.25})`; ctx.fill();
      ctx.strokeStyle = `rgba(100,200,255,${0.5 + p*0.4})`; ctx.lineWidth = 2*u; ctx.stroke();
    }},
    { name: 'Glow Ring', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 3; i >= 0; i--) {
        const r = 8*u + p * (w/2 - 15*u) + i * 4*u;
        ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(150,100,255,${0.15 - i*0.03})`; ctx.lineWidth = 3*u; ctx.stroke();
      }
    }},
    { name: 'Box Trace', draw(ctx, w, h, p) {
      const u = w/120;
      const m = 12*u, s = w - m*2;
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1*u;
      ctx.strokeRect(m, m, s, s);
      const perim = s * 4; const d = p * perim;
      let x, y;
      if (d < s) { x = m + d; y = m; }
      else if (d < s*2) { x = m + s; y = m + (d - s); }
      else if (d < s*3) { x = m + s - (d - s*2); y = m + s; }
      else { x = m; y = m + s - (d - s*3); }
      ctx.beginPath(); ctx.arc(x, y, 5*u, 0, Math.PI*2);
      ctx.fillStyle = '#4caf50'; ctx.fill();
    }},
    { name: 'Ripple', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 0; i < 3; i++) {
        const rp = (p + i * 0.33) % 1;
        const r = rp * (w/2 - 4*u);
        ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(0,200,150,${0.6 - rp*0.55})`; ctx.lineWidth = 2*u; ctx.stroke();
      }
    }},
    { name: 'Wave', draw(ctx, w, h, p) {
      const u = w/120;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const amp = 8*u + p * 20*u;
        const y = h/2 + Math.sin(x * 0.08 / u + p * Math.PI * 2) * amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(80,180,255,${0.4 + p*0.4})`; ctx.lineWidth = 2.5*u; ctx.stroke();
    }},
    { name: 'Flower', draw(ctx, w, h, p) {
      const u = w/120;
      const petals = 6, r = 10*u + p * 25*u;
      for (let i = 0; i < petals; i++) {
        const a = (Math.PI * 2 / petals) * i;
        const px = w/2 + Math.cos(a) * r * 0.6;
        const py = h/2 + Math.sin(a) * r * 0.6;
        ctx.beginPath(); ctx.arc(px, py, r * 0.45, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,120,180,${0.15 + p*0.15})`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(w/2, h/2, 5*u + p*4*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,200,100,${0.5 + p*0.3})`; ctx.fill();
    }},
    { name: 'Orbits', draw(ctx, w, h, p) {
      const u = w/120;
      const count = 5;
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 / count) * i + p * Math.PI * 2;
        const dist = 12*u + p * 25*u;
        const x = w/2 + Math.cos(a) * dist;
        const y = h/2 + Math.sin(a) * dist;
        ctx.beginPath(); ctx.arc(x, y, 4*u + p*3*u, 0, Math.PI*2);
        ctx.fillStyle = `hsla(${i*72}, 70%, 65%, ${0.4 + p*0.4})`; ctx.fill();
      }
    }},
    { name: 'Diamond', draw(ctx, w, h, p) {
      const u = w/120;
      const s = 8*u + p * 35*u;
      ctx.save(); ctx.translate(w/2, h/2); ctx.rotate(Math.PI/4);
      ctx.fillStyle = `rgba(100,220,200,${0.1 + p*0.2})`;
      ctx.fillRect(-s, -s, s*2, s*2);
      ctx.strokeStyle = `rgba(100,220,200,${0.5 + p*0.4})`; ctx.lineWidth = 2*u;
      ctx.strokeRect(-s, -s, s*2, s*2);
      ctx.restore();
    }},
    { name: 'Gradient Shift', draw(ctx, w, h, p) {
      const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
      g.addColorStop(0, `rgba(${Math.round(80+p*100)},100,${Math.round(255-p*100)},${0.3+p*0.3})`);
      g.addColorStop(1, 'rgba(26,26,46,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }},
    { name: 'Lungs', draw(ctx, w, h, p) {
      const u = w/120;
      const s = 0.6 + p * 0.4;
      ctx.save(); ctx.translate(w/2, h/2); ctx.scale(s, s);
      ctx.beginPath(); ctx.ellipse(-14*u, 0, 16*u, 28*u, -0.15, 0, Math.PI*2);
      ctx.fillStyle = `rgba(100,180,255,${0.15+p*0.2})`; ctx.fill();
      ctx.strokeStyle = `rgba(100,180,255,${0.5+p*0.3})`; ctx.lineWidth = 1.5*u/s; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(14*u, 0, 16*u, 28*u, 0.15, 0, Math.PI*2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -32*u); ctx.lineTo(0, -10*u);
      ctx.lineWidth = 2*u/s; ctx.stroke();
      ctx.restore();
    }},
    { name: 'Heartbeat', draw(ctx, w, h, p) {
      const u = w/120;
      const beat = Math.sin(p * Math.PI);
      const r = 15*u + beat * 20*u;
      ctx.beginPath();
      const cx = w/2, cy = h/2;
      ctx.moveTo(cx, cy + r*0.8);
      ctx.bezierCurveTo(cx - r*1.2, cy - r*0.2, cx - r*0.6, cy - r, cx, cy - r*0.4);
      ctx.bezierCurveTo(cx + r*0.6, cy - r, cx + r*1.2, cy - r*0.2, cx, cy + r*0.8);
      ctx.fillStyle = `rgba(255,80,80,${0.2 + beat*0.3})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,80,80,${0.5 + beat*0.4})`; ctx.lineWidth = 2*u; ctx.stroke();
    }},
    { name: 'Spiral', draw(ctx, w, h, p) {
      const u = w/120;
      ctx.beginPath();
      for (let i = 0; i < 200; i++) {
        const t = i / 200 * Math.PI * 6;
        const r = (5*u + t * 3*u * p);
        const x = w/2 + Math.cos(t) * r;
        const y = h/2 + Math.sin(t) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(200,150,255,${0.3 + p*0.4})`; ctx.lineWidth = 2*u; ctx.stroke();
    }},
    { name: 'Pendulum', draw(ctx, w, h, p) {
      const u = w/120;
      const angle = (p - 0.5) * Math.PI * 0.6;
      const len = 40*u;
      const px = w/2 + Math.sin(angle) * len;
      const py = 15*u + Math.cos(angle) * len;
      ctx.beginPath(); ctx.moveTo(w/2, 15*u); ctx.lineTo(px, py);
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5*u; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 8*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,200,100,${0.4 + p*0.4})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,200,100,0.6)`; ctx.lineWidth = 1.5*u; ctx.stroke();
    }},
    { name: 'Rings', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 0; i < 5; i++) {
        const phase = (p + i * 0.2) % 1;
        const r = 5*u + phase * 40*u;
        ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2);
        ctx.strokeStyle = `hsla(${180 + i*30}, 70%, 60%, ${0.5 - phase*0.45})`;
        ctx.lineWidth = 2.5*u; ctx.stroke();
      }
    }},
    { name: 'Jellyfish', draw(ctx, w, h, p) {
      const u = w/120;
      const squeeze = 0.7 + p * 0.3;
      ctx.save(); ctx.translate(w/2, h/2 - 5*u);
      // bell
      ctx.beginPath(); ctx.ellipse(0, 0, 22*u * squeeze, 18*u / squeeze, 0, Math.PI, 0);
      ctx.fillStyle = `rgba(150,100,255,${0.15 + p*0.2})`; ctx.fill();
      ctx.strokeStyle = `rgba(150,100,255,${0.4 + p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      // tentacles
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(i * 8*u, 0);
        const sway = Math.sin(p * Math.PI + i) * 5*u;
        ctx.quadraticCurveTo(i * 8*u + sway, 18*u, i * 8*u + sway*1.5, 32*u * (1 + p*0.3));
        ctx.strokeStyle = `rgba(150,100,255,${0.25 + p*0.15})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      }
      ctx.restore();
    }},
    { name: 'Sun Rays', draw(ctx, w, h, p) {
      const u = w/120;
      const rays = 12;
      const innerR = 10*u + p * 5*u;
      const outerR = 20*u + p * 25*u;
      for (let i = 0; i < rays; i++) {
        const a = (Math.PI * 2 / rays) * i;
        ctx.beginPath();
        ctx.moveTo(w/2 + Math.cos(a) * innerR, h/2 + Math.sin(a) * innerR);
        ctx.lineTo(w/2 + Math.cos(a) * outerR, h/2 + Math.sin(a) * outerR);
        ctx.strokeStyle = `rgba(255,200,50,${0.3 + p*0.4})`; ctx.lineWidth = 2.5*u; ctx.lineCap = 'round'; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(w/2, h/2, innerR, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,220,80,${0.3 + p*0.3})`; ctx.fill();
    }},
    { name: 'DNA Helix', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 0; i < 20; i++) {
        const t = i / 20;
        const y = h * 0.1 + t * h * 0.8;
        const x1 = w/2 + Math.sin(t * Math.PI * 4 + p * Math.PI * 2) * 20*u;
        const x2 = w/2 - Math.sin(t * Math.PI * 4 + p * Math.PI * 2) * 20*u;
        const z = Math.cos(t * Math.PI * 4 + p * Math.PI * 2);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y);
        ctx.strokeStyle = `rgba(100,200,200,${0.1 + Math.abs(z)*0.15})`; ctx.lineWidth = 1*u; ctx.stroke();
        const r = 3*u;
        ctx.beginPath(); ctx.arc(x1, y, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(100,220,255,${0.3 + z*0.3})`; ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,140,200,${0.3 - z*0.3})`; ctx.fill();
      }
    }},
    { name: 'Hourglass', draw(ctx, w, h, p) {
      const u = w/120;
      ctx.save(); ctx.translate(w/2, h/2);
      ctx.strokeStyle = `rgba(200,180,140,${0.4 + p*0.3})`; ctx.lineWidth = 2*u;
      ctx.beginPath(); ctx.moveTo(-20*u, -30*u); ctx.lineTo(20*u, -30*u);
      ctx.lineTo(3*u, -2*u); ctx.lineTo(20*u, 30*u); ctx.lineTo(-20*u, 30*u);
      ctx.lineTo(-3*u, -2*u); ctx.closePath(); ctx.stroke();
      // sand top
      const topH = (1 - p) * 22*u;
      if (topH > 0) {
        ctx.fillStyle = `rgba(220,190,120,0.4)`;
        ctx.fillRect(-15*u, -28*u, 30*u, topH);
      }
      // sand bottom
      const botH = p * 22*u;
      if (botH > 0) {
        ctx.fillStyle = `rgba(220,190,120,0.4)`;
        ctx.fillRect(-15*u, 28*u - botH, 30*u, botH);
      }
      ctx.restore();
    }},
    { name: 'Bubbles', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 0; i < 8; i++) {
        const seed = i * 137.5;
        const bx = w * 0.2 + (seed % 70) / 70 * w * 0.6;
        const by = h - (p + i * 0.12) % 1 * h * 0.9;
        const r = 4*u + (seed % 5) * 1.5*u;
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(120,200,255,${0.1 + ((seed % 3)/3)*0.15})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(120,200,255,${0.3 + ((seed % 3)/3)*0.2})`;
        ctx.lineWidth = 1*u; ctx.stroke();
      }
    }},
    { name: 'Lotus', draw(ctx, w, h, p) {
      const u = w/120;
      const layers = 3;
      for (let l = layers; l >= 1; l--) {
        const petals = 4 + l * 2;
        const spread = p * 0.8 + 0.2;
        const r = (8 + l * 8) * u * spread;
        for (let i = 0; i < petals; i++) {
          const a = (Math.PI * 2 / petals) * i + l * 0.15;
          ctx.save(); ctx.translate(w/2, h/2); ctx.rotate(a);
          ctx.beginPath(); ctx.ellipse(r * 0.5, 0, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
          const hue = 320 + l * 15;
          ctx.fillStyle = `hsla(${hue},60%,70%,${0.1 + p * 0.12})`; ctx.fill();
          ctx.strokeStyle = `hsla(${hue},60%,70%,${0.3 + p * 0.2})`; ctx.lineWidth = 1*u; ctx.stroke();
          ctx.restore();
        }
      }
      ctx.beginPath(); ctx.arc(w/2, h/2, 4*u + p*2*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,230,100,${0.4 + p*0.3})`; ctx.fill();
    }},
    { name: 'Galaxy', draw(ctx, w, h, p) {
      const u = w/120;
      const arms = 3;
      for (let a = 0; a < arms; a++) {
        const offset = (Math.PI*2/arms)*a;
        for (let i = 0; i < 40; i++) {
          const t = i/40;
          const angle = offset + t * Math.PI * 3 + p * Math.PI * 2;
          const dist = t * 42*u;
          const x = w/2 + Math.cos(angle) * dist;
          const y = h/2 + Math.sin(angle) * dist;
          const r = (1 + (1-t)*2.5)*u;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
          ctx.fillStyle = `hsla(${220+a*40+t*60},70%,70%,${0.15+(1-t)*0.4})`; ctx.fill();
        }
      }
      ctx.beginPath(); ctx.arc(w/2, h/2, 4*u+p*2*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,255,220,${0.5+p*0.3})`; ctx.fill();
    }},
    { name: 'Tree', draw(ctx, w, h, p) {
      const u = w/120;
      function branch(x, y, len, angle, depth) {
        if (depth <= 0 || len < 2*u) return;
        const ex = x + Math.cos(angle) * len;
        const ey = y + Math.sin(angle) * len;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(100,180,100,${0.2+depth*0.08})`; ctx.lineWidth = depth*0.8*u; ctx.stroke();
        const spread = 0.4 + p * 0.4;
        branch(ex, ey, len*0.7, angle-spread, depth-1);
        branch(ex, ey, len*0.7, angle+spread, depth-1);
      }
      branch(w/2, h*0.85, 25*u, -Math.PI/2, 7);
    }},
    { name: 'Aurora', draw(ctx, w, h, p) {
      const u = w/120;
      for (let band = 0; band < 5; band++) {
        ctx.beginPath();
        const yBase = h*0.2 + band*10*u;
        for (let x = 0; x < w; x++) {
          const wave = Math.sin(x*0.03/u + band + p*Math.PI*2) * 15*u * (0.5+p*0.5);
          const y = yBase + wave;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        for (let x = w; x >= 0; x--) {
          const wave = Math.sin(x*0.03/u + band + p*Math.PI*2) * 15*u * (0.5+p*0.5);
          ctx.lineTo(x, yBase + wave + 8*u);
        }
        ctx.closePath();
        ctx.fillStyle = `hsla(${140+band*30},70%,55%,${0.06+p*0.06})`; ctx.fill();
      }
    }},
    { name: 'Raindrop', draw(ctx, w, h, p) {
      const u = w/120;
      const s = 0.5 + p * 0.5;
      ctx.save(); ctx.translate(w/2, h/2); ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, -35*u);
      ctx.bezierCurveTo(-25*u, -5*u, -25*u, 20*u, 0, 30*u);
      ctx.bezierCurveTo(25*u, 20*u, 25*u, -5*u, 0, -35*u);
      ctx.fillStyle = `rgba(80,160,255,${0.15+p*0.2})`; ctx.fill();
      ctx.strokeStyle = `rgba(80,160,255,${0.4+p*0.3})`; ctx.lineWidth = 2*u/s; ctx.stroke();
      ctx.restore();
      // ripples at bottom
      for (let i = 0; i < 3; i++) {
        const rp = (p*2 + i*0.3) % 1;
        const r = rp * 30*u;
        ctx.beginPath(); ctx.ellipse(w/2, h/2 + 30*u*s, r, r*0.3, 0, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(80,160,255,${0.3-rp*0.28})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      }
    }},
    { name: 'Firefly', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 0; i < 15; i++) {
        const seed = i * 97.3;
        const cx = (seed * 3.1 % 80 + 20) / 120 * w;
        const cy = (seed * 2.7 % 80 + 20) / 120 * h;
        const flicker = Math.sin(p * Math.PI * 2 + seed) * 0.5 + 0.5;
        const r = (2 + flicker * 3) * u;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r*3);
        g.addColorStop(0, `rgba(255,240,100,${flicker*0.6})`);
        g.addColorStop(1, 'rgba(255,240,100,0)');
        ctx.fillStyle = g; ctx.fillRect(cx-r*3, cy-r*3, r*6, r*6);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,250,150,${flicker*0.8})`; ctx.fill();
      }
    }},
    { name: 'Moon Phases', draw(ctx, w, h, p) {
      const u = w/120;
      const r = 25*u;
      ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(220,220,200,${0.2+p*0.15})`; ctx.fill();
      ctx.strokeStyle = `rgba(220,220,200,${0.4+p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      // shadow
      ctx.save(); ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2); ctx.clip();
      const shadowX = w/2 + (p - 0.5) * r * 3;
      ctx.beginPath(); ctx.arc(shadowX, h/2, r*1.1, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(26,26,46,0.85)'; ctx.fill();
      ctx.restore();
    }},
    { name: 'Windmill', draw(ctx, w, h, p) {
      const u = w/120;
      const blades = 4;
      const spin = p * Math.PI * 2;
      ctx.save(); ctx.translate(w/2, h/2);
      for (let i = 0; i < blades; i++) {
        const a = spin + (Math.PI*2/blades)*i;
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(5*u, -35*u); ctx.lineTo(0, -30*u); ctx.closePath();
        ctx.fillStyle = `hsla(${i*90+200},50%,60%,${0.2+p*0.2})`; ctx.fill();
        ctx.strokeStyle = `hsla(${i*90+200},50%,60%,${0.4+p*0.3})`; ctx.lineWidth = 1*u; ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, 0, 3*u, 0, Math.PI*2);
      ctx.fillStyle = '#aaa'; ctx.fill();
      ctx.restore();
    }},
    { name: 'Constellation', draw(ctx, w, h, p) {
      const u = w/120;
      const stars = [
        [0.3,0.25],[0.5,0.15],[0.7,0.3],[0.6,0.5],[0.4,0.6],
        [0.25,0.45],[0.55,0.75],[0.75,0.65],[0.35,0.8],[0.8,0.45]
      ];
      const edges = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[3,7],[4,6],[6,8],[7,9]];
      const glow = 0.3 + p * 0.5;
      edges.forEach(([a,b]) => {
        ctx.beginPath();
        ctx.moveTo(stars[a][0]*w, stars[a][1]*h);
        ctx.lineTo(stars[b][0]*w, stars[b][1]*h);
        ctx.strokeStyle = `rgba(180,200,255,${glow*0.3})`; ctx.lineWidth = 1*u; ctx.stroke();
      });
      stars.forEach(([sx,sy], i) => {
        const twinkle = Math.sin(p*Math.PI*2 + i*1.5)*0.3+0.7;
        const r = (2+twinkle*2)*u;
        ctx.beginPath(); ctx.arc(sx*w, sy*h, r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(200,220,255,${glow*twinkle})`; ctx.fill();
      });
    }},
    { name: 'Candle', draw(ctx, w, h, p) {
      const u = w/120;
      // body
      ctx.fillStyle = 'rgba(240,220,180,0.25)';
      ctx.fillRect(w/2-8*u, h/2, 16*u, 30*u);
      ctx.strokeStyle = 'rgba(240,220,180,0.4)'; ctx.lineWidth = 1*u;
      ctx.strokeRect(w/2-8*u, h/2, 16*u, 30*u);
      // wick
      ctx.beginPath(); ctx.moveTo(w/2, h/2); ctx.lineTo(w/2, h/2-6*u);
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1*u; ctx.stroke();
      // flame
      const flicker = Math.sin(p*Math.PI*2)*2*u;
      const fs = 0.7+p*0.3;
      ctx.save(); ctx.translate(w/2+flicker, h/2-6*u);
      ctx.beginPath();
      ctx.moveTo(0, -22*u*fs);
      ctx.bezierCurveTo(-8*u*fs, -12*u*fs, -6*u*fs, 2*u, 0, 4*u);
      ctx.bezierCurveTo(6*u*fs, 2*u, 8*u*fs, -12*u*fs, 0, -22*u*fs);
      const fg = ctx.createRadialGradient(0, -8*u, 0, 0, -8*u, 18*u*fs);
      fg.addColorStop(0, `rgba(255,250,200,${0.5+p*0.3})`);
      fg.addColorStop(0.5, `rgba(255,160,50,${0.3+p*0.2})`);
      fg.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = fg; ctx.fill();
      ctx.restore();
    }},
    { name: 'Ocean Wave', draw(ctx, w, h, p) {
      const u = w/120;
      for (let layer = 0; layer < 4; layer++) {
        const yBase = h*0.4 + layer*12*u;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const amp = (10 + p*12)*u - layer*2*u;
          const freq = 0.04/u + layer*0.005/u;
          const y = yBase + Math.sin(x*freq + layer*0.8 + p*Math.PI*2) * amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        ctx.fillStyle = `hsla(${200+layer*10},60%,${40+layer*8}%,${0.12-layer*0.02+p*0.08})`; ctx.fill();
      }
    }},
    { name: 'Feather', draw(ctx, w, h, p) {
      const u = w/120;
      const sway = Math.sin(p * Math.PI * 2) * 8*u;
      const lift = (1 - p) * 20*u;
      ctx.save(); ctx.translate(w/2 + sway, h/2 + lift); ctx.rotate(sway * 0.02);
      // stem
      ctx.beginPath(); ctx.moveTo(0, -30*u); ctx.quadraticCurveTo(2*u, 0, 0, 30*u);
      ctx.strokeStyle = `rgba(200,180,150,${0.4+p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      // barbs
      for (let i = -8; i <= 8; i++) {
        const y = i * 3.5*u;
        const len = (18 - Math.abs(i)*1.2)*u * (0.7 + p*0.3);
        const curve = i * 0.15;
        ctx.beginPath(); ctx.moveTo(0, y);
        ctx.quadraticCurveTo(len*0.5, y + curve*len, len * (i > 0 ? -1 : 1), y + curve*len*2);
        ctx.strokeStyle = `rgba(180,160,140,${0.2+p*0.15})`; ctx.lineWidth = 1*u; ctx.stroke();
      }
      ctx.restore();
    }},
    { name: 'Balloon', draw(ctx, w, h, p) {
      const u = w/120;
      const s = 0.5 + p * 0.5;
      ctx.save(); ctx.translate(w/2, h/2 - 5*u);
      // string
      ctx.beginPath();
      for (let i = 0; i < 30; i++) {
        const t = i / 30;
        const y = 25*u*s + t * 30*u;
        const x = Math.sin(t * Math.PI * 3 + p * Math.PI) * 4*u;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(150,150,150,0.4)'; ctx.lineWidth = 1*u; ctx.stroke();
      // balloon
      ctx.beginPath();
      ctx.ellipse(0, 0, 20*u*s, 25*u*s, 0, 0, Math.PI*2);
      const grad = ctx.createRadialGradient(-5*u*s, -8*u*s, 0, 0, 0, 25*u*s);
      grad.addColorStop(0, `rgba(255,100,120,${0.3+p*0.25})`);
      grad.addColorStop(1, `rgba(200,50,70,${0.2+p*0.2})`);
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = `rgba(255,100,120,${0.5+p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      // knot
      ctx.beginPath(); ctx.moveTo(-3*u*s, 25*u*s); ctx.lineTo(0, 28*u*s); ctx.lineTo(3*u*s, 25*u*s);
      ctx.strokeStyle = `rgba(200,50,70,${0.4+p*0.3})`; ctx.lineWidth = 2*u; ctx.stroke();
      ctx.restore();
    }},
    { name: 'Snowflake', draw(ctx, w, h, p) {
      const u = w/120;
      const s = 0.4 + p * 0.6;
      ctx.save(); ctx.translate(w/2, h/2);
      const arms = 6;
      for (let i = 0; i < arms; i++) {
        ctx.save(); ctx.rotate((Math.PI*2/arms) * i);
        // main arm
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -35*u*s);
        ctx.strokeStyle = `rgba(180,220,255,${0.4+p*0.4})`; ctx.lineWidth = 2*u; ctx.stroke();
        // branches
        for (let j = 1; j <= 3; j++) {
          const y = -j * 10*u*s;
          const blen = (12 - j*2)*u*s;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(-blen, y - blen*0.5);
          ctx.moveTo(0, y); ctx.lineTo(blen, y - blen*0.5);
          ctx.strokeStyle = `rgba(180,220,255,${0.3+p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
        }
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, 0, 3*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(200,230,255,${0.5+p*0.4})`; ctx.fill();
      ctx.restore();
    }},
    { name: 'Mandala', draw(ctx, w, h, p) {
      const u = w/120;
      const layers = 4;
      for (let l = layers; l >= 1; l--) {
        const petals = 8 + l * 4;
        const r = (8 + l * 10)*u * (0.5 + p*0.5);
        for (let i = 0; i < petals; i++) {
          const a = (Math.PI*2/petals)*i + l*0.1 + p*0.3;
          const x = w/2 + Math.cos(a) * r;
          const y = h/2 + Math.sin(a) * r;
          ctx.beginPath(); ctx.arc(x, y, (6-l)*u, 0, Math.PI*2);
          ctx.fillStyle = `hsla(${l*60+p*60},60%,60%,${0.1+p*0.1})`; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(w/2, h/2, r, 0, Math.PI*2);
        ctx.strokeStyle = `hsla(${l*60},50%,50%,${0.15+p*0.15})`; ctx.lineWidth = 1*u; ctx.stroke();
      }
    }},
    { name: 'Atom', draw(ctx, w, h, p) {
      const u = w/120;
      const orbits = 3;
      for (let i = 0; i < orbits; i++) {
        const tilt = (Math.PI/orbits) * i;
        ctx.save(); ctx.translate(w/2, h/2); ctx.rotate(tilt);
        // orbit ellipse
        ctx.beginPath(); ctx.ellipse(0, 0, 35*u, 12*u, 0, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(100,180,255,${0.15+p*0.15})`; ctx.lineWidth = 1*u; ctx.stroke();
        // electron
        const angle = p * Math.PI * 2 + i * (Math.PI*2/orbits);
        const ex = Math.cos(angle) * 35*u;
        const ey = Math.sin(angle) * 12*u;
        ctx.beginPath(); ctx.arc(ex, ey, 4*u, 0, Math.PI*2);
        ctx.fillStyle = `rgba(100,200,255,${0.5+p*0.4})`; ctx.fill();
        ctx.restore();
      }
      // nucleus
      ctx.beginPath(); ctx.arc(w/2, h/2, 8*u + p*3*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,150,100,${0.3+p*0.3})`; ctx.fill();
    }},
    { name: 'Sound Waves', draw(ctx, w, h, p) {
      const u = w/120;
      const bars = 20;
      const barW = 4*u;
      const gap = 3*u;
      const totalW = bars * (barW + gap) - gap;
      const startX = (w - totalW) / 2;
      for (let i = 0; i < bars; i++) {
        const phase = (i / bars) * Math.PI + p * Math.PI * 2;
        const height = (8 + Math.sin(phase) * 25 * (0.3 + p*0.7)) * u;
        const x = startX + i * (barW + gap);
        ctx.fillStyle = `hsla(${180 + i*8},70%,60%,${0.3+p*0.3})`;
        ctx.fillRect(x, h/2 - height, barW, height * 2);
      }
    }},
    { name: 'Butterfly', draw(ctx, w, h, p) {
      const u = w/120;
      const wingOpen = 0.3 + p * 0.7;
      ctx.save(); ctx.translate(w/2, h/2);
      // left wing
      ctx.save(); ctx.scale(-wingOpen, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-15*u, -25*u, -40*u, -20*u, -35*u, 5*u);
      ctx.bezierCurveTo(-40*u, 25*u, -15*u, 25*u, 0, 10*u);
      ctx.fillStyle = `rgba(255,150,50,${0.15+p*0.2})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,150,50,${0.4+p*0.3})`; ctx.lineWidth = 1.5*u/wingOpen; ctx.stroke();
      // wing pattern
      ctx.beginPath(); ctx.arc(-20*u, -5*u, 8*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,100,150,${0.2+p*0.2})`; ctx.fill();
      ctx.restore();
      // right wing (mirror)
      ctx.save(); ctx.scale(wingOpen, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(15*u, -25*u, 40*u, -20*u, 35*u, 5*u);
      ctx.bezierCurveTo(40*u, 25*u, 15*u, 25*u, 0, 10*u);
      ctx.fillStyle = `rgba(255,150,50,${0.15+p*0.2})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,150,50,${0.4+p*0.3})`; ctx.lineWidth = 1.5*u/wingOpen; ctx.stroke();
      ctx.beginPath(); ctx.arc(20*u, -5*u, 8*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(255,100,150,${0.2+p*0.2})`; ctx.fill();
      ctx.restore();
      // body
      ctx.beginPath(); ctx.ellipse(0, 5*u, 3*u, 15*u, 0, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(80,60,40,0.5)'; ctx.fill();
      ctx.restore();
    }},
    { name: 'Yin Yang', draw(ctx, w, h, p) {
      const u = w/120;
      const r = 30*u + p*8*u;
      ctx.save(); ctx.translate(w/2, h/2); ctx.rotate(p * Math.PI * 2);
      // white half
      ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI/2, Math.PI/2);
      ctx.arc(0, r/2, r/2, Math.PI/2, -Math.PI/2, true);
      ctx.arc(0, -r/2, r/2, Math.PI/2, -Math.PI/2);
      ctx.fillStyle = `rgba(240,240,240,${0.2+p*0.2})`; ctx.fill();
      // black half
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI/2, -Math.PI/2);
      ctx.arc(0, -r/2, r/2, -Math.PI/2, Math.PI/2, true);
      ctx.arc(0, r/2, r/2, -Math.PI/2, Math.PI/2);
      ctx.fillStyle = `rgba(60,60,60,${0.3+p*0.2})`; ctx.fill();
      // dots
      ctx.beginPath(); ctx.arc(0, -r/2, r/6, 0, Math.PI*2);
      ctx.fillStyle = `rgba(240,240,240,${0.3+p*0.3})`; ctx.fill();
      ctx.beginPath(); ctx.arc(0, r/2, r/6, 0, Math.PI*2);
      ctx.fillStyle = `rgba(60,60,60,${0.4+p*0.3})`; ctx.fill();
      // outline
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(150,150,150,${0.3+p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      ctx.restore();
    }},
    { name: 'Honeycomb', draw(ctx, w, h, p) {
      const u = w/120;
      const hexR = 12*u;
      const hexH = hexR * Math.sqrt(3);
      const cols = 5, rows = 5;
      const offsetX = w/2 - (cols-1) * hexR * 1.5 / 2;
      const offsetY = h/2 - (rows-1) * hexH / 2;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = offsetX + col * hexR * 1.5;
          const y = offsetY + row * hexH + (col % 2) * hexH/2;
          const dist = Math.sqrt((x-w/2)**2 + (y-h/2)**2);
          const scale = 0.3 + p * 0.7 * Math.max(0, 1 - dist/(40*u));
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI/3) * i - Math.PI/6;
            const hx = x + Math.cos(a) * hexR * scale;
            const hy = y + Math.sin(a) * hexR * scale;
            i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          ctx.fillStyle = `rgba(255,200,80,${0.08+p*0.12*scale})`; ctx.fill();
          ctx.strokeStyle = `rgba(255,180,50,${0.2+p*0.3*scale})`; ctx.lineWidth = 1*u; ctx.stroke();
        }
      }
    }},
    { name: 'Starfield', draw(ctx, w, h, p) {
      const u = w/120;
      for (let i = 0; i < 30; i++) {
        const seed = i * 73.7;
        const angle = (seed % 360) * Math.PI / 180;
        const baseDist = 5*u + (seed % 50) * 0.8*u;
        const dist = baseDist + p * 20*u;
        const x = w/2 + Math.cos(angle) * dist;
        const y = h/2 + Math.sin(angle) * dist;
        const size = (1 + (seed % 3)) * u * (0.5 + p*0.5);
        const twinkle = Math.sin(p * Math.PI * 4 + seed) * 0.3 + 0.7;
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,255,240,${twinkle * (0.2+p*0.5)})`; ctx.fill();
      }
      // center glow
      const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, 15*u);
      grad.addColorStop(0, `rgba(255,255,200,${0.2+p*0.2})`);
      grad.addColorStop(1, 'rgba(255,255,200,0)');
      ctx.fillStyle = grad; ctx.fillRect(w/2-15*u, h/2-15*u, 30*u, 30*u);
    }},
    { name: 'Kaleidoscope', draw(ctx, w, h, p) {
      const u = w/120;
      const segments = 8;
      ctx.save(); ctx.translate(w/2, h/2);
      for (let s = 0; s < segments; s++) {
        ctx.save(); ctx.rotate((Math.PI*2/segments) * s);
        // triangle segment
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(40*u, 0);
        ctx.lineTo(40*u * Math.cos(Math.PI/segments), 40*u * Math.sin(Math.PI/segments));
        ctx.closePath();
        ctx.clip();
        // patterns inside
        for (let i = 0; i < 3; i++) {
          const r = (10 + i*12)*u * (0.5 + p*0.5);
          const hue = (s*45 + i*30 + p*60) % 360;
          ctx.beginPath(); ctx.arc(20*u, 8*u, r/2, 0, Math.PI*2);
          ctx.fillStyle = `hsla(${hue},70%,60%,${0.15+p*0.1})`; ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }},
    { name: 'Infinity', draw(ctx, w, h, p) {
      const u = w/120;
      // draw infinity symbol
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 2; t += 0.05) {
        const scale = 25*u;
        const x = w/2 + scale * Math.cos(t) / (1 + Math.sin(t)**2);
        const y = h/2 + scale * Math.sin(t) * Math.cos(t) / (1 + Math.sin(t)**2);
        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(150,100,200,${0.2+p*0.3})`; ctx.lineWidth = 3*u; ctx.stroke();
      // moving dot
      const t = p * Math.PI * 2;
      const scale = 25*u;
      const dx = w/2 + scale * Math.cos(t) / (1 + Math.sin(t)**2);
      const dy = h/2 + scale * Math.sin(t) * Math.cos(t) / (1 + Math.sin(t)**2);
      ctx.beginPath(); ctx.arc(dx, dy, 5*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(200,150,255,${0.5+p*0.4})`; ctx.fill();
      // glow trail
      for (let i = 1; i < 8; i++) {
        const tt = ((p - i*0.02) % 1 + 1) % 1 * Math.PI * 2;
        const tx = w/2 + scale * Math.cos(tt) / (1 + Math.sin(tt)**2);
        const ty = h/2 + scale * Math.sin(tt) * Math.cos(tt) / (1 + Math.sin(tt)**2);
        ctx.beginPath(); ctx.arc(tx, ty, (5-i*0.5)*u, 0, Math.PI*2);
        ctx.fillStyle = `rgba(200,150,255,${(0.3-i*0.035)})`; ctx.fill();
      }
    }},
    { name: 'Rose Curve', draw(ctx, w, h, p) {
      const u = w/120;
      const k = 5; // petals
      const maxR = 35*u * (0.4 + p*0.6);
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2; a += 0.02) {
        const r = maxR * Math.cos(k * a);
        const x = w/2 + r * Math.cos(a);
        const y = h/2 + r * Math.sin(a);
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.fillStyle = `rgba(255,100,150,${0.1+p*0.15})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,100,150,${0.4+p*0.4})`; ctx.lineWidth = 2*u; ctx.stroke();
    }},
    { name: 'Zen Circle', draw(ctx, w, h, p) {
      const u = w/120;
      const r = 32*u;
      const sweep = p * Math.PI * 1.8 + Math.PI * 0.15;
      ctx.save(); ctx.translate(w/2, h/2);
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI * 0.1, sweep);
      ctx.strokeStyle = `rgba(100,100,100,${0.3+p*0.4})`;
      ctx.lineWidth = 8*u * (0.5 + p*0.5);
      ctx.lineCap = 'round';
      ctx.stroke();
      // brush texture - varying thickness
      for (let i = 0; i < 20; i++) {
        const a = Math.PI * 0.1 + (sweep - Math.PI*0.1) * (i/20);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        const variance = Math.sin(i * 0.8) * 2*u;
        ctx.beginPath(); ctx.arc(x, y, 3*u + variance, 0, Math.PI*2);
        ctx.fillStyle = `rgba(80,80,80,${0.05+p*0.05})`; ctx.fill();
      }
      ctx.restore();
    }},
    { name: 'Crystal', draw(ctx, w, h, p) {
      const u = w/120;
      const s = 0.5 + p * 0.5;
      ctx.save(); ctx.translate(w/2, h/2);
      // main crystal body
      ctx.beginPath();
      ctx.moveTo(0, -40*u*s);
      ctx.lineTo(18*u*s, -10*u*s);
      ctx.lineTo(18*u*s, 25*u*s);
      ctx.lineTo(0, 40*u*s);
      ctx.lineTo(-18*u*s, 25*u*s);
      ctx.lineTo(-18*u*s, -10*u*s);
      ctx.closePath();
      const grad = ctx.createLinearGradient(-18*u*s, 0, 18*u*s, 0);
      grad.addColorStop(0, `rgba(100,200,255,${0.1+p*0.15})`);
      grad.addColorStop(0.5, `rgba(180,220,255,${0.15+p*0.2})`);
      grad.addColorStop(1, `rgba(100,180,255,${0.1+p*0.15})`);
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = `rgba(150,200,255,${0.4+p*0.4})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      // facet lines
      ctx.beginPath();
      ctx.moveTo(0, -40*u*s); ctx.lineTo(0, 40*u*s);
      ctx.moveTo(-18*u*s, -10*u*s); ctx.lineTo(18*u*s, 25*u*s);
      ctx.moveTo(18*u*s, -10*u*s); ctx.lineTo(-18*u*s, 25*u*s);
      ctx.strokeStyle = `rgba(200,230,255,${0.2+p*0.2})`; ctx.lineWidth = 1*u; ctx.stroke();
      ctx.restore();
    }},
    { name: 'Origami Crane', draw(ctx, w, h, p) {
      const u = w/120;
      const fold = 0.3 + p * 0.7;
      ctx.save(); ctx.translate(w/2, h/2);
      // body
      ctx.beginPath();
      ctx.moveTo(0, -15*u);
      ctx.lineTo(20*u * fold, 10*u);
      ctx.lineTo(0, 5*u);
      ctx.lineTo(-20*u * fold, 10*u);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,200,200,${0.15+p*0.15})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,150,150,${0.4+p*0.3})`; ctx.lineWidth = 1*u; ctx.stroke();
      // wings
      ctx.beginPath();
      ctx.moveTo(20*u * fold, 10*u);
      ctx.lineTo(35*u * fold, -5*u * fold);
      ctx.lineTo(25*u * fold, 5*u);
      ctx.fillStyle = `rgba(255,180,180,${0.12+p*0.12})`; ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-20*u * fold, 10*u);
      ctx.lineTo(-35*u * fold, -5*u * fold);
      ctx.lineTo(-25*u * fold, 5*u);
      ctx.fill(); ctx.stroke();
      // head
      ctx.beginPath();
      ctx.moveTo(0, -15*u);
      ctx.lineTo(8*u, -25*u * fold);
      ctx.lineTo(0, -20*u);
      ctx.fillStyle = `rgba(255,150,150,${0.2+p*0.2})`; ctx.fill();
      ctx.stroke();
      // tail
      ctx.beginPath();
      ctx.moveTo(0, 5*u);
      ctx.lineTo(0, 20*u * fold);
      ctx.strokeStyle = `rgba(255,150,150,${0.4+p*0.3})`; ctx.lineWidth = 2*u; ctx.stroke();
      ctx.restore();
    }},
    { name: 'Nebula', draw(ctx, w, h, p) {
      const u = w/120;
      // multiple overlapping clouds
      for (let i = 0; i < 5; i++) {
        const seed = i * 123.4;
        const cx = w/2 + Math.cos(seed) * 15*u;
        const cy = h/2 + Math.sin(seed) * 15*u;
        const r = (25 + i*8)*u * (0.5 + p*0.5);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const hue = (240 + i*30 + p*30) % 360;
        grad.addColorStop(0, `hsla(${hue},60%,50%,${0.15+p*0.1})`);
        grad.addColorStop(0.5, `hsla(${hue+30},50%,40%,${0.08+p*0.05})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx-r, cy-r, r*2, r*2);
      }
      // stars
      for (let i = 0; i < 15; i++) {
        const seed = i * 67.8;
        const sx = w*0.2 + (seed % 70)/70 * w*0.6;
        const sy = h*0.2 + ((seed*1.3) % 70)/70 * h*0.6;
        const twinkle = Math.sin(p*Math.PI*2 + seed)*0.5+0.5;
        ctx.beginPath(); ctx.arc(sx, sy, (1+twinkle)*u, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,255,255,${twinkle*0.6})`; ctx.fill();
      }
    }},
    { name: 'Metronome', draw(ctx, w, h, p) {
      const u = w/120;
      // base
      ctx.beginPath();
      ctx.moveTo(w/2 - 25*u, h/2 + 35*u);
      ctx.lineTo(w/2 + 25*u, h/2 + 35*u);
      ctx.lineTo(w/2 + 15*u, h/2 - 30*u);
      ctx.lineTo(w/2 - 15*u, h/2 - 30*u);
      ctx.closePath();
      ctx.fillStyle = `rgba(80,60,40,${0.2+p*0.1})`; ctx.fill();
      ctx.strokeStyle = `rgba(120,90,60,${0.4+p*0.2})`; ctx.lineWidth = 1.5*u; ctx.stroke();
      // pendulum
      const angle = (p - 0.5) * Math.PI * 0.5;
      const pivotY = h/2 - 25*u;
      const armLen = 50*u;
      const bobX = w/2 + Math.sin(angle) * armLen;
      const bobY = pivotY + Math.cos(angle) * armLen;
      ctx.beginPath();
      ctx.moveTo(w/2, pivotY);
      ctx.lineTo(bobX, bobY);
      ctx.strokeStyle = `rgba(200,180,150,${0.5+p*0.3})`; ctx.lineWidth = 2*u; ctx.stroke();
      ctx.beginPath(); ctx.arc(bobX, bobY, 6*u, 0, Math.PI*2);
      ctx.fillStyle = `rgba(220,200,100,${0.4+p*0.4})`; ctx.fill();
      ctx.strokeStyle = `rgba(200,180,80,${0.5+p*0.3})`; ctx.lineWidth = 1.5*u; ctx.stroke();
    }},
    { name: 'Dandelion', draw(ctx, w, h, p) {
      const u = w/120;
      // stem
      ctx.beginPath();
      ctx.moveTo(w/2, h/2 + 35*u);
      ctx.quadraticCurveTo(w/2 + 5*u, h/2, w/2, h/2 - 5*u);
      ctx.strokeStyle = 'rgba(100,150,80,0.4)'; ctx.lineWidth = 2*u; ctx.stroke();
      // seed head
      const seeds = 24;
      for (let i = 0; i < seeds; i++) {
        const a = (Math.PI * 2 / seeds) * i;
        const drift = p * 8*u * ((i % 3) / 3);
        const len = (15 + (i % 5) * 2)*u * (1 - p * ((i % 4) / 8));
        const sx = w/2 + drift * Math.cos(a + p);
        const sy = h/2 - 5*u - drift * 0.5;
        const ex = sx + Math.cos(a) * len;
        const ey = sy + Math.sin(a) * len * 0.7 - p * 3*u;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(240,240,230,${0.3-p*0.15*(i%3)})`;
        ctx.lineWidth = 0.5*u; ctx.stroke();
        // pappus (fluff)
        for (let j = 0; j < 5; j++) {
          const pa = a + (j - 2) * 0.3;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex + Math.cos(pa) * 4*u, ey + Math.sin(pa) * 4*u - 2*u);
          ctx.strokeStyle = `rgba(255,255,250,${0.2-p*0.1*(i%3)})`; ctx.stroke();
        }
      }
    }},
    { name: 'Mountain Mist', draw(ctx, w, h, p) {
      const u = w/120;
      // back mountain
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w*0.2, h*0.45);
      ctx.lineTo(w*0.35, h*0.55);
      ctx.lineTo(w*0.5, h*0.35);
      ctx.lineTo(w*0.65, h*0.5);
      ctx.lineTo(w*0.8, h*0.4);
      ctx.lineTo(w, h*0.55);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(60,70,90,${0.25+p*0.1})`; ctx.fill();
      // front mountain
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w*0.15, h*0.6);
      ctx.lineTo(w*0.4, h*0.7);
      ctx.lineTo(w*0.55, h*0.5);
      ctx.lineTo(w*0.75, h*0.65);
      ctx.lineTo(w, h*0.6);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(40,50,70,${0.3+p*0.15})`; ctx.fill();
      // mist layers
      for (let i = 0; i < 4; i++) {
        const yBase = h*0.5 + i*10*u;
        const drift = Math.sin(p*Math.PI*2 + i) * 10*u;
        ctx.beginPath();
        ctx.moveTo(-20*u + drift, yBase);
        for (let x = 0; x < w + 40*u; x += 20*u) {
          const y = yBase + Math.sin(x*0.02/u + i + p*Math.PI*2) * 8*u;
          ctx.lineTo(x + drift, y);
        }
        ctx.lineTo(w + 20*u, h);
        ctx.lineTo(-20*u, h);
        ctx.closePath();
        ctx.fillStyle = `rgba(180,190,210,${0.06+p*0.04-i*0.01})`; ctx.fill();
      }
    }}
  ];

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

  // ── Stats modal ───────────────────────────────────────────────────────────
  const statsBtn      = document.getElementById('stats-btn');
  const statsModal    = document.getElementById('stats-modal');
  const statsClose    = document.getElementById('stats-close');
  const weekChartCvs  = document.getElementById('week-chart');
  const statsSummary  = document.getElementById('stats-summary');

  let weekChartMeta = null; // { dayKeys, colX, colW } for click mapping

  statsBtn.addEventListener('click', () => { statsModal.classList.add('open'); showWeekView(); });
  statsClose.addEventListener('click', () => statsModal.classList.remove('open'));
  statsModal.addEventListener('click', e => { if (e.target === statsModal) statsModal.classList.remove('open'); });

  function last7DayKeys() {
    const keys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return keys;
  }

  function fetchDailyTotals(days) {
    return new Promise(resolve => {
      if (!statsDb) { resolve({}); return; }
      const result = {};
      days.forEach(d => result[d] = { sitMin: 0, breakMin: 0, count: 0 });
      const tx = statsDb.transaction('sessions', 'readonly');
      let pending = days.length;
      days.forEach(date => {
        const req = tx.objectStore('sessions').index('date').getAll(date);
        req.onsuccess = e => {
          e.target.result.forEach(r => {
            if (r.type === 'sit') { result[date].sitMin += r.durationMin; result[date].count++; }
            else { result[date].breakMin += r.durationMin; }
          });
          if (--pending === 0) resolve(result);
        };
        req.onerror = () => { if (--pending === 0) resolve(result); };
      });
    });
  }

  function fetchDaySessions(dateKey) {
    return new Promise(resolve => {
      if (!statsDb) { resolve([]); return; }
      const tx = statsDb.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').index('date').getAll(dateKey);
      req.onsuccess = e => resolve(e.target.result.sort((a, b) => a.start - b.start));
      req.onerror = () => resolve([]);
    });
  }

  function fmtMin(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function dayLabel(dateKey) {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const date = new Date(y, mo-1, d);
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((today - date) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function shortDayLabel(dateKey) {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const date = new Date(y, mo-1, d);
    const today = new Date(); today.setHours(0,0,0,0);
    if (Math.round((today - date) / 86400000) === 0) return 'Today';
    return date.toLocaleDateString('en', { weekday: 'short' });
  }

  async function showWeekView() {
    const days = last7DayKeys();
    const data = await fetchDailyTotals(days);
    renderWeekChart(weekChartCvs, days, data);
    const totalSitMin = days.reduce((s, d) => s + data[d].sitMin, 0);
    const totalCount  = days.reduce((s, d) => s + data[d].count, 0);
    statsSummary.textContent = totalCount > 0
      ? `${totalCount} session${totalCount !== 1 ? 's' : ''} · ${fmtMin(totalSitMin)} total sitting`
      : 'No data yet — start monitoring to track your sitting history.';
  }

  function renderWeekChart(canvas, days, data) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const ML = 36, MR = 8, MT = 10, MB = 28;
    const cw = W - ML - MR, ch = H - MT - MB;

    let maxMin = 0;
    days.forEach(d => maxMin = Math.max(maxMin, data[d].sitMin + data[d].breakMin));
    if (maxMin === 0) maxMin = 60;
    const ySteps = [30, 60, 90, 120, 180, 240, 300, 360, 480];
    const yMax = ySteps.find(s => s >= maxMin) || Math.ceil(maxMin / 60) * 60;

    // Horizontal grid lines
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(t => {
      const y = MT + ch * (1 - t);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + cw, y); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(fmtMin(yMax * t), ML - 4, y + 3);
    });

    const colW = cw / 7;
    const barW = Math.max(4, Math.floor(colW * 0.28));
    const gap  = Math.max(2, Math.floor(colW * 0.06));
    const colX = days.map((_, i) => ML + i * colW);
    weekChartMeta = { dayKeys: days, colX, colW };

    days.forEach((dateKey, i) => {
      const d = data[dateKey];
      const xBase = colX[i] + (colW - barW * 2 - gap) / 2;
      const yBase = MT + ch;

      const sitH = (d.sitMin / yMax) * ch;
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(xBase, yBase - sitH, barW, sitH);

      const breakH = (d.breakMin / yMax) * ch;
      ctx.fillStyle = '#4a4a6a';
      ctx.fillRect(xBase + barW + gap, yBase - breakH, barW, breakH);

      ctx.fillStyle = '#555';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(shortDayLabel(dateKey), colX[i] + colW / 2, H - 6);
    });
  }


  function renderDayTimeline(canvas, sessions) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (sessions.length === 0) {
      ctx.fillStyle = '#555';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2 + 4);
      return;
    }
    const first = sessions[0].start;
    const last  = sessions[sessions.length - 1].end;
    const span  = last - first || 1;
    const PL = 4, PR = 4, PT = 4, PB = 20;
    const tw = W - PL - PR;
    const barH = H - PT - PB;

    sessions.forEach(s => {
      const x = PL + ((s.start - first) / span) * tw;
      const w = Math.max(2, ((s.end - s.start) / span) * tw);
      ctx.fillStyle = s.type === 'sit' ? '#4caf50' : '#4a4a6a';
      ctx.fillRect(x, PT, w, barH);
    });

    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmtTime(first), PL, H - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(last), W - PR, H - 4);
  }

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