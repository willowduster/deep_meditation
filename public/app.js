/* app.js – main application logic */
'use strict';

const App = {
  user:            null,
  duration:        10,
  mood:            'peaceful',
  meditationData:  null,
  _bgCanvas:       null,
  _medCanvas:      null,
  _audio:          new MeditationAudio(),
  _sessionActive:  false,
  _cancelPhase:    null,
  _csrfToken:      null,

  // ── Startup ───────────────────────────────────────────────────────────
  async init() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error')) {
      const msg = {
        auth_cancelled:    'Login was cancelled.',
        token_failed:      'Could not exchange token with GitHub.',
        auth_error:        'An authentication error occurred.',
        guest_unavailable: 'Guest access is not enabled on this server.',
      }[params.get('error')] || 'Login failed.';
      document.getElementById('login-error').textContent = msg;
      document.getElementById('login-error').classList.remove('hidden');
      history.replaceState({}, '', '/');
    }

    // Fetch CSRF token and user state in parallel
    const [csrfData, userData] = await Promise.all([
      fetch('/api/csrf-token').then(r => r.json()).catch(() => ({ token: null })),
      fetch('/api/user').then(r => r.json()).catch(() => ({ user: null }))
    ]);
    this._csrfToken = csrfData.token;
    this.user = userData.user;

    this._bindEvents();

    if (this.user) {
      this._showSetup();
    } else {
      this._showLogin();
    }
  },

  // ── Authenticated fetch helper (adds CSRF token) ──────────────────────
  async _post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this._csrfToken || ''
      },
      body: JSON.stringify(body)
    });
  },

  // ── Event bindings ────────────────────────────────────────────────────
  _bindEvents() {
    // Duration picker
    document.querySelectorAll('.duration-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.duration = Number(btn.dataset.value);
      });
    });

    // Topic textarea
    const topic   = document.getElementById('meditation-topic');
    const counter = document.getElementById('topic-counter');
    const beginBtn = document.getElementById('btn-begin');
    topic.addEventListener('input', () => {
      const n = topic.value.length;
      counter.textContent = `${n} / 500`;
      beginBtn.disabled = n < 3;
    });

    // Begin
    beginBtn.addEventListener('click', () => this._beginMeditation());

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await this._post('/auth/logout', {}).catch(() => {});
      location.reload();
    });

    // End session
    document.getElementById('btn-end').addEventListener('click', () => this._endMeditation());

    // Meditate again
    document.getElementById('btn-again').addEventListener('click', () => this._showSetup());
  },

  // ── Views ─────────────────────────────────────────────────────────────
  _setView(name) {
    ['login', 'setup', 'meditation', 'complete'].forEach(v => {
      document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name);
    });
  },

  _startBg(id) {
    if (this._bgCanvas) { this._bgCanvas.stop(); this._bgCanvas = null; }
    this._bgCanvas = new BackgroundCanvas(id);
    this._bgCanvas.start();
  },

  _showLogin() {
    this._setView('login');
    this._startBg('bg-canvas');
  },

  _showSetup() {
    this._setView('setup');
    this._startBg('bg-canvas-setup');
    if (this.user) {
      const nameEl   = document.getElementById('user-name');
      const avatarEl = document.getElementById('user-avatar');
      nameEl.textContent = this.user.name;
      if (this.user.avatar_url) {
        avatarEl.src = this.user.avatar_url;
        avatarEl.style.display = '';
      } else {
        // Guest — use a generated SVG avatar
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="18" fill="#2a2540"/>
          <circle cx="18" cy="14" r="6" fill="#7c6bff" opacity="0.9"/>
          <path d="M6 32c0-6.627 5.373-10 12-10s12 3.373 12 10" fill="#7c6bff" opacity="0.7"/>
        </svg>`;
        avatarEl.src = 'data:image/svg+xml;base64,' + btoa(svg);
        avatarEl.style.display = '';
      }
    }
    // Reset form state
    document.getElementById('meditation-topic').value = '';
    document.getElementById('topic-counter').textContent = '0 / 500';
    document.getElementById('btn-begin').disabled = true;
    document.getElementById('setup-error').classList.add('hidden');
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('meditation-mood').value = this.mood;
  },

  // ── Begin meditation ──────────────────────────────────────────────────
  async _beginMeditation() {
    const topicEl  = document.getElementById('meditation-topic');
    const topic    = topicEl.value.trim();
    if (topic.length < 3) return;

    const beginBtn = document.getElementById('btn-begin');
    const loading  = document.getElementById('loading');
    const errEl    = document.getElementById('setup-error');

    // Warm up AudioContext NOW while we're still inside the user-gesture handler.
    // Browsers block AudioContext.resume() if called outside a gesture.
    this._audio._ensureContext().catch(() => {});

    // Capture mood at click time
    this.mood = document.getElementById('meditation-mood').value || 'peaceful';

    beginBtn.disabled = true;
    loading.classList.remove('hidden');
    errEl.classList.add('hidden');

    try {
      const res = await this._post('/api/meditation', { topic, duration: this.duration, mood: this.mood });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      this.meditationData = body;
      this._startSession();
    } catch (err) {
      errEl.textContent = `${err.message}`;
      errEl.classList.remove('hidden');
      beginBtn.disabled = false;
      loading.classList.add('hidden');
    }
  },

  // ── Session ───────────────────────────────────────────────────────────
  _startSession() {
    const data   = this.meditationData;
    const phases = data.phases || [];
    const total  = phases.reduce((s, p) => s + (p.duration || 0), 0);

    this._setView('meditation');
    if (this._bgCanvas) { this._bgCanvas.stop(); this._bgCanvas = null; }

    // Canvas
    const cv = document.getElementById('meditation-canvas');
    this._medCanvas = new MeditationCanvas(cv);
    const t = data.colorTheme || {};
    this._medCanvas.setTheme(t.primary, t.secondary, t.background);
    this._medCanvas.start();

    // UI text
    document.getElementById('meditation-title').textContent = data.title || 'Meditation';
    document.getElementById('timer-total').textContent = this._fmt(total);
    document.getElementById('timer-elapsed').textContent = '0:00';

    // Audio (async – won't block)
    const layers = Array.isArray(data.soundLayers) && data.soundLayers.length
      ? data.soundLayers
      : (data.ambientSound ? [data.ambientSound] : ['cosmic_drone']);
    this._audio.start(layers).catch(() => {});
    this._audio.startMusic(this.mood).catch(() => {});

    // Run phases
    this._sessionActive = true;
    this._runPhases(phases, total).catch(() => {});
  },

  async _runPhases(phases, total) {
    const start = Date.now();

    const ticker = setInterval(() => {
      if (!this._sessionActive) { clearInterval(ticker); return; }
      const el = document.getElementById('timer-elapsed');
      if (el) el.textContent = this._fmt(Math.min(Math.floor((Date.now() - start) / 1000), total));
    }, 1000);

    try {
      for (let i = 0; i < phases.length; i++) {
        if (!this._sessionActive) break;

        const ph = phases[i];

        // Update text (fade out → swap → fade in)
        const textEl = document.getElementById('phase-text');
        textEl.classList.remove('visible');
        await this._sleep(1100);
        if (!this._sessionActive) break;
        textEl.textContent = ph.text || '';
        textEl.classList.add('visible');

        // Phase name
        const nameEl = document.getElementById('phase-name');
        if (nameEl) nameEl.textContent = this._phaseName(ph.type);

        // Breath pattern + ring
        if (ph.breathPattern) this._medCanvas.setBreathPattern(ph.breathPattern);
        if (i > 0) { this._medCanvas.triggerRing(); }

        // Hold for the phase duration (minus the 600 ms fade already waited)
        await this._sleep(Math.max(0, (ph.duration || 0) * 1000 - 600));
      }
    } finally {
      clearInterval(ticker);
    }

    if (this._sessionActive) this._completeSession(total);
  },

  _sleep(ms) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      this._cancelPhase = () => { clearTimeout(id); reject(new Error('cancelled')); };
    }).finally(() => { this._cancelPhase = null; });
  },

  _completeSession(total) {
    this._sessionActive = false;
    setTimeout(() => { this._audio.fadeOut(3); this._audio.stopMusic(3); }, 1000);
    setTimeout(() => { if (this._medCanvas) { this._medCanvas.stop(); this._medCanvas = null; } }, 3500);

    this._setView('complete');
    this._startBg('bg-canvas-complete');

    document.getElementById('complete-duration').textContent =
      `You completed a ${this._fmt(total)} meditation.`;

    const aff = (this.meditationData.affirmations || []);
    document.getElementById('complete-affirmation').textContent =
      aff[Math.floor(Math.random() * aff.length)] || '';
  },

  _endMeditation() {
    this._sessionActive = false;
    if (this._cancelPhase) { this._cancelPhase(); this._cancelPhase = null; }
    this._audio.stop();
    this._audio.stopMusic(0);
    if (this._medCanvas) { this._medCanvas.stop(); this._medCanvas = null; }
    this._showSetup();
  },

  // ── Helpers ───────────────────────────────────────────────────────────
  _fmt(secs) {
    const s = Math.max(0, Math.round(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },

  _phaseName(type) {
    return {
      intro:         'Opening',
      breathing:     'Breathing',
      visualization: 'Visualization',
      deepening:     'Deep Meditation',
      affirmation:   'Affirmation',
      closing:       'Closing'
    }[type] || (type || '');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
