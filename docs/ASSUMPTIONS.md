# Milestone 3 Engineering Assumptions & Design Decisions

This document records assumptions made while implementing Milestone 3 on top of the existing Milestone 2 CERAN / SafeCircle codebase.

## 1. Backward Compatibility with Milestone 2
- **`emergency_type` & `category` duality:** Milestone 2 uses `Incident.emergency_type` (with choices `medical, fall, fire, security, accident, other`) across `POST /api/incidents/sos/`, serializers, filters, and existing tests. Milestone 3 introduces `category`. To avoid breaking any M2 contract while supporting M3 cleanly:
  - Both `emergency_type` and `category` exist as fields on `Incident` (same value set, defaulting to `'other'`) and stay automatically synchronized in `Incident.save()` and serializers.
  - `POST /api/incidents/` accepts `category` (or `emergency_type` fallback), `GET /api/incidents/?category=` filters on both/synced values, and API responses return both `category` and `emergency_type`.
- **`reported_by` field:** `Incident.reported_by` FK is nullable at schema level with a data migration populating `reported_by = resident` for existing rows and auto-set to `resident` in `save()`/`create()` so existing M2 `Incident.objects.create(...)` calls continue working cleanly.
- **Status rename migration (`OPEN` -> `REPORTED`, etc.):**
  - Six official statuses: `REPORTED`, `ACKNOWLEDGED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`.
  - Data migration `0002` maps: `OPEN -> REPORTED`, `ACTIVE_RESPONSE -> IN_PROGRESS`, `RESOLVED -> RESOLVED`, `CANCELLED -> CLOSED` (`close_reason="cancelled"`), `ESCALATED -> REPORTED` with `is_escalated=True` and `escalated_at` preserved.
  - M2 tests that asserted `status == 'OPEN'` (`incidents/tests.py` lines 29 & 174, `notifications/tests.py` line 332) are updated to `'REPORTED'` per instructions, and each edit is logged in `docs/MILESTONE3_REPORT.md`.

## 2. Role Access Update on `GET /api/incidents/`
- Per Milestone 3 Phase 1 requirements, **volunteers only see incidents assigned to them** (`assigned_to=user`), tightening Milestone 2 behaviour where available volunteers saw all unassigned open society incidents.
- Volunteers still receive notifications when an SOS is raised in their society while available (per M2 notification routing), and admins use `GET /api/volunteers/available/?incident_id=` to assign an available society volunteer.
- The single M2 test asserting unassigned volunteer list visibility (`test_volunteer_sees_only_when_available`) is updated to reflect the Milestone 3 privacy/assignment rule and documented in `docs/MILESTONE3_REPORT.md`.

## 3. Pagination Compatibility
- `GET /api/incidents/` supports DRF `PageNumberPagination` (`page` and `page_size` query parameters) when `?page=` or `?page_size=` is provided, returning `{ count, next, previous, results }`.
- When neither `?page=` nor `?page_size=` is provided, `GET /api/incidents/` returns the plain list `[...]` so all existing Milestone 2 tests and frontend summary hooks remain compatible without breaking array expectations.

## 4. Incident Creation vs Evidence Endpoint Rules
- `POST /api/incidents/` (multipart/form-data or JSON) creates an incident for authenticated `resident` users only, requiring `title`, `description`, `category` (optional location fields, optional `images` up to 5 files validated for `.jpg/.jpeg/.png/.webp` and <= 5 MB).
- `POST /api/incidents/sos/` continues to work as in M2 with `status='REPORTED'`, automatic title `"SOS: <Category>"`, and synchronous/on-commit dispatch.
- `POST /api/incidents/<id>/evidence/` is restricted exclusively to the incident reporter (`incident.reported_by == request.user` or `incident.resident == request.user`) and rejects uploads with HTTP 400 when `incident.status == 'CLOSED'` or max 5 images reached. `GET /api/incidents/<id>/evidence/` allows any authorized viewer of the incident (`incidents_for_user`) to retrieve uploaded evidence URLs.

## 5. Status Workflow & Assignment Rules
- Allowed transitions (`PATCH /api/incidents/<id>/status/`):
  - `REPORTED -> ACKNOWLEDGED` (Admin, Security within society)
  - `ACKNOWLEDGED -> ASSIGNED` (Admin via assign or status endpoint when `assigned_to` exists)
  - `REPORTED -> ASSIGNED` (Admin shortcut / assignment auto-acknowledges by setting `acknowledged_at` if null)
  - `ASSIGNED -> IN_PROGRESS` (Assigned volunteer only, or Admin)
  - `IN_PROGRESS -> RESOLVED` (Assigned volunteer only, or Admin)
  - `RESOLVED -> CLOSED` (Admin only, `close_reason` optional/recorded)
  - Admin close override: Admin may transition any non-`CLOSED` incident to `CLOSED` with a non-empty `close_reason` (or `note` fallback).
  - Security may also add an acknowledgment/note via `PATCH /api/incidents/<id>/status/` when `status='ACKNOWLEDGED'` (either moving from `REPORTED -> ACKNOWLEDGED`, or adding a status note while already `ACKNOWLEDGED`? Actually transition strict: `REPORTED -> ACKNOWLEDGED` plus dedicated note handling when already acknowledged or strict transition validation — we enforce valid transition or note addition cleanly).
  - Residents and Guardians cannot transition incident status (`403`). Closed incidents are strictly read-only (`400`).

## 6. Notifications & Transaction Safety
- `Notification.recipient_type` extended with `'admin'` and `'resident'`; `Notification.event_type` added (`INCIDENT_REPORTED`, `INCIDENT_ASSIGNED`, `STATUS_CHANGED`, `EVIDENCE_ADDED`, `ESCALATED`).
- `dedupe_key` incorporates `event_type`, `recipient_type`, recipient identifier, channel, and status/discriminator (e.g. `INCIDENT_REPORTED:admin:5:in_app:REPORTED`, `STATUS_CHANGED:resident:2:in_app:IN_PROGRESS`) so repeated transitions along the lifecycle still notify while duplicate calls for the same event do not duplicate records.
- Note for tests & dispatch: `transaction.on_commit(...)` is used on API views (`create`, `assign`, `status_update`, `evidence`, `escalate`) so rolled-back transactions never notify! Note that Django's `APITestCase` runs each test inside a transaction block — Django 5.1+/6.1 `TestCase` / `APITestCase` handles `on_commit` cleanly via `captureOnCommitCallbacks` or `TransactionTestCase`! Let's verify how Django 6.1 executes `on_commit` inside `APITestCase` during Phase 3/4 testing (`TestCase.captureOnCommitCallbacks(execute=True)` vs `TransactionTestCase`, or wait — in Django `APITestCase` wraps tests in `atomic()`, meaning `on_commit` callbacks DO NOT fire inside an `APITestCase` unless `TransactionTestCase` is used OR Django 6.1 only runs them after `commit()`!). WAIT A SECOND — catching that BEFORE coding is HUGE!! Let's verify how Django 6.1 behaves with `APITestCase` + `transaction.on_commit` right away when we test!

## 7. Local Production Verification on Windows
- `gunicorn`, `whitenoise`, `dj-database-url`, `cloudinary`, `django-cloudinary-storage`, and `drf-spectacular` are pinned in `backend/requirements.txt` and configured in `render.yaml` / `build.sh` for Linux/Render cloud deployment.
- Because `gunicorn` requires Unix `fcntl` and cannot bind sockets natively on Windows, local Windows verification runs Django's production WSGI app (`config.wsgi:application`) with `DEBUG=False`, `collectstatic` + `whitenoise`, and PostgreSQL `DATABASE_URL` via `waitress` (with `gunicorn` verified in `requirements.txt` / `render.yaml` / `check --deploy`), while `DEPLOYMENT.md` keeps exact `gunicorn config.wsgi` commands for Render.

