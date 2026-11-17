# Deployment Guide & Future Checklist (Local-Ready Build)

> **Status:** All deployment configurations (`render.yaml`, `build.sh`, `vercel.json`, `settings.py`, `.env.example`) are implemented and verified locally. Cloud deployment itself is intentionally **NOT DONE: for later** — follow these steps in exact order when ready to publish.

---

## 1. Free-Tier Platform Limits to Know

- **Neon (PostgreSQL):** Free tier provides 0.5 GB storage and persistent PostgreSQL databases (unlike Render's free PostgreSQL which expires after 30–90 days). Cold compute scale-to-zero wakes within ~1–2 seconds.
- **Render (Backend Web Service):** Free instance sleeps after **15 minutes of inactivity**. The first request after sleep can take **30–60 seconds** (the frontend handles this automatically with a *"Waking up the server, this can take up to a minute"* retry banner). Ephemeral local disk on Render is **wiped on every restart/deploy**, which is why Cloudinary must be enabled via `CLOUDINARY_URL` in production.
- **Vercel (Frontend Static / SPA Hosting):** Generous free bandwidth/builds for Vite SPAs; requires `frontend/vercel.json` SPA rewrites so direct deep links like `/incidents/12` do not 404.
- **Cloudinary (Media / Evidence Storage):** Free tier grants 25 monthly credits (~25 GB storage/bandwidth), keeping resident evidence images persistent across Render restarts.

---

## 2. Step-by-Step Deployment Order

### Step A — Create PostgreSQL Database on Neon (`NOT DONE: for later`)
1. Sign up / log in at https://neon.tech and create a new project (`safecircle-prod`).
2. Select PostgreSQL 16+ in a region close to your Render service (e.g., Singapore or US East).
3. Copy the pooled or direct **Connection String** (`postgresql://user:password@ep-....aws.neon.tech/neondb?sslmode=require`).
4. Verify `?sslmode=require` is present at the end of the URL.

### Step B — Configure Cloudinary Media Storage (`NOT DONE: for later`)
1. Sign up / log in at https://cloudinary.com.
2. From the Programmable Media **Dashboard**, copy your **API Environment variable**:
   `cloudinary://<API_KEY>:<API_SECRET>@<CLOUD_NAME>`
3. Keep this secret; do not commit it to Git.

### Step C — Push Clean Code to GitHub (`NOT DONE: for later`)
1. Verify `backend/.env` and `frontend/.env` are NOT tracked (`git status`).
2. Push your branch (`Dameruppula-Dhaniskh` or target deployment branch) to GitHub.

### Step D — Deploy Backend on Render (`NOT DONE: for later`)
1. Go to https://dashboard.render.com -> **New +** -> **Web Service** (or **Blueprint** using root `render.yaml`).
2. Connect your GitHub repository and branch.
3. Configure service settings:
   - **Root Directory:** `backend`
   - **Runtime:** Python 3 (`3.13.3` via `.python-version` / `runtime.txt`)
   - **Build Command:** `./build.sh` (runs `pip install -r requirements.txt`, `collectstatic --no-input`, `migrate`)
   - **Start Command:** `gunicorn config.wsgi:application`
   - **Health Check Path:** `/api/health/`
   - **Instance Type:** Free
4. Set **Environment Variables** in Render Dashboard -> **Environment**:
   - `DJANGO_DEBUG` = `False`
   - `SECRET_KEY` = *(click Generate, or supply a 50+ char random string)*
   - `DATABASE_URL` = *(paste Neon PostgreSQL URL with `?sslmode=require`)*
   - `CLOUDINARY_URL` = *(paste `cloudinary://...` URL)*
   - `ALLOWED_HOSTS` = `<your-service>.onrender.com`
   - `CORS_ALLOW_ALL_ORIGINS` = `False`
   - `CORS_ALLOWED_ORIGINS` = `http://localhost:5173` *(update in Step F after Vercel URL is live)*
   - `CSRF_TRUSTED_ORIGINS` = `https://<your-service>.onrender.com` *(update in Step F)*
   - `DJANGO_SECURE_SSL_REDIRECT` = `True`
   - `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` = `60`
   - `JWT_REFRESH_TOKEN_LIFETIME_DAYS` = `7`
5. Trigger initial deploy. Confirm `/api/health/` returns `{"status": "ok", "database": "connected"}` (`200 OK`).
6. Open Render **Shell** (or run locally once against Neon `DATABASE_URL`) to run the idempotent demo seed if demo accounts are desired:
   ```bash
   python manage.py seed_demo
   ```

### Step E — Deploy Frontend on Vercel (`NOT DONE: for later`)
1. Go to https://vercel.com/new and import the GitHub repository.
2. Configure Project Settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Set **Environment Variable** in Vercel:
   - `VITE_API_BASE_URL` = `https://<your-render-service>.onrender.com/api` *(exact URL without trailing slash)*
4. Deploy. Note the assigned production URL (e.g., `https://safecircle-ceran.vercel.app`).

### Step F — Update Backend CORS & CSRF Origins (`NOT DONE: for later`)
1. Return to Render Dashboard -> Web Service -> **Environment**.
2. Update:
   - `CORS_ALLOWED_ORIGINS` = `https://safecircle-ceran.vercel.app`
   - `CSRF_TRUSTED_ORIGINS` = `https://safecircle-ceran.vercel.app,https://<your-render-service>.onrender.com`
3. Save changes (Render will redeploy quickly with updated env vars).

---

## 3. Post-Deploy Verification Checklist (`NOT DONE: for later`)

- [ ] Frontend loads cleanly at Vercel URL (`200 OK`) and SPA routes (`/resident/home`, `/incidents/1`) work on direct browser refresh (`vercel.json` rewrites).
- [ ] `GET https://<render-backend>/api/health/` returns `200 OK` with `database: connected`.
- [ ] Swagger UI loads at `https://<render-backend>/api/docs/`.
- [ ] Login works for all 5 roles (`resident`, `guardian`, `volunteer`, `security`, `admin`) without CORS errors in browser DevTools.
- [ ] Resident can report an incident with an uploaded image -> image URL resolves from Cloudinary and persists across service restarts.
- [ ] Admin can view incidents, filter/paginate, acknowledge, and assign an available volunteer.
- [ ] Volunteer can start work (`IN_PROGRESS`), resolve (`RESOLVED`), and toggle availability.
- [ ] Notifications badge updates, `Read` / `Mark all read` persist, and unauthorized role access returns `403`/`404`.
- [ ] PWA prompt triggers installability check over HTTPS and service worker serves `offline.html` when offline.
- [ ] Render and Vercel logs show zero unhandled 500 exceptions.

