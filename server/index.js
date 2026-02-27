'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'deep-meditation-dev-secret';
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Using insecure default – set it in production.');
}
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const AI_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn('WARNING: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set. OAuth will not work.');
}

const SECURE_COOKIES = process.env.NODE_ENV === 'production' || process.env.SECURE_COOKIES === '1';

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ── CSRF protection ───────────────────────────────────────────────────────────

// Ensure every session has a CSRF token
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  next();
});

// Validate CSRF token on state-changing requests (skipped for OAuth callback)
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // Also reject requests from unexpected origins
    const origin = req.get('Origin');
    if (origin && origin !== BASE_URL) {
      return res.status(403).json({ error: 'Cross-origin request rejected' });
    }
    const token = req.get('X-CSRF-Token');
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ error: 'CSRF token invalid' });
    }
  }
  next();
});

// Expose CSRF token to the frontend
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: req.session.csrfToken });
});

// ── GitHub OAuth ──────────────────────────────────────────────────────────────

app.get('/auth/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(500).send('GitHub OAuth is not configured on this server.');
  }
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/github/callback`,
    scope: 'read:user'
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/?error=auth_cancelled');
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${BASE_URL}/auth/github/callback`
      })
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.redirect('/?error=token_failed');
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'DeepMeditation/1.0'
      }
    });
    const user = await userRes.json();

    req.session.user = {
      login: user.login,
      name: user.name || user.login,
      avatar_url: user.avatar_url
    };
    req.session.github_token = tokenData.access_token;

    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.redirect('/?error=auth_error');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.json({ success: true });
  });
});

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/user', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/meditation', async (req, res) => {
  if (!req.session.user || !req.session.github_token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { topic, duration, mood } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length < 3 || topic.length > 500) {
    return res.status(400).json({ error: 'Invalid topic (3–500 characters)' });
  }
  const validMoods = ['peaceful','hopeful','melancholy','mysterious','ethereal','grounded','dramatic','joyful'];
  const moodStr = validMoods.includes(mood) ? mood : 'peaceful';
  const durationNum = Number(duration);
  if (![5, 10, 15, 20, 30].includes(durationNum)) {
    return res.status(400).json({ error: 'Duration must be 5, 10, 15, 20, or 30 minutes' });
  }

  const totalSeconds = durationNum * 60;

  const prompt = `Create a ${durationNum}-minute guided meditation.
User's intention: "${topic.trim()}"
Emotional mood: ${moodStr}

Let the mood shape the tone and language of all guidance. Return ONLY a valid JSON object — no markdown, no explanation — with this exact shape:
{
  "title": "<short evocative title>",
  "phases": [
    {
      "duration": <integer seconds>,
      "type": "intro",
      "text": "<2-3 sentence opening guidance>",
      "breathPattern": { "inhale": 4, "hold": 2, "exhale": 6, "rest": 0 }
    },
    {
      "duration": <integer seconds>,
      "type": "breathing",
      "text": "<breathing guidance>",
      "breathPattern": { "inhale": 4, "hold": 4, "exhale": 4, "rest": 2 }
    },
    {
      "duration": <integer seconds>,
      "type": "visualization",
      "text": "<vivid 3-5 sentence visualization specific to the topic>",
      "breathPattern": { "inhale": 4, "hold": 2, "exhale": 6, "rest": 2 }
    },
    {
      "duration": <integer seconds>,
      "type": "deepening",
      "text": "<deepening guidance tailored to the topic>",
      "breathPattern": { "inhale": 5, "hold": 5, "exhale": 7, "rest": 3 }
    },
    {
      "duration": <integer seconds>,
      "type": "closing",
      "text": "<gentle return to awareness>",
      "breathPattern": { "inhale": 4, "hold": 2, "exhale": 6, "rest": 2 }
    }
  ],
  "colorTheme": {
    "primary": "<hex e.g. #7c6bff>",
    "secondary": "<lighter hex>",
    "background": "<very dark hex>"
  },
  "soundLayers": ["<layer1>", "<layer2>"],
  "affirmations": ["<affirmation 1>", "<affirmation 2>", "<affirmation 3>"]
}

For soundLayers choose 1–4 layers that best match the topic from this list ONLY:
waves, rain_heavy, rain_light, drips, wind_soft, wind_strong, thunder_distant,
crickets, frogs, birds_forest, birds_tropical, seagulls,
fire_crackling, stream_brook, cave_drips,
cosmic_drone, singing_bowl, om_chant,
silence

Examples:
- "beach" or "ocean" → ["waves", "wind_soft", "seagulls"]
- "forest" or "nature walk" → ["birds_forest", "wind_soft", "stream_brook"]
- "rain" or "stormy" → ["rain_heavy", "thunder_distant"]
- "fire" or "fireplace" or "cozy" → ["fire_crackling"]
- "crickets" or "night" or "summer night" → ["crickets", "frogs"]
- "meditation" or "zen" or "calm" → ["singing_bowl", "cosmic_drone"]
- "cave" or "underground" → ["cave_drips", "wind_soft"]
- "tropical" → ["birds_tropical", "waves", "wind_soft"]

IMPORTANT: phase durations must sum to exactly ${totalSeconds} seconds.`;

  try {
    const aiRes = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.session.github_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a compassionate meditation guide. Always respond with valid JSON only.'
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('GitHub Models API error:', aiRes.status, errText);
      return res.status(502).json({
        error: 'AI service unavailable. Make sure your GitHub account has access to GitHub Models (github.com/marketplace/models).',
        status: aiRes.status
      });
    }

    const aiData = await aiRes.json();

    if (!aiData.choices || !aiData.choices[0]) {
      return res.status(502).json({ error: 'Empty response from AI service' });
    }

    let meditation;
    try {
      const raw = aiData.choices[0].message.content;
      // Strip optional markdown code fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      meditation = JSON.parse(cleaned);
    } catch (_) {
      return res.status(502).json({ error: 'Could not parse AI response as JSON' });
    }

    // Normalize durations so they sum to exactly totalSeconds
    if (Array.isArray(meditation.phases) && meditation.phases.length > 0) {
      const sum = meditation.phases.reduce((s, p) => s + (Number(p.duration) || 0), 0);
      if (sum > 0 && Math.abs(sum - totalSeconds) > 10) {
        const scale = totalSeconds / sum;
        let adjusted = 0;
        meditation.phases = meditation.phases.map((p, i) => {
          if (i === meditation.phases.length - 1) {
            return { ...p, duration: totalSeconds - adjusted };
          }
          const d = Math.max(10, Math.round((p.duration || 0) * scale));
          adjusted += d;
          return { ...p, duration: d };
        });
      }
    }

    res.json(meditation);
  } catch (err) {
    console.error('Meditation generation error:', err.message);
    res.status(500).json({ error: 'Server error while generating meditation' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Deep Meditation running at http://0.0.0.0:${PORT}`);
});
