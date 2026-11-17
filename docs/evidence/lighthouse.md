# Lighthouse & PWA Verification Summary

- **Target URL:** `http://127.0.0.1:4173/login` (local Vite production preview of `frontend/dist`)
- **Tooling:** Lighthouse `12.8.2` with headless Microsoft Edge (`--headless=new --no-sandbox --disable-gpu`)
- **Run Timestamp:** `2026-11-11T11:38:45.974Z`
- **Raw Report:** [`docs/evidence/lighthouse.json`](./lighthouse.json)

## Category Scores

| Category | Score | Notes |
| --- | ---: | --- |
| Performance | **81** | TBT `50 ms` (score 1.0), CLS `0` (score 1.0), FCP `3.2 s`, LCP `3.2 s`, TTI `4.0 s` |
| Accessibility | **100** | Contrast, viewport, document title, and HTML lang all passing |
| Best Practices | **100** | Zero browser console errors |
| SEO | **100** | Valid `robots.txt` and meta description |

> Note: Lighthouse v12 removed the standalone `PWA` numeric category, so manifest, service worker activation, precaching, icons, and offline fallback were verified directly against the built production preview.

## PWA Verification Results (Production Build)

| Check | Status | Details |
| --- | --- | --- |
| Web App Manifest | Verified | `/manifest.webmanifest` returned `200 OK` (`559 bytes`), `display: standalone`, `start_url: /`, `theme_color: #D9381E`, `background_color: #FFF1EA` |
| Icons (`192`, `512`, `maskable`) | Verified | `/icons/icon-192.png` (`1552 B`), `/icons/icon-512.png` (`4726 B`), `/icons/icon-maskable-512.png` (`3635 B`) all served `200 OK` |
| Service Worker Registration | Verified | `/sw.js` returned `200 OK` (`2656 B`), precached `18` entries (`1125.01 KiB`), and `navigator.serviceWorker.ready` reached `activated` on scope `http://127.0.0.1:4173/` |
| Offline Fallback Page & Banner | Verified | `/offline.html` returned `200 OK` (`2283 B`) with `tel:112` emergency fallback; offline banner verified in Edge at `1280px` and `390px` (`offline-banner-1280.png`, `offline-banner-390.png`) |
| Role-Safe Auth & Caching | Verified | `/api/auth/` configured with `NetworkOnly` in Workbox; logout & login clear TanStack Query cache via `clearSensitiveClientState` |

