# Deep Meditation

An AI-powered guided meditation web app. Describe what you want to meditate on, choose a duration, and receive a personalised visual + audio experience powered by GitHub Models (Copilot AI).

## Features

- 🔐 **Login with GitHub** – no accounts or passwords
- 🧠 **AI-generated meditation** – topic-specific guidance, colour palette and ambient sound selection
- 🌬️ **Breathing animation** – canvas-based circle that pulses to your breath
- 🎵 **Synthesised ambient audio** – cosmic drones, ocean, rain or forest generated entirely in the browser via Web Audio API, with theta-wave binaural beats
- ⏱️ **Configurable duration** – 5, 10, 15, 20 or 30 minutes
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
# Edit .env and fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET
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

| Variable              | Required | Description |
|-----------------------|----------|-------------|
| `GITHUB_CLIENT_ID`    | ✅       | OAuth App client ID |
| `GITHUB_CLIENT_SECRET`| ✅       | OAuth App client secret |
| `SESSION_SECRET`      | ✅       | Random secret for session encryption |
| `BASE_URL`            | ✅       | Public URL (used for OAuth callback) |
| `AI_MODEL`            | optional | GitHub Models model name (default: `gpt-4o-mini`) |
| `PORT`                | optional | HTTP port (default: `3000`) |

## AI Access

This app uses the **GitHub Models** API (`models.inference.ai.azure.com`), which is available to all GitHub users. Your GitHub OAuth token is used directly – no additional API keys are needed.

## Technology

- **Backend**: Node.js + Express (no database)
- **Frontend**: Vanilla JavaScript, Canvas API, Web Audio API
- **Auth**: GitHub OAuth 2.0
- **AI**: GitHub Models (Copilot AI) – `gpt-4o-mini` / `gpt-4o`
- **Container**: Docker + Docker Compose

