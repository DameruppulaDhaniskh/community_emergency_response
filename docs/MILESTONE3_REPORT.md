# Milestone 3 Completion Report — SafeCircle (Community Emergency Response Platform)

**Scope:** Local full-stack implementation, production-mode verification, PWA build, API documentation, Postman/Newman verification, and deployment readiness configuration.  
**Cloud Deployment Status:** **Local-only verification completed (`NOT DONE: for later` for Neon, Cloudinary, Render, and Vercel account creation and live hosting).**

---

## 1. Objective & Scope

Milestone 3 extends the existing Milestone 2 Django REST Framework + PostgreSQL backend and React + Vite + TypeScript frontend ("SafeCircle") into a complete, end-to-end incident lifecycle and Progressive Web App (PWA) without breaking existing Milestone 2 authentication, SOS alerting, or notification delivery behavior:

- Standardized **6-stage incident lifecycle** (`REPORTED` -> `ACKNOWLEDGED` -> `ASSIGNED` -> `IN_PROGRESS` -> `RESOLVED` -> `CLOSED`) plus orthogonal escalation (`is_escalated` + `escalated_at`).
- Full incident reporting form (`title`, `category`, `description`, GPS coordinates, and validated multi-image uploads via `IncidentEvidence`, max 5 images, <= 5 MB each, JPG/PNG/WEBP).
- Complete **audit history timeline** (`IncidentHistory`), assignment/reassignment tracking (`assigned_to`, `assigned_at`), and mandatory close reason for early closure (`close_reason`).
- Dedicated **Admin Incident Operations Center** (search, filter, ordering, optional pagination, volunteer availability modal, dispatch/assignment, close modal) and **Volunteer Assignment Workspace** (duty availability toggle, assigned-only queue, Start Work, Mark Resolved).
- Extended event-driven notification engine (`INCIDENT_REPORTED`, `INCIDENT_ASSIGNED`, `STATUS_CHANGED`, `EVIDENCE_ADDED`, `ESCALATED`), `unread-count`, and `read-all` endpoints wrapped in `transaction.atomic()` + `transaction.on_commit(...)`.
- Installable **PWA** (`vite-plugin-pwa`, Web App Manifest, Service Worker, `/offline.html` fallback, offline banner, mobile navigation, update prompt, install button, and Render cold-start wake-up indicator).
- Production deployment blueprints and documentation for Render (`Waitress`/`Gunicorn` + WhiteNoise), Neon PostgreSQL, Cloudinary media storage, and Vercel SPA hosting.

---

## 2. End-to-End Incident Workflow

1. **Incident Submission (`REPORTED`)**
   - Resident triggers **One-Tap SOS** (`POST /api/incidents/sos/`, auto-generates title and `created` history) or submits the **Report Incident Form** (`POST /api/incidents/`, multipart or JSON with optional GPS coordinates and up to 5 validated images).
   - Both `transaction.on_commit` callbacks record an `IncidentHistory` row and emit `INCIDENT_REPORTED` alerts to verified guardians, society security, available society volunteers, the society admin, and (if enabled by `SocietyAlertPolicy`) community neighbours.
2. **Triage & Acknowledgement (`ACKNOWLEDGED`)**
   - Security staff or the society admin acknowledge the incident (`PATCH /api/incidents/{id}/status/` -> `ACKNOWLEDGED`), stamping `acknowledged_at` and notifying the resident (`STATUS_CHANGED`).
3. **Volunteer Assignment & Reassignment (`ASSIGNED`)**
   - Society admin checks available volunteers (`GET /api/volunteers/available/?incident_id={id}` showing open assignment counts) and assigns or reassigns a volunteer (`POST /api/incidents/{id}/assign/`).
   - Creates `assigned` / `reassigned` history, stamps `assigned_at`, and fires `INCIDENT_ASSIGNED` notifications to both the newly assigned volunteer and the resident.
4. **Field Response (`IN_PROGRESS` -> `RESOLVED`)**
   - Assigned volunteer opens `/volunteer/incidents/{id}`, sees resident contact details, GPS link, evidence photos, and clicks **Start Work** (`IN_PROGRESS`, stamps `in_progress_at`) and later **Mark Resolved** (`RESOLVED`, stamps `resolved_at`).
   - Status changes trigger `STATUS_CHANGED` notifications to the resident, plus the resident's verified guardian when moving to `RESOLVED`.
5. **Closure (`CLOSED`) & Escalation**
   - Admin/security close resolved incidents, or perform an early close (`REPORTED`/`ACKNOWLEDGED`/`ASSIGNED`/`IN_PROGRESS` -> `CLOSED`) with a mandatory `close_reason`.
   - Closed incidents reject further status transitions, assignments, escalations, and evidence additions (`400 Bad Request`).
   - Residents, admins, and security can trigger `POST /api/incidents/{id}/escalate/` on non-closed incidents, setting `is_escalated=True` and alerting admins via `ESCALATED`.

---

## 3. Database Design & Migrations

| Model / Table | Milestone 3 Fields & Constraints | Source File |
| --- | --- | --- |
| `Incident` (`incidents_incident`) | `status` (`REPORTED`, `ACKNOWLEDGED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, default `REPORTED`), `title`, `category` (synced with `emergency_type`), `reported_by` FK, `assigned_to` FK, `assigned_at`, `acknowledged_at`, `in_progress_at`, `resolved_at`, `closed_at`, `close_reason`, `is_escalated`, `escalated_at` | `backend/incidents/models.py` |
| `IncidentEvidence` | `incident` FK (`related_name='evidence'`), `uploaded_by` FK, `image` (`ImageField`), `uploaded_at`; max 5 files per incident, <= 5 MB, verified JPG/PNG/WEBP via Pillow | `backend/incidents/models.py`, `backend/incidents/serializers.py` |
| `IncidentHistory` | `incident` FK (`related_name='history'`), `event_type` (`created`, `assigned`, `reassigned`, `status_changed`, `escalated`, `evidence_added`), `from_status`, `to_status`, `changed_by` FK, `note`, `created_at` | `backend/incidents/models.py` |
| `Notification` (`notifications_notification`) | Added `event_type` (`INCIDENT_REPORTED`, `INCIDENT_ASSIGNED`, `STATUS_CHANGED`, `EVIDENCE_ADDED`, `ESCALATED`), expanded `recipient_type` (`admin`, `resident`), unique event-scoped `dedupe_key` per `incident + recipient + channel` | `backend/notifications/models.py` |

### Migrations Executed Cleanly on Local PostgreSQL

- `incidents/0002_incident_acknowledged_at_incident_assigned_at_and_more.py`: Schema additions for new `Incident` fields, `IncidentEvidence`, and `IncidentHistory`.
- `incidents/0003_migrate_m2_statuses.py`: Zero-loss data migration (`OPEN -> REPORTED`, `ACTIVE_RESPONSE -> IN_PROGRESS`, `ESCALATED -> REPORTED + is_escalated=True`, `CANCELLED -> CLOSED` with `close_reason="cancelled"`). All 8 pre-existing Milestone 2 incidents migrated without loss.
- `notifications/0002_notification_event_type_and_more.py`: Notification `event_type` and expanded `recipient_type` choices.

---

## 4. API Endpoint Summary

| Endpoint | Methods | Allowed Roles | Description |
| --- | --- | --- | --- |
| `/api/health/` | `GET` | AllowAny | Liveness + PostgreSQL connectivity probe (`{"status":"ok","database":"connected"}`) |
| `/api/schema/`, `/api/docs/` | `GET` | AllowAny | OpenAPI 3.0 schema & interactive Swagger UI (`drf-spectacular`) |
| `/api/incidents/sos/` | `POST` | Resident | M2 one-tap SOS creation with auto-title and `created` history |
| `/api/incidents/` | `GET`, `POST` | Resident (`POST`), Scoped authenticated (`GET`) | List incidents with `?status=`, `?category=`, `?assigned_to=`, `?search=`, `?ordering=`, optional `?page=&page_size=`; create detailed report with multipart images |
| `/api/incidents/{id}/` | `GET` | Scoped (else `404`) | Incident detail with `reporter`, `assigned_to`, `evidence`, `evidence_urls`, `history`, `history_summary`, `location` |
| `/api/resident/incidents/` | `GET` | Resident | Reporter's own incidents |
| `/api/incidents/{id}/status/` | `GET`, `PATCH` | Scoped (`GET`), Admin/Security/Assigned Volunteer (`PATCH`) | Enforce strict role transition matrix and mandatory `close_reason` on early closure |
| `/api/incidents/{id}/assign/` | `POST` | Society Admin | Assign or reassign an active society volunteer |
| `/api/volunteers/available/` | `GET` | Society Admin | Active + available volunteers in target society with `open_assignments_count` |
| `/api/volunteer/incidents/` | `GET` | Volunteer | Incidents assigned directly to logged-in volunteer |
| `/api/volunteer/availability/` | `GET`, `PATCH` | Volunteer | View and toggle duty availability (`is_available`) across assignments |
| `/api/incidents/{id}/history/` | `GET` | Scoped (else `404`) | Ordered audit log of all lifecycle events |
| `/api/incidents/{id}/evidence/` | `GET`, `POST` | Scoped (`GET`), Reporter while non-CLOSED (`POST`) | Fetch or append validated evidence images |
| `/api/incidents/{id}/escalate/` | `POST` | Reporter / Admin / Security | Flag non-closed incident `is_escalated=True` and alert admins |
| `/api/notifications/` | `GET` | Authenticated | User's own notifications with `?type=alerts\|updates` |
| `/api/notifications/unread-count/` | `GET` | Authenticated | Unread in-app notification count |
| `/api/notifications/read-all/` | `POST` | Authenticated | Mark all unread in-app notifications read (`is_read=True`, `read_at`) |
| `/api/notifications/{id}/read/` | `PATCH` | Owner | Mark single in-app notification read (delivery status untouched) |
| `/api/incidents/{id}/notifications/` | `GET` | Admin / Security | Audit notification delivery statuses without exposing PII |
| `/api/incidents/{id}/notifications/retry/` | `POST` | Admin / Security | M2 row-locked retry for `FAILED` deliveries (max 3, 60s cooldown) |

---

## 5. Notification Routing Table

All notification dispatches run after DB commit via `transaction.on_commit(...)` and catch provider errors (`_safe_call`) so notification simulation failure never rolls back or blocks an incident save. Deduplication enforces uniqueness per incident, event scope, recipient, and channel.

| Event Type | Trigger | Recipients | Channels |
| --- | --- | --- | --- |
| `INCIDENT_REPORTED` | Resident creates SOS or form report | Verified guardians; active society security & available volunteers; society admin; community neighbours (if `notify_community=True`) | Push, SMS, Email, In-App (role-scoped per existing routing) |
| `INCIDENT_ASSIGNED` | Admin assigns / reassigns volunteer | Newly assigned volunteer + resident | Push, In-App, Email |
| `STATUS_CHANGED` | Transition to `ACKNOWLEDGED`, `IN_PROGRESS`, `RESOLVED`, or `CLOSED` | Resident; verified guardians on `RESOLVED`; assigned volunteer when closed | Push, In-App, Email (+ SMS to guardian on `RESOLVED`) |
| `EVIDENCE_ADDED` | Reporter uploads extra evidence | Society admin + assigned volunteer (if assigned) | Push, In-App, Email |
| `ESCALATED` | Resident / Admin / Security calls `/escalate/` | Society admin | Push, In-App, Email |

---

## 6. Role Access Matrix

Records outside the caller's access scope always return **`404 Not Found`** to avoid existence leakage; forbidden operations on visible resources or disallowed role actions return **`403 Forbidden`**.

| Role | Scope of Incident Access | Permitted Actions |
| --- | --- | --- |
| **Resident** | Own reported incidents only | Create SOS & detailed form reports, upload evidence while non-closed, escalate own incident, read own notifications |
| **Guardian** | Verified dependent residents' incidents only | View dependent incident status/details, receive SOS & `RESOLVED` updates (`403` on create, assign, status update, or delivery records) |
| **Volunteer** | Only incidents where `assigned_to == user` | View `/volunteer/incidents/`, toggle `is_available`, start work (`ASSIGNED -> IN_PROGRESS`), mark resolved (`IN_PROGRESS -> RESOLVED`) |
| **Security** | Incidents in their assigned society | View all society incidents, acknowledge (`REPORTED -> ACKNOWLEDGED`), close, escalate, view delivery records, retry failed notifications |
| **Admin** | Incidents in societies they administer | All Security capabilities + view `/api/volunteers/available/`, assign & reassign volunteers, inspect analytics & full audit history |

---

## 7. Frontend Modules & PWA Architecture

Built strictly with SafeCircle design tokens (`#D9381E` primary, `#FFEDE5` tint, `#1A1A2E` ink, `#5B5B6B` secondary, `20px` card radius, `260px` sidebar, `ok/warn/bad/info` chips):

- **API Layer (`frontend/src/api/`)**: `client.ts` (env-driven `VITE_API_BASE_URL`, cold-start wake-up subscription + automatic GET retry), `incidents.ts`, `notifications.ts`, `volunteers.ts`, `types.ts`.
- **Pages (`frontend/src/features/`)**:
  - `incidents/ReportIncidentPage.tsx` (category pills, GPS capture, drag/drop 5-photo validation, upload progress)
  - `incidents/ResidentIncidentListPage.tsx` & `incidents/IncidentDetailPage.tsx` (6-step lifecycle stepper, audit timeline, evidence lightbox & add-photo, escalate, delivery panel for admin/security)
  - `admin/AdminIncidentDashboard.tsx` & `admin/AdminIncidentDetail.tsx` (status counts, debounced search, filters, sorting, pagination, available-volunteer modal, close-reason modal)
  - `volunteers/VolunteerAssignmentList.tsx` & `volunteers/VolunteerAssignmentDetail.tsx` (live duty toggle, status tabs, Start Work / Mark Resolved + direct call)
  - `notifications/NotificationsPage.tsx` (`All / Unread / Alerts / Updates` filter chips, `Mark all as read` action)
- **PWA & Security (`frontend/vite.config.ts`, `frontend/public/`, `frontend/src/lib/pwaCache.ts`)**:
  - Workbox Service Worker (`dist/sw.js`) precaching 18 entries (`1125.01 KiB`), `/manifest.webmanifest` (`192x192`, `512x512`, `maskable` icons), `/offline.html` with `tel:112` button, `OfflineBanner.tsx`, `WakeUpBanner.tsx`, `InstallPromptButton.tsx`, `PwaUpdatePrompt.tsx`, and optional Web Push scaffold (`public/push-sw.js` behind `VITE_ENABLE_WEB_PUSH`).
  - `/api/auth/` uses Workbox `NetworkOnly`; `AuthContext` invokes `clearSensitiveClientState()` on both login and logout to purge cached query/session data across users.

---

## 8. Deployment Readiness Architecture (Prepared for Later Cloud Hosting)

| Layer | Planned Target | Config Files Prepared | Placeholder URL |
| --- | --- | --- | --- |
| Database | Neon PostgreSQL | `backend/config/settings.py` (`dj_database_url` with `ssl_require` on `sslmode=require` or `not DEBUG` unless `sslmode=disable`) | `<to be added after deployment>` |
| Media Storage | Cloudinary | `backend/config/settings.py` (`USE_CLOUDINARY = bool(CLOUDINARY_URL)`) | `<to be added after deployment>` |
| Backend Web Service | Render Python 3.13.3 | `render.yaml`, `backend/build.sh`, `backend/Procfile`, `backend/requirements.txt`, `backend/.env.example`, `backend/runtime.txt` | `<to be added after deployment>` |
| Frontend Hosting | Vercel Vite SPA | `frontend/vercel.json` (SPA rewrite), `frontend/.env.example`, `frontend/vite.config.ts` | `<to be added after deployment>` |

Step-by-step cloud setup instructions live in [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## 9. Verification Results & Observed Test Counts

All commands below were executed locally against **PostgreSQL**, **Waitress WSGI (`DEBUG=False`)**, and **Vite production preview**:

| Check | Outcome | Observed Counts / Details | Evidence |
| --- | --- | --- | --- |
| Django Test Suite (`manage.py test --noinput`) | **PASSED (55/55)** | `incidents/tests.py`: 17, `notifications/tests.py`: 27, `incidents/test_m3.py`: 9, `notifications/test_m3.py`: 2 (`231.448s`, 0 failures, 0 skipped) | Local PostgreSQL test run |
| Django Deploy Check (`manage.py check --deploy`) | **PASSED (exit 0)** | 0 Django `security.W*` warnings when `DJANGO_SECURE_SSL_REDIRECT=True`; 14 legacy `drf_spectacular` type-hint/enum warnings on unmodified M2 views/serializers | Console output (`check --deploy`) |
| End-to-End Demo Script (`backend/demo_milestone3.py`) | **PASSED (7/7 flows)** | Form upload + notifications + RBAC 403/404 matrix + volunteer assign + Start Work + Resolve + Close + Timeline audit | [`docs/evidence/demo-output.txt`](./evidence/demo-output.txt) |
| Newman API Collection (`m3-collection.json`) | **PASSED (77/77)** | `46` HTTP requests executed, `46` test scripts, `77` assertions passed, `0` failures (`27.8s`) | [`docs/evidence/newman-run.txt`](./evidence/newman-run.txt) |
| Frontend Build, Lint & Vitest (`build`, `lint`, `test`) | **PASSED** | `tsc -b && vite build` clean (`18` SW precache entries); `oxlint` `0` errors (`19` warnings); Vitest `4/4` tests passed in `src/test/m3.test.tsx` | Terminal output |
| Local Production E2E Walkthrough (`run-prod-verify.ps1`) | **PASSED** | Waitress (`DEBUG=False`) + `vite preview` + headless Edge Playwright/Puppeteer verified PWA (`swState: activated`), report creation (#17), offline banner, outsider 404 isolation, admin triage/assign modal, volunteer lifecycle, admin close, mark-all-read; 0 console/5xx errors; 13 screenshots captured at `1280px` & `390px` | [`docs/evidence/screens/`](./evidence/screens/) |
| Lighthouse v12.8.2 Audit (`http://127.0.0.1:4173/login`) | **PASSED** | Performance `81`, Accessibility `100`, Best Practices `100`, SEO `100`; TBT `50 ms`, CLS `0` | [`docs/evidence/lighthouse.md`](./evidence/lighthouse.md) |

---

## 10. Milestone 2 Adjustments Made for Milestone 3 Rules

1. **Status Rename (`incidents/tests.py` lines 29, 159-167, 174 & `notifications/tests.py` line 332):** Updated status assertions from Milestone 2 `'OPEN'` to the official Milestone 3 initial status `'REPORTED'` while preserving all Milestone 2 behaviors.
2. **Volunteer Scoping (`backend/incidents/access.py` + `incidents/tests.py` lines 159-167):** Milestone 3 privacy mandates that volunteers only see incidents directly assigned to them (`assigned_to == user`) rather than all unassigned incidents in their society. Updated `test_volunteer_sees_only_assigned_incidents` accordingly.
3. **`transaction.on_commit` Test Hook (`notifications/tests.py`):** Wrapped `raise_sos()` assertions in `captureOnCommitCallbacks(execute=True)` (outside mock patches) because notification dispatch now executes post-commit so notification failures never roll back or block incident persistence.

---

## 11. Requirements Checklist

| Requirement | Status | Mapped File / Endpoint / Verification |
| --- | --- | --- |
| Official 6 statuses + data migration | Done | `backend/incidents/models.py`, `0003_migrate_m2_statuses.py` |
| Detailed Incident Report Form + Evidence Validation | Done | `POST /api/incidents/`, `POST /api/incidents/{id}/evidence/`, `ReportIncidentPage.tsx`, `test_m3.py` |
| Full History Timeline (`created`, `assigned`, `reassigned`, `status_changed`, `escalated`, `evidence_added`) | Done | `IncidentHistory`, `GET /api/incidents/{id}/history/`, `IncidentDetailPage.tsx` |
| Admin Filter/Search/Sort/Pagination + Assign Modal | Done | `GET /api/incidents/`, `GET /api/volunteers/available/`, `POST /api/incidents/{id}/assign/`, `AdminIncidentDashboard.tsx` |
| Volunteer Duty Toggle & Assigned Workflow | Done | `GET/PATCH /api/volunteer/availability/`, `GET /api/volunteer/incidents/`, `VolunteerAssignmentDetail.tsx` |
| Role-Enforced Transitions & Early Close Reason | Done | `PATCH /api/incidents/{id}/status/`, `test_full_assignment_reassignment_and_status_lifecycle`, Newman |
| Notification Routing + Unread Count + Mark All Read | Done | `backend/notifications/services.py`, `/api/notifications/unread-count/`, `/api/notifications/read-all/`, `NotificationsPage.tsx` |
| SafeCircle Design Tokens & Responsive Layouts (`1280px` / `390px`) | Done | `frontend/src/index.css`, `docs/evidence/screens/*.png` |
| PWA Manifest, Service Worker, Offline Page & Banner | Done | `frontend/vite.config.ts`, `public/offline.html`, `OfflineBanner.tsx`, `lighthouse.md` |
| Deployment Readiness Config & Docs (Local-Only) | Done | `render.yaml`, `backend/build.sh`, `backend/Procfile`, `frontend/vercel.json`, `docs/DEPLOYMENT.md` |
| Live Cloud Hosting (Neon/Render/Vercel/Cloudinary) | **NOT DONE: for later** | Intentionally deferred per local-only scope |

---

## 12. Manual Steps for Later (When Ready to Deploy)

1. Provision a **Neon PostgreSQL** project and copy the `?sslmode=require` connection string.
2. Create a **Cloudinary** account and copy `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>`.
3. Deploy the `backend/` folder on **Render** (`render.yaml` / `build.sh` / `gunicorn config.wsgi:application`), set `SECRET_KEY`, `DATABASE_URL`, `CLOUDINARY_URL`, `DJANGO_DEBUG=False`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, and `DJANGO_SECURE_SSL_REDIRECT=True`.
4. Deploy `frontend/` on **Vercel** (`vercel.json` handles SPA routing) and set `VITE_API_BASE_URL=https://<your-render-service>.onrender.com/api`.
5. Update Render's `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` with the live Vercel URL, then run `seed_demo` or create production users and smoke-test `/api/health/` and `/login`.

---

## 13. SOS Location, Guardian Response & Proximity Escalation Extension

### 13.1 Architecture & Workflow Overview

Milestone 3 was extended with complete real-time SOS geolocation tracking, guardian acknowledgment/handoff workflows, server-side auto-escalation, block-first volunteer matching, and admin volunteer verification.

1. **High-Accuracy SOS Geolocation Capture:**
   - Resident triggers SOS (`SOSFlow.tsx`); coordinates are captured using `navigator.geolocation.watchPosition` (up to 5 seconds, smallest accuracy radius).
   - Coordinates (`latitude`, `longitude`, `location_accuracy`, `location_captured_at`) are saved on `incidents_incident`.
   - Verified primary guardian immediately receives the alert containing GPS coordinates, interactive Leaflet map (`LocationMap.tsx`), accuracy radius circle, and direct Google Maps link.

2. **Guardian Response & Handoff:**
   - **"I'm responding" (`POST /api/incidents/<id>/guardian-ack/`)**: Guardian acknowledges the alert; stops server auto-escalation timer, transitions status to `ACKNOWLEDGED`, stamps `guardian_acknowledged_at`.
   - **"I can't help, pass it on" (`POST /api/incidents/<id>/handoff/`)**: Guardian passes the emergency to pre-configured targets (`secondary_guardian`, `security`, `volunteers`) with category-sensitive defaults (e.g. fire/security pre-selects security guard). Escalates immediately and stops further countdown.

3. **Server-Side Auto-Escalation Engine:**
   - When SOS is created, backend schedules `escalate_at = now() + response_window_seconds` (default 120s, configurable between 60s and 300s).
   - If no guardian responds before `escalate_at`, server auto-escalation triggers directly and simultaneously to all enabled targets (secondary guardian, security, nearby volunteers).
   - If resident has no verified guardian, the guardian stage is skipped and escalation triggers immediately.

4. **Block-First Volunteer Matching Hierarchy:**
   - **Tier 1 (Same Block):** Volunteers residing in the exact same apartment block as the resident.
   - **Tier 2 (Same Society, Different Block):** Active volunteers within the same gated community.
   - **Tier 3 (Neighbouring Societies):** Volunteers from adjacent societies within configurable search radius (0.5 to 5.0 km), allowed only if `SocietyAlertPolicy.allow_cross_society_dispatch = True` and volunteer has opted into `opt_in_neighbour_dispatch`.
   - **Live GPS with Base Pin Fallback:** Uses `VolunteerLocation` coordinates if recorded within the last 15 minutes; automatically falls back to approved `VolunteerProfile` base pin (`latitude`, `longitude`) if stale.

5. **Atomic Volunteer Claiming (`POST /api/incidents/<id>/accept/`):**
   - Protected by `select_for_update()` database row-level locking.
   - First volunteer to click "Accept Emergency" claims the assignment (`assigned_to = volunteer`, status `ASSIGNED`, HTTP 200).
   - Subsequent volunteers receive an atomic HTTP 409 Conflict (`{"detail": "Another volunteer has already accepted this incident."}`).

6. **Cross-Society Volunteer Privacy Redaction:**
   - Before acceptance, incident details shown to cross-society volunteers are strictly redacted (`description`, `flat_number`, `phone` nullified; `is_cross_society_preview = True`).
   - Upon successful acceptance, full details unlock automatically.

7. **Admin Volunteer Verification & Far-Pin Warnings:**
   - Society admins manage volunteer applications at `/admin/volunteers` (`GET /api/admin/volunteers/`).
   - Displays base pin coordinates with a **Far Pin Warning Badge** if base pin is > 3.0 km from the society center.
   - Requires mandatory rejection reason when declining applications (`POST /api/admin/volunteers/<id>/reject/`).
   - Configures society cross-dispatch policy (`GET/PUT /api/society/policy/`).

---

### 13.2 Automated Test & Verification Matrix

| Verification Suite | Result | Details |
| --- | --- | --- |
| **Django Test Suite (`python manage.py test`)** | **PASSED (73/73 tests)** | All 73 unit and integration tests passing in 307.055s without errors or regressions |
| **Proximity Matching Demo (`demo_matching.py`)** | **PASSED (exit 0)** | Verified 5 volunteers matched across Tier 1 (4 in block), Tier 2 (3 in society), and Tier 3 (3 neighbours) by proximity |
| **Escalation Demo (`demo_escalation.py`)** | **PASSED (exit 0)** | Verified SOS creation, GPS coordinates, guardian ack, guardian handoff, atomic 409 conflict, and no-responder fallback |
| **Frontend Production Build (`npm run build`)** | **PASSED (exit 0)** | Clean TypeScript compile (`tsc -b`), 2,874 modules transformed, PWA service worker generated |
| **Frontend Linter (`npm run lint`)** | **PASSED (exit 0)** | 0 errors across 77 files |
| **End-to-End Browser Flow (`verify-escalation-e2e.mjs`)** | **PASSED (exit 0)** | Real Edge/Puppeteer execution across 4 distinct user roles with all 8 screenshots captured |

---

### 13.3 End-to-End Verification Screenshots

| # | Screen Description | Artifact File |
| --- | --- | --- |
| 1 | Resident Escalation Settings & Live Target Preview | [`01-resident-escalation-settings.png`](./evidence/screens/01-resident-escalation-settings.png) |
| 2 | Resident Active SOS Screen with Leaflet GPS Map & Countdown | [`02-resident-sos-active.png`](./evidence/screens/02-resident-sos-active.png) |
| 3 | Primary Guardian Active SOS Alert with GPS Coordinates & Action Buttons | [`03-guardian-active-alert.png`](./evidence/screens/03-guardian-active-alert.png) |
| 4 | Guardian "I Can't Help, Pass It On" Modal with Target Checkboxes | [`04-guardian-handoff-modal.png`](./evidence/screens/04-guardian-handoff-modal.png) |
| 5 | Guardian Handoff Completed State | [`05-guardian-handoff-completed.png`](./evidence/screens/05-guardian-handoff-completed.png) |
| 6 | Volunteer Incoming Emergency Alert Card with Redacted Preview | [`06-volunteer-incoming-alert.png`](./evidence/screens/06-volunteer-incoming-alert.png) |
| 7 | Volunteer Accepted Incident Workspace with Unlocked Details | [`07-volunteer-accepted.png`](./evidence/screens/07-volunteer-accepted.png) |
| 8 | Admin Volunteer Verification Workspace with Far-Pin Warning & Cross-Society Policy | [`08-admin-volunteer-approvals.png`](./evidence/screens/08-admin-volunteer-approvals.png) |

