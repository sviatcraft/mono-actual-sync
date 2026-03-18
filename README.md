# Monobank → Actual Budget Sync

Self-hosted web UI that syncs transactions from **Monobank** into an **Actual Budget** server.

The goal is “start it, open the UI, configure, sync” — no env-var juggling required for normal use.

## Quickstart (Docker, recommended)

### 1) Prerequisites

- Docker (Docker Desktop or Docker Engine) with `docker compose`
- An Actual Budget server you can reach from this container (URL + password + **Budget Sync ID**)
- A Monobank **Personal Token**

### 2) Start the app

```bash
docker compose up --build -d
```

Open:

- `http://localhost:3000`

### 3) Configure in the UI

In the web UI:

- Paste your Monobank token
- Enter Actual `Server URL`, `Server Password`, and `Budget Sync ID`
- Fetch accounts, then map Monobank accounts/cards/jars → Actual accounts
- Click **Sync now** (optionally enable hourly background sync)

### 4) Stop / view logs

```bash
docker compose logs -f
docker compose down
```

## Important security note (read before exposing)

- There is currently **no login / authentication** for `/api/*`.
- `docker-compose.yml` binds to `127.0.0.1:3000` (localhost-only) by default so it’s not exposed to your LAN.
- If you change ports to `3000:3000` (LAN/WAN exposure), anyone who can reach the service can read decrypted config (including tokens) and trigger syncs.

## Data persistence + encryption (automatic)

- Configuration is saved to `backend/data/config.json` (encrypted at rest).
- The encryption key is stored alongside it in `backend/data/.encryption_key`.
- In Docker, the compose volume `mono_actual_sync_data` persists both files across restarts.

Backup tip: back up `config.json` and `.encryption_key` together — losing the key means the config can’t be decrypted.

## Common setup gotcha: Actual server URL from Docker

The Actual `Server URL` must be reachable **from inside the container**.

- If Actual runs on another machine: use that machine’s LAN IP/hostname + port.
- If Actual runs on the same computer:
  - macOS/Windows Docker Desktop usually supports `http://host.docker.internal:<port>`
  - Linux may require using your host’s LAN IP (or other Docker networking setup)

## Features

- Web UI to configure credentials, mapping, and automation
- Manual “Sync now”
- Optional hourly background sync (node-cron)
- Basic protection against Monobank rate limits (60s cooldown between Monobank calls)

## Advanced: docker run (instead of compose)

```bash
docker build -t mono-actual-sync .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e TZ="Europe/Kyiv" \
  -v mono_actual_sync_data:/app/backend/data \
  mono-actual-sync
```

## Advanced: local development (two processes)

Prereqs: Node.js 18+ and npm.

1) Backend

```bash
cd backend
npm install
npm run dev
```

2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite dev server URL (usually `http://localhost:5173`). In dev, Vite proxies `/api` → `http://localhost:3000` (see `frontend/vite.config.js`).

## Runtime environment variables (optional)

- `PORT` (default `3000`)
- `TZ` (recommended)
  - Sets server timezone for correct `YYYY-MM-DD` transaction dates.
- `CORS_ORIGIN` / `CORS_ORIGINS` (advanced)
  - By default, CORS is disabled (recommended for single-origin/local use).
  - Set only if hosting the frontend on a different origin and you need browser access to `/api/*`.

## Backend API (for debugging)

Endpoints (all under `/api`):

- `GET /api/config` – returns decrypted config (or defaults)
- `POST /api/config` – saves config (encrypted) and (re)starts cron depending on `useNodeCron`
- `POST /api/fetch-accounts` – verifies credentials, fetches account lists, persists `accountCache`
- `POST /api/sync` – starts a sync using the saved config
- `GET /api/sync-status` – returns `{ isSyncing: boolean }`

Rate limiting:

- Enforces a 60s cooldown between Monobank calls (returns `429` with a `waitTime`).

## How sync works (high level)

- Connect to Actual using `@actual-app/api` and download the budget by Sync ID.
- Fetch Monobank statements (paged if Monobank returns 500 items).
- Import into the mapped Actual account using `imported_id` for deduping.

## Repo layout

- `backend/index.js`: Express server, encrypted config read/write, cron orchestration, API routes
- `backend/mono_actual.js`: Monobank fetch + transaction transform + Actual import + UI account fetching
- `frontend/src/*`: Svelte UI

## Troubleshooting

- “Rate limit active”
  - Monobank calls are gated to 1 request per 60 seconds. Wait for the cooldown.
- Actual connection errors
  - Double-check Actual `Server URL`, `Budget Sync ID`, and `Server Password`.
- “Invalid Personal Token”
  - Recreate or re-copy the Monobank Personal Token.

## Status / roadmap

This repo targets a single-container Docker image suitable for platforms like CasaOS.

TODO:

- Add optional app-level authentication for `/api/*` (e.g. `APP_TOKEN` / Basic Auth)
- Add a `/api/health` endpoint + Docker healthcheck
