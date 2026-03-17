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

export const VIDEO_FX = [
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
