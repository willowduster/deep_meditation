# Deep Meditation

An AI-powered guided meditation web app. Describe what you want to meditate on, choose a duration and mood, and receive a personalised visual and audio experience powered by GitHub Models.

## Features

- 🔐 **Login with GitHub** – no accounts or passwords; guest access also supported
- 🧠 **AI-generated meditation** – topic-specific guided session, colour palette, and ambient sound layers
- 🎨 **Live canvas animation** – breathing circle that pulses in sync with each phase
- 🌊 **18-layer ambient synthesiser** – cosmic drones, binaural beats, filtered noise textures and more, all generated in the browser via Web Audio API
- 🎹 **Generative music engine** – chord pad synthesiser with 7 instruments (piano, guitar, bass, violin, cello, oboe, flute) and a sparse arpeggiator, driven by your mood selection
- 🎭 **Multi-select mood picker** – choose one or more moods (Peaceful, Hopeful, Melancholy, Mysterious, Ethereal, Grounded, Dramatic, Joyful) to shape the music
- 🔊 **Studio-quality DSP** – convolution reverb (4.2 s decay) and stereo ping-pong delay on every audio path
- ⏱️ **Configurable duration** – 5, 10, 15, 20 or 30 minutes
- 💾 **Record & download** – capture the full session audio and export as **WAV**, **FLAC**, or **MP3 @ 256 kbps**, entirely in the browser
- 🐳 **Fully self-contained Docker deployment**

## Quick Start

### 1. Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Set **Homepage URL** to your app's URL (e.g. `http://localhost:3000`)
3. Set **Authorization callback URL** to `http://localhost:3000/auth/github/callback`
4. Copy the **Client ID** and generate a **Client Secret**

### 2. Configure environment

```bash
cp .env.example .env
```

Generate a secure `SESSION_SECRET`:

```bash
# macOS / Linux / WSL
openssl rand -hex 32

# Windows PowerShell (if openssl is unavailable)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Edit `.env` and fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `SESSION_SECRET`.

To enable **guest access** (no GitHub login required), add your own GitHub personal access token:

```
GITHUB_SERVER_TOKEN=ghp_...
```

### 3. Run with Docker

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

### Run without Docker (Node.js ≥ 18)

```bash
cd server
npm install
cd ..
node server/index.js
```

## Environment Variables

| Variable               | Required | Description |
|------------------------|----------|-------------|
| `GITHUB_CLIENT_ID`     | ✅       | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | ✅       | OAuth App client secret |
| `SESSION_SECRET`       | ✅       | Random secret for session encryption |
| `BASE_URL`             | ✅       | Public URL (used for OAuth callback) |
| `GITHUB_SERVER_TOKEN`  | optional | GitHub PAT used for guest sessions and server-side AI calls |
| `AI_MODEL`             | optional | GitHub Models model name (default: `gpt-4o-mini`) |
| `PORT`                 | optional | HTTP port (default: `3000`) |
| `NODE_ENV`             | optional | Set to `production` to enforce Secure cookies |
| `SECURE_COOKIES`       | optional | Set to `1` to enforce Secure cookies without full production mode |

## AI Access

Uses the **GitHub Models** API (`models.inference.ai.azure.com`), available to all GitHub users. Your GitHub OAuth token is forwarded directly — no extra API keys needed. When `GITHUB_SERVER_TOKEN` is set, it is used for guest sessions.

## Download & Export

After a session ends, click the **download button** in the player footer to open the export modal. Choose a format:

| Format | Details |
|--------|---------|
| WAV    | Lossless 16-bit PCM, pure browser encoding |
| FLAC   | Lossless compressed, pure browser encoding |
| MP3    | 256 kbps, encoded via [lamejs](https://github.com/nicktindall/lamejs) loaded from CDN |

Recording starts automatically when the session begins and stops when it ends, so the complete audio is always captured.

## Technology

- **Backend**: Node.js + Express (no database)
- **Frontend**: Vanilla JavaScript, Canvas API, Web Audio API
- **Auth**: GitHub OAuth 2.0 + optional guest mode
- **AI**: GitHub Models (Copilot AI) – `gpt-4o-mini` / `gpt-4o`
- **Audio export**: Pure JS WAV/FLAC encoders + lamejs for MP3
- **Container**: Docker + Docker Compose

