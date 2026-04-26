# PreviewPanel — Backend

AI-powered pre-publish video feedback. Upload a video, get feedback from three synthetic judges powered by [TwelveLabs Pegasus](https://twelvelabs.io).

**Stack:** Node.js + Express (backend) · React + Vite (frontend)  
**Deploy targets:** Railway (backend) · Vercel (frontend)

---

## Running Locally

### 1. Backend

```bash
cd previewpanel-backend
cp .env.example .env
# Edit .env and add your real API keys
npm install
npm run dev        # runs with --watch for auto-restart
```

### 2. Frontend

```bash
cd previewpanel-frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` requests to `localhost:3001` automatically — no `VITE_API_URL` needed locally.

---

## Deploying the Backend to Railway

### Prerequisites
- A [Railway](https://railway.app) account (free tier works)
- Your `TWELVELABS_API_KEY` from [app.twelvelabs.io](https://app.twelvelabs.io)
- (Optional) An `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com)

### Steps

**1. Push the backend to GitHub**

```bash
cd previewpanel-backend
git init
git add .
git commit -m "Initial commit"
# Create a new repo at github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/previewpanel-backend.git
git push -u origin main
```

**2. Create a Railway project**

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your `previewpanel-backend` repository
4. Railway detects Node.js automatically and uses `npm start`

**3. Set environment variables**

In your Railway project → **Variables** tab, add:

| Variable | Value |
|---|---|
| `TWELVELABS_API_KEY` | your TwelveLabs API key |
| `ANTHROPIC_API_KEY` | your Anthropic key (optional) |

Do **not** add `PORT` — Railway sets it automatically.

**4. Verify ffmpeg is available**

The `nixpacks.toml` file in this repo tells Railway to install ffmpeg during build. No extra steps needed.

**5. Note your Railway URL**

After deployment, Railway gives you a URL like:  
`https://previewpanel-backend-production.up.railway.app`

Save this — you need it for the frontend deployment.

---

## Deploying the Frontend to Vercel

### Prerequisites
- A [Vercel](https://vercel.com) account
- The Railway backend URL from above

### Steps

**1. Push the frontend to GitHub**

```bash
cd previewpanel-frontend
git init
git add .
git commit -m "Initial commit"
# Create a new repo at github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/previewpanel-frontend.git
git push -u origin main
```

**2. Import to Vercel**

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. **Import** your `previewpanel-frontend` repository
3. Vercel auto-detects Vite. Confirm these settings:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

**3. Set the backend URL**

In the Vercel project → **Settings** → **Environment Variables**, add:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://your-backend.up.railway.app` (no trailing slash) |

**4. Deploy**

Click **Deploy**. On every future push to `main`, Vercel rebuilds automatically.

---

## Environment Variables Reference

### Backend (`.env`)

| Variable | Required | Description |
|---|---|---|
| `TWELVELABS_API_KEY` | ✓ | TwelveLabs API key |
| `ANTHROPIC_API_KEY` | optional | Enables Claude fallback for malformed JSON responses |
| `PORT` | auto | Set by Railway automatically; defaults to `3001` locally |

### Frontend (`.env.local`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | production only | Full Railway backend URL, e.g. `https://your-app.up.railway.app` |

Leave `VITE_API_URL` unset locally — the Vite dev proxy routes `/api` to `localhost:3001`.

---

## Notes

- **Uploads are ephemeral on Railway.** Files uploaded by users are converted, sent to TwelveLabs, then deleted immediately. No persistent storage is needed.
- **CORS** is currently open (`*`). If you want to restrict it to your Vercel domain, update the `cors()` call in `server.js`:
  ```js
  app.use(cors({ origin: "https://your-app.vercel.app" }));
  ```
- **TwelveLabs rate limits.** The app runs judges sequentially (not in parallel) to avoid concurrent request errors. If you hit rate limits, increase the retry delay in `server.js`.
