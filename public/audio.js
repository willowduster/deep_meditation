/* audio.js – Layered ambient soundscape synthesizer (Web Audio API) */
'use strict';

class MeditationAudio {
  constructor() {
    this._ctx    = null;
    this._master = null;
    this._nodes  = [];
    this._scheduledTimeouts = [];
  }

  /* ── Bootstrap ─────────────────────────────────────────────────────── */

  async _ensureContext() {
    if (!this._ctx) {
      this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this._ctx.createGain();
      this._master.gain.value = 0;

      // ── Permanent output chain (never added to this._nodes) ──────────
      // master → [dryGain,
      //           convolver → wetGain,
      //           delayBus → delayReturnGain] → shelf → out

      const shelf = this._ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 6000; shelf.gain.value = -10;

      const dryGain = this._ctx.createGain(); dryGain.gain.value = 0.38;
      const wetGain = this._ctx.createGain(); wetGain.gain.value = 0.72;

      // Convolution reverb
      const convolver = this._ctx.createConvolver();
      convolver.buffer = this._buildIR(this._ctx, 4.2, 0.015);

      // Ping-pong delay with stereo swirl
      const delayReturn = this._ctx.createGain(); delayReturn.gain.value = 0.30;
      this._buildDelayBus(this._ctx, delayReturn);

      this._master.connect(dryGain);          dryGain.connect(shelf);
      this._master.connect(convolver);        convolver.connect(wetGain); wetGain.connect(shelf);
      this._master.connect(this._delayL);     // seed ping-pong input
      this._master.connect(this._delayR);     // both sides so pings overlap from bar 1
      delayReturn.connect(shelf);
      shelf.connect(this._ctx.destination);
      // NOTE: all above are permanent infrastructure – do NOT push to this._nodes
    }
    if (this._ctx.state === 'suspended') await this._ctx.resume();
  }

  /**
   * Build a synthetic stereo impulse response.
   * @param {AudioContext} ctx
   * @param {number} decaySecs  Total tail length (e.g. 4.2 s)
   * @param {number} preDelay   Pre-delay in seconds (e.g. 0.015)
   */
  _buildIR(ctx, decaySecs, preDelay) {
    const rate       = ctx.sampleRate;
    const length     = Math.ceil(rate * decaySecs);
    const preSamples = Math.ceil(rate * preDelay);
    const buf        = ctx.createBuffer(2, length, rate);

    // Early reflections – discrete taps that mimic room boundaries
    const earlyTaps = [
      { t: 0.007, g: 0.65 }, { t: 0.013, g: 0.55 }, { t: 0.021, g: 0.48 },
      { t: 0.031, g: 0.40 }, { t: 0.047, g: 0.32 }, { t: 0.067, g: 0.22 },
      { t: 0.089, g: 0.16 }, { t: 0.118, g: 0.11 },
    ];

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Diffuse tail: exponentially decaying noise
      for (let i = preSamples; i < length; i++) {
        const age    = (i - preSamples) / rate;
        const decay  = Math.exp(-age * (ch === 0 ? 2.8 : 2.6)); // slight L/R asymmetry
        const noise  = (Math.random() * 2 - 1);
        d[i] = noise * decay * 0.22;
      }
      // Overlay early reflections with slight L/R pan variance
      const panOffset = ch === 0 ? 0 : 0.003;
      for (const tap of earlyTaps) {
        const idx = Math.round((tap.t + panOffset) * rate) + preSamples;
        if (idx < length) d[idx] += tap.g * 0.55;
      }
    }
    return buf;
  }

  /**
   * Ping-pong delay bus with slow stereo swirl and swell amplitude.
   * Quarter-note grid at a randomised low BPM (52–68).
   * Wires: inputNode (= this._master tap) → delayL ⇄ delayR → panL/panR → swellGain → outputNode
   * @param {AudioContext} ctx
   * @param {AudioNode}    outputNode  where the wet delay signal is delivered
   */
  _buildDelayBus(ctx, outputNode) {
    const bpm         = 52 + Math.random() * 16;        // 52–68 BPM
    const quarter     = 60 / bpm;                       // 882–1154 ms per beat

    // ── Delay lines ──────────────────────────────────────────────────
    const delayL = ctx.createDelay(2.5); delayL.delayTime.value = quarter;
    const delayR = ctx.createDelay(2.5); delayR.delayTime.value = quarter * 1.0018; // micro-detune

    // Very subtle delay-time wobble — 1.5 ms depth, ~0.06 Hz — gives the
    // "swimming" quality without audible pitch-warping
    const wobbleLfo = ctx.createOscillator();
    wobbleLfo.type = 'sine'; wobbleLfo.frequency.value = 0.06 + Math.random() * 0.03;
    const wobbleAmtL = ctx.createGain(); wobbleAmtL.gain.value = 0.0015;
    const wobbleAmtR = ctx.createGain(); wobbleAmtR.gain.value = -0.0015; // inverted for movement
    wobbleLfo.connect(wobbleAmtL); wobbleAmtL.connect(delayL.delayTime);
    wobbleLfo.connect(wobbleAmtR); wobbleAmtR.connect(delayR.delayTime);
    wobbleLfo.start();

    // ── Ping-pong feedback ───────────────────────────────────────────
    // L → R → L crossfeed so repeats alternate sides
    const fbL = ctx.createGain(); fbL.gain.value = 0.60; // fades over ~7 repeats
    const fbR = ctx.createGain(); fbR.gain.value = 0.58;
    delayL.connect(fbL); fbL.connect(delayR);
    delayR.connect(fbR); fbR.connect(delayL);

    // ── Slow stereo panning swirl ─────────────────────────────────────
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panL) { panL.pan.value = -0.65; panR.pan.value = 0.65; }

    // Single LFO drives both panners in opposite directions so they
    // slowly chase each other around the stereo field (~14–25 s cycle)
    const panLfo = ctx.createOscillator();
    panLfo.type = 'sine'; panLfo.frequency.value = 0.04 + Math.random() * 0.03;
    if (panL) {
      const panAmtL = ctx.createGain(); panAmtL.gain.value =  0.65;
      const panAmtR = ctx.createGain(); panAmtR.gain.value = -0.65;
      panLfo.connect(panAmtL); panAmtL.connect(panL.pan);
      panLfo.connect(panAmtR); panAmtR.connect(panR.pan);
    }
    panLfo.start();

    // ── Swell gain — slow amplitude breathing (~30–50 s cycle) ───────
    const swellGain = ctx.createGain(); swellGain.gain.value = 0.55;
    const swellLfo  = ctx.createOscillator();
    swellLfo.type = 'sine'; swellLfo.frequency.value = 0.022 + Math.random() * 0.018;
    const swellAmt  = ctx.createGain(); swellAmt.gain.value = 0.30; // ±30% swell
    swellLfo.connect(swellAmt); swellAmt.connect(swellGain.gain);
    swellLfo.start();

    // ── Wire everything up ───────────────────────────────────────────
    // The "input" is this._master being connected to delayL + delayR
    // externally (both sides seeded so pings overlap from the start)
    if (panL) {
      delayL.connect(panL); panL.connect(swellGain);
      delayR.connect(panR); panR.connect(swellGain);
    } else {
      delayL.connect(swellGain);
      delayR.connect(swellGain);
    }
    swellGain.connect(outputNode);

    // Store delay inputs on the instance so _ensureContext can wire master → them
    this._delayL = delayL;
    this._delayR = delayR;
  }

  /* ── Public API ────────────────────────────────────────────────────── */

  /**
   * Start a soundscape from an array of layer names.
   * @param {string[]} layers  e.g. ['waves','wind_soft','seagulls']
   */
  async start(layers) {
    await this._ensureContext();
    this._stopNodes();

    const layerList = Array.isArray(layers) ? layers : [layers];
    if (layerList.includes('silence')) return;

    const map = {
      waves:           () => this._buildWaves(),
      rain_heavy:      () => this._buildRain(0.55, 2200, 0.6),
      rain_light:      () => this._buildRain(0.30, 1400, 0.9),
      drips:           () => this._buildDrips(),
      wind_soft:       () => this._buildWind(0.18, 420),
      wind_strong:     () => this._buildWind(0.32, 700),
      thunder_distant: () => this._buildThunder(),
      crickets:        () => this._buildCrickets(),
      frogs:           () => this._buildFrogs(),
      birds_forest:    () => this._buildBirdsForest(),
      birds_tropical:  () => this._buildBirdsTropical(),
      seagulls:        () => this._buildSeagulls(),
      fire_crackling:  () => this._buildFire(),
      stream_brook:    () => this._buildStream(),
      cave_drips:      () => this._buildDrips(true),
      cosmic_drone:    () => this._buildCosmicDrone(),
      singing_bowl:    () => this._buildSingingBowl(),
      om_chant:        () => this._buildOm(),
    };

    for (const name of layerList) {
      if (map[name]) map[name]();
    }

    this._buildBinaural(200, 206);

    const now = this._ctx.currentTime;
    this._master.gain.cancelScheduledValues(now);
    this._master.gain.setValueAtTime(0, now);
    this._master.gain.linearRampToValueAtTime(0.38, now + 6);
  }

  /* ── Layer builders ────────────────────────────────────────────────── */

  _buildWaves() {
    const ctx = this._ctx, out = this._master;
    const rumble = this._pinkNoise(0.12);  // quieter – reverb adds body
    const rumbleLpf = ctx.createBiquadFilter();
    rumbleLpf.type = 'lowpass'; rumbleLpf.frequency.value = 120;
    rumble.connect(rumbleLpf); rumbleLpf.connect(out);
    this._nodes.push(rumbleLpf);

    const wash = this._pinkNoise(0.30);  // reduced – reverb fills the space
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 900;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 90;
    wash.connect(hpf); hpf.connect(lpf); lpf.connect(out);
    this._nodes.push(lpf, hpf);

    const swellLfo = ctx.createOscillator();
    swellLfo.frequency.value = 0.09; swellLfo.type = 'sine';
    const swellAmt = ctx.createGain(); swellAmt.gain.value = 300;
    swellLfo.connect(swellAmt); swellAmt.connect(lpf.frequency);
    swellLfo.start(); this._nodes.push(swellLfo, swellAmt);

    const crash = this._pinkNoise(0.14);
    const cLpf = ctx.createBiquadFilter();
    cLpf.type = 'bandpass'; cLpf.frequency.value = 600; cLpf.Q.value = 0.6;
    const cEnv = ctx.createGain(); cEnv.gain.value = 0;
    crash.connect(cLpf); cLpf.connect(cEnv); cEnv.connect(out);
    this._nodes.push(cLpf, cEnv);

    const crashLfo = ctx.createOscillator();
    crashLfo.frequency.value = 0.11; crashLfo.type = 'sine';
    const crashAmt = ctx.createGain(); crashAmt.gain.value = 0.12;
    crashLfo.connect(crashAmt); crashAmt.connect(cEnv.gain);
    crashLfo.start(); this._nodes.push(crashLfo, crashAmt);

    const wash2 = this._pinkNoise(0.18);
    const lpf2 = ctx.createBiquadFilter();
    lpf2.type = 'lowpass'; lpf2.frequency.value = 750;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner(); pan.pan.value = 0.45;
      wash2.connect(lpf2); lpf2.connect(pan); pan.connect(out);
      this._nodes.push(pan);
    } else { wash2.connect(lpf2); lpf2.connect(out); }
    this._nodes.push(lpf2);
  }

  _buildRain(gain = 0.30, freq = 1600, Q = 0.55) {  // softer, darker
    const ctx = this._ctx, out = this._master;
    const noise = this._pinkNoise(gain);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = freq; bpf.Q.value = Q;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = freq * 1.4;
    noise.connect(bpf); bpf.connect(lpf); lpf.connect(out);
    this._nodes.push(bpf, lpf);
    const gustLfo = ctx.createOscillator();
    gustLfo.frequency.value = 0.035; gustLfo.type = 'sine';
    const gustAmt = ctx.createGain(); gustAmt.gain.value = 160;
    gustLfo.connect(gustAmt); gustAmt.connect(bpf.frequency);
    gustLfo.start(); this._nodes.push(gustLfo, gustAmt);
  }

  _buildDrips(cave = false) {
    const ctx = this._ctx, out = this._master;
    const baseFreq = cave ? 320 : 560;
    const interval = cave ? [3200, 7000] : [1500, 4000];
    const scheduleDrip = () => {
      if (!this._ctx) return;
      const freq = baseFreq + Math.random() * baseFreq * 0.5;
      const now2 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now2);
      g.gain.linearRampToValueAtTime(0.09, now2 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, now2 + (cave ? 1.4 : 0.5));
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 3500;
      osc.connect(g); g.connect(lpf); lpf.connect(out);
      osc.start(now2); osc.stop(now2 + (cave ? 1.6 : 0.6));
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine'; osc2.frequency.value = freq * 1.5;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, now2);
      g2.gain.linearRampToValueAtTime(0.03, now2 + 0.008);
      g2.gain.exponentialRampToValueAtTime(0.001, now2 + (cave ? 2.2 : 0.9));
      osc2.connect(g2); g2.connect(lpf);
      osc2.start(now2); osc2.stop(now2 + (cave ? 2.4 : 1.0));
      const delay = interval[0] + Math.random() * (interval[1] - interval[0]);
      const t = setTimeout(scheduleDrip, delay);
      this._scheduledTimeouts.push(t);
    };
    scheduleDrip();
  }

  _buildWind(gain = 0.14, cutoff = 380) {  // softer – reverb makes it spacious
    const ctx = this._ctx, out = this._master;
    const noise = this._pinkNoise(gain);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = cutoff;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 55;
    noise.connect(hpf); hpf.connect(lpf);
    const env = ctx.createGain(); env.gain.value = 0.65;
    lpf.connect(env); env.connect(out);
    this._nodes.push(lpf, hpf, env);
    const gustLfo = ctx.createOscillator();
    gustLfo.frequency.value = 0.05; gustLfo.type = 'sine';
    const gustAmt = ctx.createGain(); gustAmt.gain.value = 0.22;
    gustLfo.connect(gustAmt); gustAmt.connect(env.gain);
    gustLfo.start(); this._nodes.push(gustLfo, gustAmt);
  }

  _buildThunder() {
    const ctx = this._ctx, out = this._master;
    const scheduleThunder = () => {
      if (!this._ctx) return;
      const noise = this._pinkNoise(1);
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 90;
      const env = ctx.createGain(); env.gain.value = 0;
      noise.connect(lpf); lpf.connect(env); env.connect(out);
      this._nodes.push(lpf, env);
      const now2 = ctx.currentTime;
      const dur = 3.5 + Math.random() * 4;
      env.gain.setValueAtTime(0, now2);
      env.gain.linearRampToValueAtTime(0.55, now2 + 0.3);
      env.gain.linearRampToValueAtTime(0.3, now2 + dur * 0.4);
      env.gain.exponentialRampToValueAtTime(0.001, now2 + dur);
      const t = setTimeout(scheduleThunder, 18000 + Math.random() * 30000);
      this._scheduledTimeouts.push(t);
    };
    const t0 = setTimeout(scheduleThunder, 4000 + Math.random() * 8000);
    this._scheduledTimeouts.push(t0);
  }

  _buildCrickets() {
    const ctx = this._ctx, out = this._master;
    for (let i = 0; i < 4; i++) {
      const carrFreq = 4100 + i * 210 + Math.random() * 80;
      const chirpRate = 60 + i * 4 + Math.random() * 6;
      const burstRate = 0.28 + i * 0.04 + Math.random() * 0.05;

      const carrier = ctx.createOscillator();
      carrier.type = 'sine'; carrier.frequency.value = carrFreq;

      const chirpGain = ctx.createGain(); chirpGain.gain.value = 0;
      const chirpLfo = ctx.createOscillator();
      chirpLfo.type = 'square'; chirpLfo.frequency.value = chirpRate;
      const chirpAmt = ctx.createGain(); chirpAmt.gain.value = 0.45;

      if (ctx.createConstantSource) {
        const dc = ctx.createConstantSource(); dc.offset.value = 0.45;
        dc.connect(chirpGain.gain); dc.start(); this._nodes.push(dc);
      } else { chirpGain.gain.value = 0.45; }
      chirpLfo.connect(chirpAmt); chirpAmt.connect(chirpGain.gain);
      this._nodes.push(chirpLfo, chirpAmt);

      const burstGain = ctx.createGain(); burstGain.gain.value = 0;
      const burstLfo = ctx.createOscillator();
      burstLfo.type = 'sine'; burstLfo.frequency.value = burstRate;
      const burstAmt = ctx.createGain(); burstAmt.gain.value = 0.5;

      if (ctx.createConstantSource) {
        const dc2 = ctx.createConstantSource(); dc2.offset.value = 0.5;
        dc2.connect(burstGain.gain); dc2.start(); this._nodes.push(dc2);
      } else { burstGain.gain.value = 0.5; }
      burstLfo.connect(burstAmt); burstAmt.connect(burstGain.gain);
      this._nodes.push(burstLfo, burstAmt);

      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 5500;
      const masterGain = ctx.createGain(); masterGain.gain.value = 0.022;

      carrier.connect(chirpGain); chirpGain.connect(burstGain);
      burstGain.connect(lpf); lpf.connect(masterGain);

      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = (i % 2 === 0 ? -1 : 1) * (0.2 + Math.random() * 0.4);
        masterGain.connect(pan); pan.connect(out); this._nodes.push(pan);
      } else { masterGain.connect(out); }

      carrier.start(); chirpLfo.start(); burstLfo.start();
      this._nodes.push(carrier, chirpGain, burstGain, lpf, masterGain);
    }
  }

  _buildFrogs() {
    const ctx = this._ctx, out = this._master;
    const scheduleRibbit = (delay) => {
      if (!this._ctx) return;
      const t = setTimeout(() => {
        if (!this._ctx) return;
        const freq = 180 + Math.random() * 80;
        const now2 = ctx.currentTime;
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass'; lpf.frequency.value = 600;
        [[0, 1], ...(Math.random() < 0.4 ? [[0.22, 1.12]] : [])].forEach(([dt, m]) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine'; osc.frequency.value = freq * m;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, now2 + dt);
          g.gain.linearRampToValueAtTime(0.055, now2 + dt + 0.04);
          g.gain.setValueAtTime(0.055, now2 + dt + 0.12);
          g.gain.exponentialRampToValueAtTime(0.001, now2 + dt + 0.45);
          osc.connect(g); g.connect(lpf); lpf.connect(out);
          osc.start(now2 + dt); osc.stop(now2 + dt + 0.5);
        });
        scheduleRibbit(1200 + Math.random() * 4000);
      }, delay);
      this._scheduledTimeouts.push(t);
    };
    for (let i = 0; i < 3; i++) scheduleRibbit(Math.random() * 3000);
  }

  _buildBirdsForest() {
    const ctx = this._ctx, out = this._master;
    const rustle = this._pinkNoise(0.12);
    const lpf0 = ctx.createBiquadFilter();
    lpf0.type = 'lowpass'; lpf0.frequency.value = 900;
    rustle.connect(lpf0); lpf0.connect(out); this._nodes.push(lpf0);

    const scheduleChirp = (delay) => {
      if (!this._ctx) return;
      const t = setTimeout(() => {
        if (!this._ctx) return;
        const root = 1200 + Math.random() * 1800;
        const num  = 2 + Math.floor(Math.random() * 4);
        const now2 = ctx.currentTime;
        for (let n = 0; n < num; n++) {
          const nt = now2 + n * (0.08 + Math.random() * 0.06);
          const freq = root * [1, 1.25, 1.5][Math.floor(Math.random() * 3)];
          const osc = ctx.createOscillator();
          osc.type = 'sine'; osc.frequency.value = freq;
          const vib = ctx.createOscillator(); vib.frequency.value = 8; vib.type = 'sine';
          const vibAmt = ctx.createGain(); vibAmt.gain.value = 12;
          vib.connect(vibAmt); vibAmt.connect(osc.frequency);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, nt);
          g.gain.linearRampToValueAtTime(0.04, nt + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, nt + 0.2);
          const lpf = ctx.createBiquadFilter();
          lpf.type = 'lowpass'; lpf.frequency.value = 4000;
          osc.connect(g); g.connect(lpf); lpf.connect(out);
          osc.start(nt); osc.stop(nt + 0.25);
          vib.start(nt); vib.stop(nt + 0.25);
        }
        scheduleChirp(1800 + Math.random() * 5000);
      }, delay);
      this._scheduledTimeouts.push(t);
    };
    for (let i = 0; i < 3; i++) scheduleChirp(Math.random() * 4000);
  }

  _buildBirdsTropical() {
    const ctx = this._ctx, out = this._master;
    const scheduleCall = (delay) => {
      if (!this._ctx) return;
      const t = setTimeout(() => {
        if (!this._ctx) return;
        const root = 1800 + Math.random() * 1400;
        const now2 = ctx.currentTime;
        const patterns = [[1,1.12,1.25,1.12,1],[1.25,1,1.5,1.25],[1,1.5,1.33]];
        const notes = patterns[Math.floor(Math.random() * 3)];
        notes.forEach((mult, n) => {
          const nt = now2 + n * 0.11;
          const osc = ctx.createOscillator();
          osc.type = 'triangle'; osc.frequency.value = root * mult;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, nt);
          g.gain.linearRampToValueAtTime(0.038, nt + 0.012);
          g.gain.exponentialRampToValueAtTime(0.001, nt + 0.18);
          const lpf = ctx.createBiquadFilter();
          lpf.type = 'lowpass'; lpf.frequency.value = 5000;
          osc.connect(g); g.connect(lpf); lpf.connect(out);
          osc.start(nt); osc.stop(nt + 0.22);
        });
        scheduleCall(2000 + Math.random() * 6000);
      }, delay);
      this._scheduledTimeouts.push(t);
    };
    for (let i = 0; i < 4; i++) scheduleCall(Math.random() * 3000);
  }

  _buildSeagulls() {
    const ctx = this._ctx, out = this._master;
    const scheduleCry = (delay) => {
      if (!this._ctx) return;
      const t = setTimeout(() => {
        if (!this._ctx) return;
        const base = 700 + Math.random() * 400;
        const now2 = ctx.currentTime;
        const dur  = 0.6 + Math.random() * 0.5;
        const carrier = ctx.createOscillator();
        carrier.type = 'sine'; carrier.frequency.value = base;
        carrier.frequency.setValueAtTime(base * 0.85, now2);
        carrier.frequency.linearRampToValueAtTime(base * 1.35, now2 + dur * 0.35);
        carrier.frequency.linearRampToValueAtTime(base * 0.7,  now2 + dur);
        const mod = ctx.createOscillator();
        mod.type = 'sine'; mod.frequency.value = base * 2.1;
        const modGain = ctx.createGain(); modGain.gain.value = 80;
        mod.connect(modGain); modGain.connect(carrier.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now2);
        g.gain.linearRampToValueAtTime(0.05, now2 + 0.06);
        g.gain.setValueAtTime(0.05, now2 + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, now2 + dur);
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass'; lpf.frequency.value = 3200;
        carrier.connect(g); g.connect(lpf); lpf.connect(out);
        carrier.start(now2); mod.start(now2);
        carrier.stop(now2 + dur + 0.1); mod.stop(now2 + dur + 0.1);
        if (Math.random() < 0.35) scheduleCry(dur * 1000 + 200 + Math.random() * 300);
        scheduleCry(4000 + Math.random() * 12000);
      }, delay);
      this._scheduledTimeouts.push(t);
    };
    for (let i = 0; i < 2; i++) scheduleCry(Math.random() * 6000);
  }

  _buildFire() {
    const ctx = this._ctx, out = this._master;
    const bed = this._pinkNoise(0.35);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 280;
    const flicker = ctx.createGain(); flicker.gain.value = 0.8;
    bed.connect(lpf); lpf.connect(flicker); flicker.connect(out);
    this._nodes.push(lpf, flicker);
    const flickLfo = ctx.createOscillator();
    flickLfo.frequency.value = 5.5; flickLfo.type = 'sine';
    const flickAmt = ctx.createGain(); flickAmt.gain.value = 0.18;
    flickLfo.connect(flickAmt); flickAmt.connect(flicker.gain);
    flickLfo.start(); this._nodes.push(flickLfo, flickAmt);
    const crackle = this._pinkNoise(0.28);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 900; bpf.Q.value = 0.8;
    crackle.connect(bpf); bpf.connect(out); this._nodes.push(bpf);
    const schedulePop = () => {
      if (!this._ctx) return;
      const t = setTimeout(() => {
        if (!this._ctx) return;
        const noise = this._pinkNoise(1);
        const bpfPop = ctx.createBiquadFilter();
        bpfPop.type = 'bandpass';
        bpfPop.frequency.value = 1200 + Math.random() * 600; bpfPop.Q.value = 2;
        const env = ctx.createGain(); env.gain.value = 0;
        const now2 = ctx.currentTime;
        env.gain.setValueAtTime(0.12, now2);
        env.gain.exponentialRampToValueAtTime(0.001, now2 + 0.08);
        noise.connect(bpfPop); bpfPop.connect(env); env.connect(out);
        this._nodes.push(bpfPop, env);
        schedulePop();
      }, 80 + Math.random() * 400);
      this._scheduledTimeouts.push(t);
    };
    schedulePop();
  }

  _buildStream() {
    const ctx = this._ctx, out = this._master;
    [320, 680, 1100, 1800].forEach((freq, i) => {
      const noise = this._pinkNoise(0.28);
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass'; bpf.frequency.value = freq; bpf.Q.value = 1.2;
      const bubbleLfo = ctx.createOscillator();
      bubbleLfo.frequency.value = 1.5 + i * 0.7; bubbleLfo.type = 'sine';
      const bubbleAmt = ctx.createGain(); bubbleAmt.gain.value = freq * 0.08;
      bubbleLfo.connect(bubbleAmt); bubbleAmt.connect(bpf.frequency);
      const g = ctx.createGain(); g.gain.value = 0.55;
      noise.connect(bpf); bpf.connect(g); g.connect(out);
      bubbleLfo.start(); this._nodes.push(bpf, bubbleLfo, bubbleAmt, g);
    });
  }

  _buildCosmicDrone() {
    const ctx = this._ctx, out = this._master;
    [[1,0.22],[2,0.10],[3,0.07],[4,0.04],[6,0.025]].forEach(([mult, vol]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 55 * mult;
      const g = ctx.createGain(); g.gain.value = vol;
      const trem = ctx.createOscillator();
      trem.type = 'sine'; trem.frequency.value = 0.04 + mult * 0.015;
      const tremAmt = ctx.createGain(); tremAmt.gain.value = vol * 0.2;
      trem.connect(tremAmt); tremAmt.connect(g.gain);
      osc.connect(g); g.connect(out);
      osc.start(); trem.start();
      this._nodes.push(osc, g, trem, tremAmt);
    });
  }

  _buildSingingBowl() {
    const ctx = this._ctx, out = this._master;
    const strikeBowl = () => {
      if (!this._ctx) return;
      const now2 = ctx.currentTime;
      [220, 550, 990, 1650].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq;
        const g = ctx.createGain();
        const amp = [0.12, 0.07, 0.04, 0.02][i];
        g.gain.setValueAtTime(0, now2);
        g.gain.linearRampToValueAtTime(amp, now2 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, now2 + 6 + i * 2);
        osc.connect(g); g.connect(out);
        osc.start(now2); osc.stop(now2 + 9 + i * 2);
      });
    };
    strikeBowl();
    const scheduleStrike = () => {
      if (!this._ctx) return;
      const t = setTimeout(() => { strikeBowl(); scheduleStrike(); }, 18000 + Math.random() * 6000);
      this._scheduledTimeouts.push(t);
    };
    scheduleStrike();
  }

  _buildOm() {
    const ctx = this._ctx, out = this._master;
    [1,2,3,4,5,6].forEach((h, i) => {
      const amps = [0.18, 0.09, 0.06, 0.04, 0.025, 0.015];
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 110 * h;
      const g = ctx.createGain(); g.gain.value = amps[i];
      const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.5;
      const vibAmt = ctx.createGain(); vibAmt.gain.value = 110 * h * 0.003;
      vib.connect(vibAmt); vibAmt.connect(osc.frequency);
      osc.connect(g); g.connect(out);
      osc.start(); vib.start();
      this._nodes.push(osc, g, vib, vibAmt);
    });
  }

  /* ── Shared primitives ─────────────────────────────────────────────── */

  _pinkNoise(gainVal) {
    const ctx = this._ctx;
    const rate = ctx.sampleRate;
    const buf  = ctx.createBuffer(2, rate * 6, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = gainVal;
    src.connect(g); g.connect(this._master);
    src.start();
    this._nodes.push(src, g);
    return g;
  }

  _buildBinaural(freqL, freqR) {
    const ctx = this._ctx, out = this._master;
    [[freqL, -1],[freqR, 1]].forEach(([freq, pan]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = 0.04;
      osc.connect(g);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        g.connect(p); p.connect(out); this._nodes.push(p);
      } else { g.connect(out); }
      osc.start(); this._nodes.push(osc, g);
    });
  }

  /* ── Bell ──────────────────────────────────────────────────────────── */

  ringBell() {
    if (!this._ctx || this._ctx.state !== 'running') return;
    const ctx = this._ctx, now = ctx.currentTime;
    [220, 606, 1083, 1965].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime([0.13, 0.07, 0.045, 0.025][i], now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 5);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + 5.5);
    });
  }

  /* ── Music (chord pad engine) ──────────────────────────────────────── */

  async startMusic(mood) {
    await this._ensureContext();
    const ctx = this._ctx;
    this._musicGain = ctx.createGain();
    this._musicGain.gain.setValueAtTime(0, ctx.currentTime);
    this._musicGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 5);
    this._musicGain.connect(this._master);
    this._musicNodes = [this._musicGain];
    this._musicTimeouts = [];
    this._buildChordPads(mood);
  }

  stopMusic(fadeSecs = 3) {
    if (!this._musicGain) return;
    const now = this._ctx.currentTime;
    (this._musicTimeouts || []).forEach(id => clearTimeout(id));
    this._musicTimeouts = [];
    this._musicGain.gain.cancelScheduledValues(now);
    this._musicGain.gain.setValueAtTime(this._musicGain.gain.value, now);
    if (fadeSecs > 0) {
      this._musicGain.gain.linearRampToValueAtTime(0, now + fadeSecs);
      setTimeout(() => this._disconnectMusicNodes(), fadeSecs * 1000 + 200);
    } else {
      this._disconnectMusicNodes();
    }
  }

  _disconnectMusicNodes() {
    (this._musicNodes || []).forEach(n => {
      try { n.stop && n.stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    this._musicNodes = [];
    this._musicGain = null;
  }

  _buildChordPads(mood) {
    const C4 = 261.63;
    const st = n => C4 * Math.pow(2, n / 12);

    const progressions = {
      peaceful:   { chords: [[0,4,7,11],[5,9,12,16],[9,12,16,19],[4,7,11,14]], durRange: [16, 20] },
      hopeful:    { chords: [[0,4,7],[7,11,14],[9,12,16],[5,9,12]],            durRange: [12, 16] },
      melancholy: { chords: [[9,12,16],[5,9,12],[9,12,16],[7,11,14]],          durRange: [15, 19] },
      mysterious: { chords: [[2,5,9],[9,14,16],[5,9,12],[0,2,7]],              durRange: [16, 21] },
      ethereal:   { chords: [[0,2,7],[7,12,14],[5,7,12],[2,7,9]],              durRange: [18, 24] },
      grounded:   { chords: [[0,7],[7,14],[5,12],[9,16]],                      durRange: [12, 16] },
      dramatic:   { chords: [[2,5,9],[2,5,8],[9,12,16],[4,8,11]],              durRange: [14, 18] },
      joyful:     { chords: [[0,4,7],[5,9,12],[7,11,14],[0,4,12]],             durRange: [11, 15] },
    };

    // Mood → instrument pool; one instrument is randomly picked per chord
    const moodInstruments = {
      peaceful:   ['piano', 'flute', 'cello'],
      hopeful:    ['piano', 'guitar', 'violin'],
      melancholy: ['cello', 'violin', 'piano'],
      mysterious: ['cello', 'oboe', 'violin'],
      ethereal:   ['flute', 'violin', 'oboe'],
      grounded:   ['bass', 'guitar', 'piano'],
      dramatic:   ['cello', 'violin', 'bass'],
      joyful:     ['piano', 'guitar', 'flute'],
    };

    const prog        = progressions[mood]    || progressions.peaceful;
    const instruments = moodInstruments[mood] || moodInstruments.peaceful;
    const chords      = prog.chords;
    const [dMin, dMax] = prog.durRange;
    const attack = 3.5, release = 4.0;
    let step = 0;

    const scheduleChord = () => {
      if (!this._musicGain) return;
      const chord      = chords[step % chords.length];
      const durSecs    = dMin + Math.random() * (dMax - dMin);
      const now        = this._ctx.currentTime;
      const instrument = instruments[Math.floor(Math.random() * instruments.length)];
      const isBass     = instrument === 'bass';

      // Always anchor with a sub-bass root unless the selected instrument IS bass
      if (!isBass) this._synthBass(st(chord[0]), now, durSecs, attack, release);

      // Bass plays root only in bass register; all others play the full chord voicing
      const notes = isBass ? [chord[0]] : chord;
      const method = '_synth' + instrument.charAt(0).toUpperCase() + instrument.slice(1);
      notes.forEach(semi => this[method](st(semi), now, durSecs, attack, release));

      step++;
      const t = setTimeout(scheduleChord, (durSecs - release) * 1000);
      this._musicTimeouts.push(t);
    };

    scheduleChord();
  }

  // ── Instrument synthesizers ────────────────────────────────────────────────

  _synthPiano(freq, now, dur, atk, rel) {
    // Additive harmonics — bright attack decays to warm sustain like a struck string
    const ctx = this._ctx;
    const harmonics = [1, 2, 3, 4, 5, 6];
    const hLevels   = [1.0, 0.55, 0.30, 0.15, 0.08, 0.04];
    harmonics.forEach((h, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * h;

      const g = ctx.createGain();
      const peak = 0.08 * hLevels[i];
      const hAtk = Math.min(atk, 0.8 + i * 0.4); // upper partials rise slower
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + hAtk);
      g.gain.setValueAtTime(peak * (i === 0 ? 1.0 : 0.55), now + dur - rel); // partials decay first
      g.gain.linearRampToValueAtTime(0, now + dur);

      // LPF sweeps from bright → warm (hammer brightness decays)
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(6000, now);
      lpf.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 3.5), now + 4);

      osc.connect(g); g.connect(lpf); lpf.connect(this._musicGain);
      osc.start(now); osc.stop(now + dur + 0.1);
      this._musicNodes.push(osc, g, lpf);
    });
  }

  _synthGuitar(freq, now, dur, atk, rel) {
    // Plucked string: triangle wave chorus, fast brightness decay to warm body
    const ctx = this._ctx;
    [-4, 0, +4].forEach(cents => { // slight chorus detune
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq * Math.pow(2, cents / 1200);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.11, now + Math.min(atk, 1.2));
      g.gain.setValueAtTime(0.075, now + dur - rel);
      g.gain.linearRampToValueAtTime(0, now + dur);

      // Bright pluck decays to warm body over ~2.5 s
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.Q.value = 1.2;
      lpf.frequency.setValueAtTime(3500, now);
      lpf.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 2), now + 2.5);

      osc.connect(g); g.connect(lpf); lpf.connect(this._musicGain);
      osc.start(now); osc.stop(now + dur + 0.1);
      this._musicNodes.push(osc, g, lpf);
    });
  }

  _synthBass(freq, now, dur, atk, rel) {
    // Sine + triangle blend always played 2 octaves down for solid bass register
    const ctx = this._ctx;
    const bassFreq = freq / 4; // 2 octaves below input
    [['sine', 0.22], ['triangle', 0.10]].forEach(([type, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = bassFreq;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(level, now + Math.min(atk, 2.0));
      g.gain.setValueAtTime(level, now + dur - rel);
      g.gain.linearRampToValueAtTime(0, now + dur);

      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 280;
      lpf.Q.value = 0.8;

      osc.connect(g); g.connect(lpf); lpf.connect(this._musicGain);
      osc.start(now); osc.stop(now + dur + 0.1);
      this._musicNodes.push(osc, g, lpf);
    });
  }

  _synthViolin(freq, now, dur, atk, rel) {
    // Bowed string: sawtooth + slow bow-pressure attack + vibrato
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.5 + Math.random() * 0.5;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = freq * 0.007; // ±~12 cents
    vib.connect(vibAmt); vibAmt.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.13, now + atk);
    g.gain.setValueAtTime(0.13, now + dur - rel);
    g.gain.linearRampToValueAtTime(0, now + dur);

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 1600;

    osc.connect(g); g.connect(lpf); lpf.connect(this._musicGain);
    osc.start(now); osc.stop(now + dur + 0.1);
    vib.start(now); vib.stop(now + dur + 0.1);
    this._musicNodes.push(osc, vib, vibAmt, g, lpf);
  }

  _synthCello(freq, now, dur, atk, rel) {
    // Warmer and lower than violin: one octave down, heavier LPF, slower vibrato
    const ctx = this._ctx;
    const cFreq = freq / 2; // drop one octave into cello register
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = cFreq;

    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 4.2 + Math.random() * 0.4;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = cFreq * 0.006;
    vib.connect(vibAmt); vibAmt.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.15, now + atk);
    g.gain.setValueAtTime(0.15, now + dur - rel);
    g.gain.linearRampToValueAtTime(0, now + dur);

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 900;
    lpf.Q.value = 1.2;

    osc.connect(g); g.connect(lpf); lpf.connect(this._musicGain);
    osc.start(now); osc.stop(now + dur + 0.1);
    vib.start(now); vib.stop(now + dur + 0.1);
    this._musicNodes.push(osc, vib, vibAmt, g, lpf);
  }

  _synthOboe(freq, now, dur, atk, rel) {
    // Double-reed nasal tone: square wave (odd harmonics) shaped by a BPF
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square'; // rich in odd harmonics → reedy buzz
    osc.frequency.value = freq;

    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.2 + Math.random() * 0.4;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = freq * 0.004;
    vib.connect(vibAmt); vibAmt.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.07, now + Math.min(atk, 1.5));
    g.gain.setValueAtTime(0.07, now + dur - rel);
    g.gain.linearRampToValueAtTime(0, now + dur);

    // BPF centred around 3rd harmonic gives characteristic nasal midrange peak
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = freq * 2.5;
    bpf.Q.value = 2.5;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 2200;

    osc.connect(g); g.connect(bpf); bpf.connect(lpf); lpf.connect(this._musicGain);
    osc.start(now); osc.stop(now + dur + 0.1);
    vib.start(now); vib.stop(now + dur + 0.1);
    this._musicNodes.push(osc, vib, vibAmt, g, bpf, lpf);
  }

  _synthFlute(freq, now, dur, atk, rel) {
    // Breathy + pure: near-pure sine + narrow-BPF noise for breath shimmer
    const ctx = this._ctx;

    // Tonal component
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 4.5 + Math.random() * 0.5;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = freq * 0.004;
    vib.connect(vibAmt); vibAmt.connect(osc.frequency);

    const gTonal = ctx.createGain();
    gTonal.gain.setValueAtTime(0, now);
    gTonal.gain.linearRampToValueAtTime(0.15, now + atk);
    gTonal.gain.setValueAtTime(0.15, now + dur - rel);
    gTonal.gain.linearRampToValueAtTime(0, now + dur);

    // Breathy noise through narrow BPF at the note frequency
    const noiseLen = Math.ceil(ctx.sampleRate * 0.5);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;

    const breathBpf = ctx.createBiquadFilter();
    breathBpf.type = 'bandpass';
    breathBpf.frequency.value = freq;
    breathBpf.Q.value = 8;

    const gBreath = ctx.createGain();
    gBreath.gain.setValueAtTime(0, now);
    gBreath.gain.linearRampToValueAtTime(0.048, now + atk);
    gBreath.gain.setValueAtTime(0.048, now + dur - rel);
    gBreath.gain.linearRampToValueAtTime(0, now + dur);

    osc.connect(gTonal);       gTonal.connect(this._musicGain);
    noise.connect(breathBpf);  breathBpf.connect(gBreath);  gBreath.connect(this._musicGain);
    osc.start(now);   osc.stop(now + dur + 0.1);
    vib.start(now);   vib.stop(now + dur + 0.1);
    noise.start(now); noise.stop(now + dur + 0.1);
    this._musicNodes.push(osc, vib, vibAmt, gTonal, noise, breathBpf, gBreath);
  }

  /* ── Fade / stop ───────────────────────────────────────────────────── */

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
    if (this._master) this._master.gain.setValueAtTime(0, this._ctx.currentTime);
    this._stopNodes();
  }

  _stopNodes() {
    this._scheduledTimeouts.forEach(id => clearTimeout(id));
    this._scheduledTimeouts = [];
    this._nodes.forEach(n => {
      try { n.stop && n.stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    this._nodes = [];
  }
}