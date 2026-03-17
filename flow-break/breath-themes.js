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
