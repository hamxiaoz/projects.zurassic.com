export const HAND_FX_THEMES = [
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
