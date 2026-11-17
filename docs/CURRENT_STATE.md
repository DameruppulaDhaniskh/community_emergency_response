# Current State Assessment (Pre-Milestone 3 Baseline)

Generated prior to Milestone 3 implementation from full inspection of the Django REST Framework backend and React + Vite + TypeScript frontend.

---

## 1. Architecture Overview

- **Backend:** Django 6.1.2 + Django REST Framework 3.18.3 + SimpleJWT 5.5.1 + `django-filter` + PostgreSQL (`psycopg` 3.3.6, SQLite fallback when `DB_NAME` is unset).
- **Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + TanStack React Query + React Router v7 + React Hook Form + Zod + Recharts + Lucide Icons ("SafeCircle" design system).
- **Test Baseline:** 45 backend `APITestCase` tests across `incidents/tests.py` (17 tests) and `notifications/tests.py` (28 tests) prior to Milestone 3 edits.

---

## 2. Backend Apps & Models

### 2.1 `users` (`backend/users/`)
- **Model `User(AbstractUser)`:**
  - `email` (unique, used as `USERNAME_FIELD`), `username`, `first_name`, `last_name`, `phone`, `address`, `profile_image_url`
  - `role` choices: `resident` (default), `guardian`, `volunteer`, `security`, `admin`
- **Permissions (`users/permissions.py`):** `IsAdminRole`, `IsSecurityPersonnel`, `IsVolunteer`, `IsGuardian`, `IsAdminOrSelf`, `IsAdminOrReadOnly`.

### 2.2 `society` (`backend/society/`)
- **Models:**
  - `Society`: `name`, `registration_number` (unique), `address`, `city`, `state`, `pincode`, `contact_email`, `contact_phone`, `admin` (FK to `User` role=`admin`), `is_active`, timestamps.
  - `Block`: `society` (FK), `name`, `total_floors`, `description`. Unique `(society, name)`.
  - `Flat`: `block` (FK), `flat_number`, `floor`, `area_sqft`, `is_occupied`. Unique `(block, flat_number)`.
  - `ResidentFlatMapping`: `user` (FK), `flat` (FK), `occupancy_type` (`owner`/`tenant`), `is_primary_resident`, `move_in_date`, `move_out_date`, `is_active`.
  - `SocietyAssignment`: `society` (FK), `user` (FK role `security`/`volunteer`), `is_available` (bool), `is_active` (bool).
  - `SocietyAlertPolicy`: `society` (OneToOne), `notify_community` (bool).

### 2.3 `contacts` (`backend/contacts/`)
- **Model `EmergencyContact`:**
  - `resident` (FK), `linked_user` (FK nullable), `contact_type` (`primary_guardian`, `secondary_guardian`, `emergency_contact`), `relationship`, `name`, `phone`, `email`, `address`, `priority`, `is_verified`, `verification_token`, `verification_sent_at`, `verified_at`, `is_active`.
  - Unique constraints: max one `primary_guardian` and one `secondary_guardian` per resident.

### 2.4 `incidents` (`backend/incidents/`)
- **Model `Incident` (M2 baseline):**
  - `resident` (FK), `emergency_type` (`medical`, `fall`, `fire`, `security`, `accident`, `other`), `description`, `latitude`, `longitude`, `location_captured_at`, `location_accuracy`, `status` (`OPEN`, `ACTIVE_RESPONSE`, `ESCALATED`, `RESOLVED`, `CANCELLED`), `created_at`, `updated_at`, `resolved_at`.
- **Access scoping (`incidents/access.py`):**
  - `superuser`: all incidents
  - `security`: incidents for residents in societies assigned via active `SocietyAssignment`
  - `admin`: incidents for societies where `society.admin == user`
  - `guardian`: incidents for residents where `EmergencyContact` has `linked_user == user, is_verified=True, is_active=True`
  - `volunteer`: in M2, open incidents in societies with active & available `SocietyAssignment` (changed in M3 to assigned incidents only)
  - `resident`: own incidents (`resident=user`)
  - Unauthorized record access returns `404`.

### 2.5 `notifications` (`backend/notifications/`)
- **Model `Notification`:**
  - `incident` (FK), `recipient` (FK nullable), `recipient_type` (`primary_guardian`, `security`, `volunteer`, `community`), `recipient_name`, `recipient_phone`, `recipient_email`, `channel` (`push`, `sms`, `email`, `in_app`), `title`, `message`.
  - Delivery tracking: `delivery_status` (`PENDING`, `SENT`, `DELIVERED`, `FAILED`), `provider_message_id`, `is_simulated`, `failure_reason`, `attempt_count`, `last_attempt_at`, `sent_at`, `delivered_at`.
  - Read tracking (decoupled): `is_read`, `read_at`.
  - `dedupe_key` with `UniqueConstraint(fields=['incident', 'dedupe_key'])`.
- **Services (`notifications/services.py`):**
  - M2 `notify_incident(incident)` notifies verified primary guardian (`push, sms, email, in_app`), society security (`push, in_app`), available society volunteers (`push, in_app`), and neighbours (`in_app`, privacy-filtered without resident name/location/message) if `SocietyAlertPolicy.notify_community=True`.
  - Simulated provider; failures never block SOS creation; `retry_failed` enforces max 3 attempts, 60s cooldown, atomic status claim.

---

## 3. Existing Backend Endpoints (M2)

| Group | Method & Path | Access | Notes |
|---|---|---|---|
| Auth | `POST /api/auth/register/` | AllowAny | Register with role |
| Auth | `POST /api/auth/login/` | AllowAny | Returns JWT `access` & `refresh` |
| Auth | `POST /api/auth/token/refresh/` | AllowAny | Rotates refresh token |
| Auth | `POST /api/auth/logout/` | Authenticated | Blacklists refresh token |
| Auth | `GET, PATCH /api/auth/profile/` | Authenticated | Own profile |
| Auth | `POST /api/auth/change-password/` | Authenticated | Change own password |
| Users | `GET /api/users/`, `GET/PATCH/DELETE /api/users/<id>/` | Admin / Self | Directory & management |
| Society | `/api/society/*` (societies, blocks, flats, mappings) | Auth read / Admin write | Complex hierarchy |
| Contacts | `/api/contacts/*`, `verify/`, `resend-verification/` | Resident / Admin | Guardian & emergency contacts |
| Incidents | `POST /api/incidents/sos/` | Resident | One-tap SOS (`201`) |
| Incidents | `GET /api/resident/incidents/` | Authenticated | Own incident list |
| Incidents | `GET /api/incidents/` | Authenticated | Role-filtered; filters `?status=&emergency_type=` |
| Incidents | `GET /api/incidents/<id>/` | Authorized (404 else) | Detail view |
| Incidents | `GET /api/incidents/<id>/status/` | Authorized (404 else) | Read-only status polling |
| Notifications | `GET /api/notifications/`, `GET /api/notifications/<id>/` | Recipient | Filters `is_read, channel, delivery_status` |
| Notifications | `PATCH /api/notifications/<id>/read/` | Recipient (`in_app` only) | Marks read |
| Notifications | `GET /api/incidents/<id>/notifications/` | Security, Admin, Resident | Delivery records (`403` for guardian/volunteer) |
| Notifications | `POST /api/incidents/<id>/notifications/retry/` | Security, Admin | Retries failed notifications |

---

## 4. Existing Frontend State (`frontend/src/`)

- **Routing (`App.tsx`, `routes/guards.tsx`, `routes/AppShell.tsx`):**
  - Public: `/login`, `/register`, `/unauthorized`
  - Role-guarded routes for `resident`, `guardian`, `volunteer`, `security`, `admin` + shared `/incidents/:id`, `/notifications`, `/profile`.
  - Sidebar (`260px`) + mobile bottom bar (`76px`) in `AppShell.tsx`.
- **API Layer (`src/api/`):**
  - `client.ts` (Axios + JWT interceptor + token auto-refresh)
  - Real API modules: `auth.ts`, `users.ts`, `society.ts`, `contacts.ts`, `incidents.ts`, `notifications.ts`
  - Existing M2 mock adapters (from `BACKEND_GAPS.md`):
    - `incidents.ts`: `updateIncidentStatus`, `getIncidentMessages`, `postIncidentMessage`, `getIncidentResponders`
    - `volunteers.ts`: `getAvailability`, `toggleAvailability`, `respondToIncident`
    - `guardianRequests.ts`: localStorage-backed guardian invitation adapter
    - `auth.ts`: `forgotPassword`, `resetPassword`
- **Design System (`src/index.css` & `src/components/`):**
  - SafeCircle theme: Inter font, background gradient `#FFF1EA -> #F5F5F7 -> #E9E9EE`, brand `#D9381E`, tint `#FFEDE5`, ink `#1A1A2E`, secondary `#5B5B6B`, card radius `20px`, padding `22px`, reusable `.card`, `.chip` (`ok`/`warn`/`bad`/`info`), `.cat`, `.fld`, `.lbl`, `.btn`, `.ghost` classes plus `Card`, `Chip`, `CategoryPill`, `Button`, `Input`, `Modal`, `EmptyState`, `Skeleton`, `StatCard`, `StatusBadge`, `Toast`, `OfflineBanner`.
- **Missing for Milestone 3 (to implement):**
  - Incident 6-status pipeline & migrations (`REPORTED`, `ACKNOWLEDGED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `is_escalated`)
  - Detailed Incident Reporting (`POST /api/incidents/` + evidence image upload/gallery + `IncidentHistory`)
  - Volunteer assignment, available volunteer lookup, status workflow transitions (`PATCH /api/incidents/<id>/status/`), volunteer assignments UI & availability endpoint
  - Event-driven notification routing (`admin`, `resident`, status updates, evidence, escalation), unread count & mark-all-read endpoints + UI bell/tabs
  - Admin Incident Management Dashboard & Detail/Assignment Modal
  - `drf-spectacular` OpenAPI/Swagger (`/api/docs/`, `/api/schema/`)
  - Deployment readiness config (`env` vars, `whitenoise`, `dj-database-url`, `Cloudinary`, `build.sh`, `render.yaml`, `vercel.json`, `/api/health/`, `seed_demo`)
  - PWA (`vite-plugin-pwa`, branded icons, `offline.html`, NetworkFirst API cache excluding auth, logout cache clearing, install prompt, Lighthouse audit)
  - Full automated tests (backend + frontend), Newman collection + run output, `demo_milestone3.py`, screenshots, and final docs.

