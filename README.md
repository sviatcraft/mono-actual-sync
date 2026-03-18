# Monobank → Actual Budget Sync

Self-hosted web UI that syncs transactions from **Monobank** into an **Actual Budget** server.

The goal is “start it, open the UI, configure, sync” — no env-var juggling required for normal use. 

## Quickstart (Pre-built Docker Image)

The easiest way to run the app is using the pre-built Docker image from the GitHub Container Registry.

### 1) Prerequisites
- Docker with `docker compose`
- An Actual Budget server you can reach from this container (URL + password + **Budget Sync ID**)
- A Monobank **Personal Token**

### 2) Start the app
Create a `docker-compose.yml` file:

```yaml
services:
  mono-actual-sync:
    image: ghcr.io/sviatcraft/mono-actual-sync:latest
    container_name: mono-actual-sync
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      # Set your timezone so imported transaction dates match your local day boundary.
      TZ: "Europe/Kyiv"
    volumes:
      - mono_actual_sync_data:/app/backend/data
    restart: unless-stopped

volumes:
  mono_actual_sync_data:
```

Run the following command in the same directory:
```bash
docker compose up -d
```
Open `http://localhost:3000` (or your server's IP if you changed the port mapping).

---

## CasaOS Installation

This app is designed to run on CasaOS. 

1. Open your CasaOS Dashboard.
2. Click the **+** icon and select **Install a customized app**.
3. Click the **Import** button in the top right.
4. Paste the `docker-compose.yml` code from the Quickstart section above.
5. *(Optional)* To get the app to appear correctly in your dashboard UI, you can manually set the **Web UI port** to `3000` in the CasaOS visual settings before clicking Install.
6. Click **Install**. 

*(Note: Full native CasaOS App Store integration via an `x-casaos` config block is planned for the future).*

---

## Configuration in the UI

Once the app is running, open the web UI:

- Paste your Monobank token.
- Enter Actual `Server URL`, `Server Password`, and `Budget Sync ID`.
- Fetch accounts, then map Monobank accounts/cards/jars → Actual accounts.
- Click **Sync now** (optionally enable hourly background sync).

---

## Important security note (read before exposing)

- There is currently **no login / authentication** for `/api/*`.
- The default configuration binds to `0.0.0.0:3000`, making the UI/API reachable from your LAN.
- Anyone on the same network who can reach the service can read decrypted config (including tokens) and trigger syncs. **Do not expose this port to the public internet.**
- To restrict access to localhost only, change the port mapping to `"127.0.0.1:3000:3000"`.

## Data persistence + encryption (automatic)

- Configuration is saved to `backend/data/config.json` (encrypted at rest).
- The encryption key is stored alongside it in `backend/data/.encryption_key`.
- In Docker, the compose volume `mono_actual_sync_data` persists both files across restarts.

**Backup tip:** back up `config.json` and `.encryption_key` together — losing the key means the config can’t be decrypted.

## Common setup gotcha: Actual server URL from Docker

The Actual `Server URL` must be reachable **from inside the container**.

- If Actual runs on another machine: use that machine’s LAN IP/hostname + port.
- If Actual runs on the same computer:
  - macOS/Windows Docker Desktop usually supports `http://host.docker.internal:<port>`
  - Linux (including CasaOS) generally requires using your host’s LAN IP (e.g., `http://192.168.1.X:5006`).

## Features

- Web UI to configure credentials, mapping, and automation
- Manual “Sync now”
- Optional hourly background sync (node-cron)
- Basic protection against Monobank rate limits (60s cooldown between Monobank calls)

---

## Advanced: Building from Source

If you prefer to build the Docker image locally instead of using the pre-built registry image:

```bash
git clone https://github.com/sviatcraft/mono-actual-sync.git
cd mono-actual-sync
docker compose -f docker-compose.dev.yml up --build -d
```
*(Requires creating a local `docker-compose.dev.yml` that uses `build: .` instead of the `image` key).*

## Advanced: local development (two processes)

Prereqs: Node.js 18+ and npm.

**1) Backend**
```bash
cd backend
npm install
npm run dev
```

**2) Frontend**
```bash
cd frontend
npm install
npm run dev
```

Open the Vite dev server URL (usually `http://localhost:5173`). In dev, Vite proxies `/api` → `http://localhost:3000` (see `frontend/vite.config.js`).

---

## Backend API (for debugging)

Endpoints (all under `/api`):

- `GET /api/config` – returns decrypted config (or defaults)
- `POST /api/config` – saves config (encrypted) and (re)starts cron depending on `useNodeCron`
- `POST /api/fetch-accounts` – verifies credentials, fetches account lists, persists `accountCache`
- `POST /api/sync` – starts a sync using the saved config
- `GET /api/sync-status` – returns `{ isSyncing: boolean }`

Rate limiting:
- Enforces a 60s cooldown between Monobank calls (returns `429` with a `waitTime`).

## Troubleshooting

- **“Rate limit active”**: Monobank calls are gated to 1 request per 60 seconds. Wait for the cooldown.
- **Actual connection errors**: Double-check Actual `Server URL`, `Budget Sync ID`, and `Server Password`. Remember to use your server's LAN IP if running on Linux/CasaOS.
- **“Invalid Personal Token”**: Recreate or re-copy the Monobank Personal Token.

## Status / roadmap

- [x] Publish pre-built Docker image to GHCR.
- [ ] Add `x-casaos` metadata for true 1-click CasaOS App Store integration.
- [ ] Add optional app-level authentication for `/api/*` (e.g. `APP_TOKEN` / Basic Auth)