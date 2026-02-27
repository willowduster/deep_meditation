/* audio.js – Web Audio API ambient sounds and bell synthesis */
'use strict';

class MeditationAudio {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._nodes = [];
  }

  async _ensureContext() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this._ctx.createGain();
      this._master.gain.value = 0;
      this._master.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }
  }

  async start(type) {
    await this._ensureContext();
    this._stopNodes();
    if (type === 'silence') return;

    const builders = {
      cosmic:  () => this._buildCosmic(),
      ocean:   () => this._buildOcean(),
      rain:    () => this._buildRain(),
      forest:  () => this._buildForest()
    };
    (builders[type] || builders.cosmic)();
    this._buildBinaural(200, 206); // 6 Hz theta binaural beat

    const now = this._ctx.currentTime;
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setValueAtTime(0, now);
    this._master.gain.linearRampToValueAtTime(0.4, now + 5);
  }

  _buildCosmic() {
    const { _ctx: ctx, _master: out } = this;
    // Root drone
    this._osc(55,   0.30, 'sine', out);
    // Fifth
    this._osc(82.5, 0.15, 'sine', out);
    // Shimmer with slow LFO
    const padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    padGain.connect(out);
    this._osc(220, 1, 'sine', padGain);

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.04;
    lfoGain.connect(padGain.gain);
    this._osc(0.08, 1, 'sine', lfoGain);
  }

  _buildOcean() {
    const { _ctx: ctx, _master: out } = this;
    const noise = this._noise(ctx, 0.5);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 500;
    noise.connect(lpf);
    lpf.connect(out);
    this._nodes.push(lpf);

    // Wave rhythm LFO
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfoGain.connect(lpf.frequency);
    this._osc(0.12, 1, 'sine', lfoGain);
  }

  _buildRain() {
    const { _ctx: ctx, _master: out } = this;
    const noise = this._noise(ctx, 0.65);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 2800;
    bpf.Q.value = 0.5;
    noise.connect(bpf);
    bpf.connect(out);
    this._nodes.push(bpf);
  }

  _buildForest() {
    const { _ctx: ctx, _master: out } = this;
    const noise = this._noise(ctx, 0.42);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 1800;
    noise.connect(lpf);
    lpf.connect(out);
    this._nodes.push(lpf);
  }

  _buildBinaural(freqL, freqR) {
    const { _ctx: ctx, _master: out } = this;
    const makeSide = (freq, pan) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.06;
      osc.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        p.connect(out);
        this._nodes.push(p);
      } else {
        g.connect(out);
      }
      osc.start();
      this._nodes.push(osc, g);
    };
    makeSide(freqL, -1);
    makeSide(freqR,  1);
  }

  /** Creates a looping pink-noise approximation buffer source (Voss-McCartney algorithm). */
  _noise(ctx, gainVal) {
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(2, rate * 4, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gainVal;
    src.connect(g);
    g.connect(this._master);
    src.start();
    this._nodes.push(src, g);
    return g;
  }

  /** Convenience: create, start and track an oscillator. */
  _osc(freq, gain, type, dest) {
    const { _ctx: ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g);
    g.connect(dest);
    osc.start();
    this._nodes.push(osc, g);
    return g;
  }

  /** Strike a singing-bowl bell. */
  ringBell() {
    if (!this._ctx || this._ctx.state !== 'running') return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    [220, 606, 1083, 1965].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime([0.14, 0.08, 0.05, 0.03][i], now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 5);
    });
  }

  /** Fade ambient out over `secs` seconds, then stop all nodes. */
  async fadeOut(secs = 3) {
    if (!this._master) return;
    const now = this._ctx.currentTime;
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setValueAtTime(this._master.gain.value, now);
    this._master.gain.linearRampToValueAtTime(0, now + secs);
    await new Promise(r => setTimeout(r, secs * 1000));
    this._stopNodes();
  }

  stop() {
    if (this._master) {
      this._master.gain.setValueAtTime(0, this._ctx.currentTime);
    }
    this._stopNodes();
  }

  _stopNodes() {
    this._nodes.forEach(n => {
      try { n.stop && n.stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    this._nodes = [];
  }
}
