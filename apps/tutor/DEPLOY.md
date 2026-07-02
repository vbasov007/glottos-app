# Deploying text-tutor to DigitalOcean App Platform

## Overview

The production setup is a single Docker container that:
- Builds the Vite React SPA at image-build time
- Serves static files + the Express API from one process on port 8080
- Connects to your existing PostgreSQL database via `DATABASE_URL`

---

## Prerequisites

| Tool | Install |
|------|---------|
| `doctl` CLI | https://docs.digitalocean.com/reference/doctl/how-to/install/ |
| Docker Desktop | https://www.docker.com/products/docker-desktop/ (local testing only) |
| GitHub repo pushed | `git remote -v` should show `vbasov007/text-tutor` |

**Important:** All `doctl` commands below run on your **local development machine**, not on a DigitalOcean server. `doctl` is a CLI client that communicates with DO's API remotely.

Authenticate doctl once (locally):
```bash
doctl auth init
# paste your DO Personal Access Token when prompted
```

---

## Prerequisites: Google Cloud TTS Setup

The app uses **Google Cloud Text-to-Speech API** for audio synthesis. Set this up before deployment:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable the **Text-to-Speech API** (APIs & Services → Library → Text-to-Speech)
4. Create a **Service Account**:
   - IAM & Admin → Service Accounts → Create Service Account
   - Name: `text-tutor-tts`
   - Grant role: `Cloud Text-to-Speech Editor`
5. Create a **JSON key**:
   - Service Accounts → Select your account → Keys → Add Key → JSON
   - Download the JSON file
6. **Base64 encode the JSON key** (for environment variable):
   ```bash
   cat /path/to/service-account-key.json | base64
   ```
   Save this value for later (Step 4)

**Cost:** Google Cloud Text-to-Speech: ~$0.004 per 1M characters (~$2/month for light use)

---

## Step 1 — Local Docker smoke test (optional but recommended)

Verify the image builds and runs correctly before touching the cloud.

```bash
# Build (substitute your actual key values)
docker build \
  --build-arg GEMINI_API_KEY=your_gemini_key \
  --build-arg GOOGLE_CLIENT_ID=your_google_client_id \
  -t text-tutor .

# Run against your existing Postgres (or skip DATABASE_URL to test UI only)
docker run \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e NODE_ENV=production \
  -e PORT=8080 \
  -e GOOGLE_CLOUD_TTS_CREDENTIALS="<base64-encoded-service-account-key>" \
  -p 8080:8080 \
  text-tutor
```

Open http://localhost:8080 — you should see the React app.
API calls to `/api/*` should return JSON (401 if no session, which is correct).

---

## Step 2 — Push code to GitHub

All deployment files must be on the `main` branch:

```bash
git add Dockerfile .dockerignore .do/app.yaml server.ts package.json
git commit -m "chore: add DigitalOcean App Platform deployment config"
git push origin main
```

---

## Step 3 — Create the App Platform app

### Option A — Dashboard (recommended)

1. Go to https://cloud.digitalocean.com/apps
2. Click **Create App**
3. Select **GitHub** as the source
4. Connect your GitHub account (if not already connected)
5. Select the `vbasov007/text-tutor` repo and `main` branch
6. Click **Next** — it auto-detects the `Dockerfile`
7. Click **Create App**

Save the **App ID** from the URL or the dashboard. Proceed to Step 4 to set secrets.

### Option B — doctl CLI

```bash
doctl apps create --spec .do/app.yaml
```

> **Note:** This requires GitHub authentication in doctl. If you get a `GitHub user not authenticated` error, use Option A (dashboard) instead.

The command prints an **App ID** — save it.

---

> The first deploy will **fail** because the secret env vars are not set yet.
> That is expected — fix it in Step 4.

---

## Step 4 — Set secret environment variables

Secret values cannot be stored in `app.yaml` (it would commit secrets to git). Set them via the dashboard or CLI.

| Variable | Source |
|----------|--------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLOUD_TTS_CREDENTIALS` | Base64-encoded service account JSON (from prerequisites) |
| `DATABASE_URL` | Your PostgreSQL connection string |

### Option A — Dashboard (easiest)

1. Go to https://cloud.digitalocean.com/apps → select **text-tutor-app**
2. **Settings** → **web** component → **Environment Variables**
3. Set each variable:
   - `GEMINI_API_KEY` → your Google AI Studio API key
   - `GOOGLE_CLIENT_ID` → your Google OAuth client ID
   - `GOOGLE_CLOUD_TTS_CREDENTIALS` → base64-encoded service account JSON
   - `DATABASE_URL` → your PostgreSQL connection string
4. Click **Deploy** to trigger a new build with the secrets

### Option B — doctl CLI

```bash
# Get your App ID
APP_ID=$(doctl apps list --format ID --no-header | head -1)

doctl apps update $APP_ID --spec - <<'EOF'
name: text-tutor
services:
  - name: web
    dockerfile_path: Dockerfile
    github:
      repo: vbasov007/text-tutor
      branch: main
      deploy_on_push: true
    http_port: 8080
    instance_size_slug: basic-xxs
    instance_count: 1
    envs:
      - key: GEMINI_API_KEY
        scope: BUILD_TIME
        type: SECRET
        value: "PASTE_YOUR_GEMINI_KEY_HERE"
      - key: GOOGLE_CLIENT_ID
        scope: BUILD_TIME
        type: SECRET
        value: "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE"
      - key: DATABASE_URL
        scope: RUN_TIME
        type: SECRET
        value: "PASTE_YOUR_DATABASE_URL_HERE"
      - key: GOOGLE_CLOUD_TTS_CREDENTIALS
        scope: RUN_TIME
        type: SECRET
        value: "PASTE_YOUR_BASE64_SERVICE_ACCOUNT_JSON_HERE"
      - key: NODE_ENV
        scope: RUN_TIME
        value: production
      - key: PORT
        scope: RUN_TIME
        value: "8080"
EOF
```

---

## Step 5 — Wait for the build to succeed

Watch build logs:

```bash
APP_ID=$(doctl apps list --format ID --no-header | head -1)
doctl apps logs $APP_ID --type build --follow
```

A successful build ends with something like:
```
[builder] Successfully built image sha256:...
[builder] Pushing image...
```

Then runtime logs:
```bash
doctl apps logs $APP_ID --type run --follow
```

Expected output:
```
Server running on :8080
```

Get the live URL:
```bash
doctl apps get $APP_ID --format DefaultIngress --no-header
```

It will look like `https://text-tutor-xxxxx.ondigitalocean.app`.

---

## Step 6 — Update Google OAuth authorized origins

The browser-side Google Sign-In button sends requests from the App Platform URL,
which must be whitelisted in Google Cloud Console.

1. Go to https://console.cloud.google.com/apis/credentials
2. Select your **OAuth 2.0 Client ID**
3. Under **Authorized JavaScript origins** add:
   ```
   https://text-tutor-xxxxx.ondigitalocean.app
   ```
4. Click **Save**

Without this step, Google Sign-In will silently fail with an `origin_mismatch` error.

---

## Step 7 — Verify end-to-end

| Check | Expected |
|-------|----------|
| `https://<your-app>.ondigitalocean.app` | React app loads |
| `https://<your-app>.ondigitalocean.app/api/state` | `{"error":"No session"}` (401) |
| Click **Sign in with Google** | OAuth popup completes, user info appears |
| Type text, explain a word | Gemini API responds, explanation shown |
| Reload page | State restored from PostgreSQL |

---

## Subsequent deploys

Every push to `main` triggers an automatic rebuild (configured via `deploy_on_push: true`).

To deploy manually without a git push:
```bash
APP_ID=$(doctl apps list --format ID --no-header | head -1)
doctl apps create-deployment $APP_ID
```

---

## Costs (approximate)

| Resource | Tier | Cost |
|----------|------|------|
| App — `basic-xxs` (1 vCPU, 512 MB RAM) | Basic | ~$5/mo |
| PostgreSQL | Your existing database | (varies) |
| **Total** | | **~$5/mo +** |

App Platform cost is for the container only. Database costs depend on your existing PostgreSQL setup.

---

## Teardown

```bash
APP_ID=$(doctl apps list --format ID --no-header | head -1)
doctl apps delete $APP_ID
```

> This deletes the App Platform app only. Your PostgreSQL database remains unaffected.
