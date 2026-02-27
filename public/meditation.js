/* meditation.js – Canvas-based breathing animation and background particles */
'use strict';

/* ── Background particle canvas (login / setup / complete views) ─────── */
class BackgroundCanvas {
  constructor(id) {
    this._canvas = document.getElementById(id);
    this._ctx = this._canvas ? this._canvas.getContext('2d') : null;
    this._particles = [];
    this._running = false;
    this._raf = null;
    if (this._canvas) {
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }
  }

  _resize() {
    this._canvas.width  = window.innerWidth;
    this._canvas.height = window.innerHeight;
    this._initParticles();
  }

  _initParticles() {
    this._particles = [];
    for (let i = 0; i < 90; i++) {
      this._particles.push({
        x: Math.random() * this._canvas.width,
        y: Math.random() * this._canvas.height,
        r: Math.random() * 1.4 + 0.3,
        vy: -(Math.random() * 0.2 + 0.05),
        op: Math.random() * 0.5 + 0.1,
        dx: (Math.random() - 0.5) * 0.08
      });
    }
  }

  start() {
    if (!this._ctx) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _draw() {
    const { _canvas: cv, _ctx: ctx } = this;
    ctx.clearRect(0, 0, cv.width, cv.height);

    // Radial gradient background
    const g = ctx.createRadialGradient(cv.width/2, cv.height/2, 0, cv.width/2, cv.height/2, Math.max(cv.width, cv.height) * 0.75);
    g.addColorStop(0, '#0e0e2e');
    g.addColorStop(0.6, '#080820');
    g.addColorStop(1, '#040410');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);

    this._particles.forEach(p => {
      p.y += p.vy;
      p.x += p.dx;
      if (p.y < -4) p.y = cv.height + 4;
      if (p.x < 0) p.x = cv.width;
      if (p.x > cv.width) p.x = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,185,255,${p.op})`;
      ctx.fill();
    });
  }
}

/* ── Breathing / meditation canvas ───────────────────────────────────── */
class MeditationCanvas {
  constructor(canvas) {
    this._cv  = canvas;
    this._ctx = canvas.getContext('2d');
    this._running = false;
    this._raf = null;
    this._last = 0;

    // Colours (overridden by setTheme)
    this._primary   = '#7c6bff';
    this._secondary = '#a89cff';
    this._bg        = '#07071a';

    // Breathing state
    this._phase    = 'inhale';
    this._progress = 0;
    this._radius   = 0;
    this._minR = 0;
    this._maxR = 0;
    this._pattern  = { inhale: 4, hold: 2, exhale: 6, rest: 0 };

    // Expanding rings triggered on phase change
    this._rings = [];

    // Particles
    this._particles = [];

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this._cv.width  = window.innerWidth;
    this._cv.height = window.innerHeight;
    const side = Math.min(this._cv.width, this._cv.height);
    this._minR = side * 0.12;
    this._maxR = side * 0.27;
    this._radius = this._minR;
    this._initParticles();
  }

  _initParticles() {
    this._particles = [];
    const n = Math.floor((this._cv.width * this._cv.height) / 14000);
    for (let i = 0; i < n; i++) {
      this._particles.push({
        x: Math.random() * this._cv.width,
        y: Math.random() * this._cv.height,
        r: Math.random() * 1.3 + 0.4,
        speed: Math.random() * 0.25 + 0.04,
        op: Math.random() * 0.4 + 0.08,
        angle: Math.random() * Math.PI * 2,
        drift: (Math.random() - 0.5) * 0.008
      });
    }
  }

  setTheme(primary, secondary, background) {
    this._primary   = primary   || '#7c6bff';
    this._secondary = secondary || '#a89cff';
    this._bg        = background || '#07071a';
    document.documentElement.style.setProperty('--primary',   this._primary);
    document.documentElement.style.setProperty('--secondary', this._secondary);
  }

  setBreathPattern(p) {
    this._pattern = { ...this._pattern, ...p };
  }

  triggerRing() {
    this._rings.push({ r: this._radius, op: 0.55 });
  }

  start() {
    this._running = true;
    this._last = performance.now();
    this._phase = 'inhale';
    this._progress = 0;
    const loop = ts => {
      if (!this._running) return;
      this._frame(ts);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _ease(t) { return t < 0.5 ? 2*t*t : -1 + (4-2*t)*t; }

  _frame(ts) {
    const dt = ts - this._last;
    this._last = ts;
    this._updateBreath(dt);
    this._draw();
  }

  _updateBreath(dt) {
    const seq = ['inhale', 'hold', 'exhale', 'rest'];
    const durations = [
      this._pattern.inhale * 1000,
      this._pattern.hold   * 1000,
      this._pattern.exhale * 1000,
      this._pattern.rest   * 1000
    ];
    const idx = seq.indexOf(this._phase);
    const dur = durations[idx];

    if (dur <= 0) {
      this._phase = seq[(idx + 1) % 4];
      this._progress = 0;
      return;
    }

    this._progress += dt / dur;
    if (this._progress >= 1) {
      this._progress = 0;
      this._phase = seq[(idx + 1) % 4];
    }

    const e = this._ease(this._progress);
    if      (this._phase === 'inhale')  this._radius = this._minR + (this._maxR - this._minR) * e;
    else if (this._phase === 'hold')    this._radius = this._maxR;
    else if (this._phase === 'exhale')  this._radius = this._maxR - (this._maxR - this._minR) * e;
    else                                this._radius = this._minR;
  }

  _rgba(hex, a) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!r) return `rgba(124,107,255,${a})`;
    return `rgba(${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)},${a})`;
  }

  _draw() {
    const { _cv: cv, _ctx: ctx } = this;
    const cx = cv.width / 2, cy = cv.height / 2;
    const r  = this._radius;

    // Background
    ctx.fillStyle = this._bg;
    ctx.fillRect(0, 0, cv.width, cv.height);

    // Particles
    this._particles.forEach(p => {
      p.angle += p.drift;
      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed * 0.6;
      if (p.x < 0) p.x = cv.width;  if (p.x > cv.width)  p.x = 0;
      if (p.y < 0) p.y = cv.height; if (p.y > cv.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.op})`;
      ctx.fill();
    });

    // Expanding rings (phase transitions)
    this._rings = this._rings.filter(ring => {
      ring.r  += 2.5;
      ring.op -= 0.018;
      if (ring.op <= 0) return false;
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.strokeStyle = this._rgba(this._primary, ring.op);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return true;
    });

    // Outer ambient glow
    const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.2);
    glow.addColorStop(0,   this._rgba(this._primary, 0.18));
    glow.addColorStop(0.5, this._rgba(this._primary, 0.06));
    glow.addColorStop(1,   this._rgba(this._primary, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Main circle gradient
    const cg = ctx.createRadialGradient(cx - r*0.28, cy - r*0.28, 0, cx, cy, r);
    cg.addColorStop(0, this._rgba(this._secondary, 0.92));
    cg.addColorStop(0.65, this._rgba(this._primary, 0.88));
    cg.addColorStop(1,    this._rgba(this._primary, 0.72));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();

    // Inner ring detail
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Breath label
    const labels = { inhale: 'Breathe In', hold: 'Hold', exhale: 'Breathe Out', rest: '' };
    const label = labels[this._phase] || '';
    if (label) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `300 ${Math.max(12, Math.floor(r * 0.2))}px 'Raleway', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy);
    }
  }
}
