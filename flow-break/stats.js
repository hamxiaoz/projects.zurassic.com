(function() {
  let statsDb = null;
  let openSitSession = null;  // { date, start } — written to DB on close
  let breakStart = null;      // timestamp when person left; written when they return or app stops
  let alarmAwayTimer = null;  // fires if person stays away 15s during alarm → real break
  const ALARM_AWAY_MS = 15000;

  function initStats() {
    const req = indexedDB.open('flowBreakDB', 1);
    req.onupgradeneeded = e => {
      const store = e.target.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      store.createIndex('date', 'date', { unique: false });
    };
    req.onsuccess = e => { statsDb = e.target.result; recoverStaleSession(); refreshTodayStats(); };
  }

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

  const MERGE_GAP_MS = 3 * 60 * 1000; // 3 minutes

  function mergeSessions(sessions) {
    const merged = [];
    let i = 0;
    while (i < sessions.length) {
      const s = sessions[i];
      if (s.type !== 'sit') { merged.push(s); i++; continue; }
      // Scan forward: absorb any sessions (sit or tiny break) within the gap threshold
      let end = s.end;
      let j = i + 1;
      while (j < sessions.length) {
        const next = sessions[j];
        if (next.type === 'sit' && next.start - end <= MERGE_GAP_MS) {
          end = next.end;
          j++;
        } else if (next.type === 'break' && next.end - next.start < MERGE_GAP_MS) {
          // Small break sandwiched between sits — absorb and keep scanning
          j++;
        } else {
          break;
        }
      }
      merged.push({ ...s, end, durationMin: (end - s.start) / 60000 });
      i = j;
    }
    return merged;
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
    const breathSection = document.getElementById('breath-section');
    if (sessions.length === 0) {
      el.style.display = 'none';
      if (breathSection) breathSection.style.display = '';
      return;
    }
    el.style.display = 'flex';
    if (breathSection) breathSection.style.display = 'none';
    const displaySessions = mergeSessions(sessions);
    const totalSitMin = displaySessions.filter(s => s.type === 'sit').reduce((acc, s) => acc + s.durationMin, 0);
    const summaryEl = document.getElementById('today-stats-summary');
    if (summaryEl) summaryEl.textContent = totalSitMin >= 0.5 ? fmtMin(totalSitMin) + ' sitting' : '';
    currentSessions = displaySessions;
    activeHighlight = -1;
    const canvas = document.getElementById('today-timeline');
    renderDayTimeline(canvas, displaySessions);
    canvas.style.cursor = 'pointer';
    canvas.onclick = function(e) {
      const rect = canvas.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      let hit = -1;
      for (let i = 0; i < timelineSegments.length; i++) {
        const seg = timelineSegments[i];
        const hitX = seg.x - Math.max(0, (8 - seg.w) / 2);
        const hitW = Math.max(8, seg.w);
        if (lx >= hitX && lx <= hitX + hitW) { hit = i; break; }
      }
      if (hit === activeHighlight) { highlightSession(-1); return; }
      highlightSession(hit);
    };
    const list = document.getElementById('today-session-list');
    list.innerHTML = '';
    displaySessions.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = `stats-row stats-row-${s.type}`;
      row.style.cursor = 'pointer';
      row.innerHTML = `<span class="stats-row-label">${s.type === 'sit' ? '● Sitting' : '○ Break'}</span>`
        + `<span class="stats-row-time">${fmtTime(s.start)} – ${fmtTime(s.end)}</span>`
        + `<span class="stats-row-dur">${fmtMin(s.durationMin)}</span>`;
      row.onclick = () => highlightSession(idx === activeHighlight ? -1 : idx);
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

  function onPresenceLost(isWarning, dismissAlarm) {
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

  function cancelAlarmAwayTimer() {
    if (alarmAwayTimer) { clearTimeout(alarmAwayTimer); alarmAwayTimer = null; }
  }

  window.addEventListener('beforeunload', () => {
    const now = Date.now();
    if (openSitSession) {
      localStorage.setItem('flowBreakSession', JSON.stringify({ type: 'sit', date: openSitSession.date, start: openSitSession.start, end: now, durationMin: (now - openSitSession.start) / 60000 }));
    } else if (breakStart) {
      localStorage.setItem('flowBreakSession', JSON.stringify({ type: 'break', date: todayKey(), start: breakStart, end: now, durationMin: (now - breakStart) / 60000 }));
    }
    closeAllOpenSessions();
  });

  // ── DB queries ──────────────────────────────────────────────────────────────
  function fetchDaySessions(dateKey) {
    return new Promise(resolve => {
      if (!statsDb) { resolve([]); return; }
      const tx = statsDb.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').index('date').getAll(dateKey);
      req.onsuccess = e => resolve(e.target.result.sort((a, b) => a.start - b.start));
      req.onerror = () => resolve([]);
    });
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

  // ── Formatting ──────────────────────────────────────────────────────────────
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

  // ── Cross-highlight state ────────────────────────────────────────────────────
  let timelineSegments = []; // [{x, w}] parallel to sessions array
  let currentSessions  = []; // last rendered sessions, for re-highlight on click
  let activeHighlight  = -1;

  function highlightSession(idx) {
    activeHighlight = idx;
    const rows = document.querySelectorAll('#today-session-list .stats-row');
    rows.forEach((r, i) => r.classList.toggle('session-highlighted', i === idx));
    if (idx !== -1 && rows[idx]) rows[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const canvas = document.getElementById('today-timeline');
    if (canvas) renderDayTimeline(canvas, currentSessions, idx);
  }

  // ── Chart rendering ─────────────────────────────────────────────────────────
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

  function renderDayTimeline(canvas, sessions, highlightIdx = -1) {
    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth || 320;
    const displayH = canvas.clientHeight || 50;
    canvas.width  = displayW * dpr;
    canvas.height = displayH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = displayW, H = displayH;
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

    timelineSegments = [];
    sessions.forEach((s, i) => {
      const x = PL + ((s.start - first) / span) * tw;
      const w = Math.max(2, ((s.end - s.start) / span) * tw);
      timelineSegments.push({ x, w });
      const isHighlighted = highlightIdx !== -1 && i === highlightIdx;
      ctx.globalAlpha = (highlightIdx === -1 || isHighlighted) ? 1.0 : 0.3;
      ctx.fillStyle = s.type === 'sit' ? '#4caf50' : '#4a4a6a';
      ctx.fillRect(x, PT, w, barH);
      if (isHighlighted) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, PT + 0.75, w - 1.5, barH - 1.5);
      }
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmtTime(first), PL, H - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(last), W - PR, H - 4);
  }

  // ── Stats modal ──────────────────────────────────────────────────────────────
  let weekChartMeta = null;

  function initStatsModal() {
    const statsBtn      = document.getElementById('stats-btn');
    const statsModal    = document.getElementById('stats-modal');
    const statsClose    = document.getElementById('stats-close');
    const weekChartCvs  = document.getElementById('week-chart');
    const statsSummary  = document.getElementById('stats-summary');

    statsBtn.addEventListener('click', () => { statsModal.classList.add('open'); showWeekView(); });
    statsClose.addEventListener('click', () => statsModal.classList.remove('open'));
    statsModal.addEventListener('click', e => { if (e.target === statsModal) statsModal.classList.remove('open'); });

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
  }

  function last7DayKeys() {
    const keys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return keys;
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.initStats            = initStats;
  window.initStatsModal       = initStatsModal;
  window.onPresenceGained     = onPresenceGained;
  window.onPresenceLost       = onPresenceLost;
  window.closeAllOpenSessions = closeAllOpenSessions;
  window.cancelAlarmAwayTimer = cancelAlarmAwayTimer;
  window.refreshTodayStats    = refreshTodayStats;
})();
