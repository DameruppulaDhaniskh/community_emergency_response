# SafeCircle — Community Emergency Response API Reference (Milestone 3)

- **Base URL:** `/api`
- **Swagger UI:** `/api/docs/`
- **OpenAPI Schema:** `/api/schema/`
- **Health Probe:** `GET /api/health/`
- **Authentication:** JWT Bearer (`Authorization: Bearer <access_token>`)

---

## 1. Authentication & Users (`/api/auth/`, `/api/users/`)

| Method | Endpoint | Allowed Roles | Description |
|---|---|---|---|
| `POST` | `/api/auth/register/` | Public | Register a new account (`resident`, `guardian`, `volunteer`, `security`). Requires unique case-insensitive `username` (3-30 chars `[A-Za-z0-9_.]`) and unique `phone` (normalized, default `+91`). |
| `POST` | `/api/auth/login/` | Public | Obtain `{ access, refresh }` JWT tokens using `{ email, password }`. |
| `POST` | `/api/auth/token/refresh/` | Public | Refresh & rotate access/refresh tokens. |
| `POST` | `/api/auth/logout/` | Authenticated | Blacklist refresh token `{ refresh }`. |
| `GET, PATCH` | `/api/auth/profile/` | Authenticated | View or update own profile (`email` and `role` read-only; validates unique `username` & `phone`). |
| `POST` | `/api/auth/change-password/` | Authenticated | `{ old_password, new_password }`. |
| `GET` | `/api/users/lookup/?identifier=` | Authenticated | Exact lookup by username (case-insensitive) or normalized phone (`20/min` throttle). Returns `{ id, name, username, masked_phone, role }` (`404` if not found/inactive). |
| `GET` | `/api/users/` | Admin (all) / Self | List users (non-admins see only themselves). |
| `GET, PATCH, DELETE` | `/api/users/<id>/` | Admin / Self | Retrieve/update user or delete (Admin). |

---

## 2. Society, Emergency Contacts & Guardian Requests

- **Society:** `GET/POST /api/society/`, `GET/PATCH/DELETE /api/society/<id>/`, `/api/society/<id>/blocks/`, `/api/society/blocks/<id>/flats/`, `/api/society/mappings/`

| Method | Endpoint | Allowed Roles | Description |
|---|---|---|---|
| `GET` | `/api/contacts/` | Resident / Admin | Active contacts (`status` in `pending`, `accepted`, `declined` by default; `?status=all` includes cancelled). |
| `POST` | `/api/contacts/` | Resident | For `primary_guardian` / `secondary_guardian`: takes `{ identifier, contact_type, relationship, priority }`, resolves active `guardian` user (not self), creates `pending` request and notifies guardian (`GUARDIAN_REQUEST`). For `emergency_contact`: `{ identifier }` links active user immediately (`accepted`), or `{ name, phone, relationship }` stores unverified plain contact. |
| `GET, PATCH, DELETE` | `/api/contacts/<id>/` | Resident / Admin | Retrieve, update `relationship`/`priority` (and name/phone on unlinked plain contacts), or soft-delete (`is_active=False`). Declined/cancelled/removed slots are immediately reusable. |
| `POST` | `/api/contacts/<id>/cancel/` | Resident | Cancels own `pending` guardian request (`status=cancelled`). |
| `POST` | `/api/contacts/<id>/resend/` | Resident | Rate-limited reminder for `pending` request (`429` within 30s), or creates a fresh `pending` request (`201`) from a `declined` contact. |
| `POST` | `/api/contacts/<id>/verify/` | Authenticated | Retired (`410 Gone`). Resident self-verification is removed. |
| `GET` | `/api/guardian/requests/?status=pending` | Guardian | Incoming guardian requests (`resident_name`, `flat`, `block`, `society`, `resident_phone`, `contact_type`, `relationship`, `created_at`). |
| `POST` | `/api/guardian/requests/<id>/accept/` | Addressed Guardian (`404` else) | Idempotent transition `pending -> accepted`, sets `is_verified=True`, `verified_at`, `responded_at`, notifies resident (`GUARDIAN_ACCEPTED`). |
| `POST` | `/api/guardian/requests/<id>/decline/` | Addressed Guardian (`404` else) | Idempotent transition `pending -> declined`, notifies resident (`GUARDIAN_DECLINED`). |
| `GET` | `/api/guardian/dependents/` | Guardian | Accepted dependent residents with `name`, `flat`, `society`, `phone`, `has_active_incident`, `active_incident_id`. |

---

## 3. Incidents, Evidence & Workflow (`/api/incidents/`)

### Six Official Statuses
`REPORTED` -> `ACKNOWLEDGED` -> `ASSIGNED` -> `IN_PROGRESS` -> `RESOLVED` -> `CLOSED`
*(Admin may also move `REPORTED -> ASSIGNED` on volunteer assignment, or close any non-`CLOSED` incident with a `close_reason`. Closed incidents are read-only.)*

### 3.1 `POST /api/incidents/sos/` (Resident only)
One-tap emergency SOS alert. Auto-sets title `"SOS: <Category>"`, status `REPORTED`, writes `IncidentHistory(created)`, and dispatches alerts (`INCIDENT_REPORTED`) post-commit.

**Request:**
```json
{
  "emergency_type": "medical",
  "description": "Chest pain, door unlocked",
  "latitude": "12.971600",
  "longitude": "77.594600",
  "location_accuracy": 10.0
}
```
**Response (`201 Created`):**
```json
{
  "id": 15,
  "status": "REPORTED",
  "created_at": "2026-11-10T10:30:00Z",
  "location_available": true
}
```

### 3.2 `POST /api/incidents/` (Resident only, `multipart/form-data` or JSON)
Detailed incident report with optional photo evidence (up to 5 files, `jpg/jpeg/png/webp`, max `5 MB` each).

**Form Fields:**
- `title` (string, required)
- `category` (`medical | fall | fire | security | accident | other`, required)
- `description` (string, optional)
- `latitude`, `longitude`, `location_accuracy` (optional; must provide both `latitude` and `longitude` if providing location)
- `images` (optional repeated file field, max 5)

**Response (`201 Created`):**
```json
{
  "id": 16,
  "title": "Water leak near electrical panel",
  "category": "fire",
  "status": "REPORTED",
  "created_at": "2026-11-10T10:35:00Z",
  "location_available": true,
  "evidence_count": 1
}
```

### 3.3 `GET /api/incidents/` (Role-scoped; 404 for hidden records)
- **Access scoping:**
  - `resident`: own incidents
  - `volunteer`: assigned incidents only (`assigned_to = user`)
  - `security`: incidents in societies assigned via `SocietyAssignment`
  - `admin`: incidents in societies where `society.admin = user`
  - `guardian`: incidents for verified linked dependents (`EmergencyContact`)
- **Query Params:** `?status=&category=&assigned_to=&is_escalated=&search=&ordering=&page=&page_size=`
  - Passing `page` or `page_size` returns `{ count, next, previous, results }`. Omitting pagination params returns a JSON array `[...]`.

### 3.4 `GET /api/incidents/<id>/` (Authorized viewers; `404` otherwise)
Returns full incident detail including nested `reporter`, `assigned_to`, `location`, `evidence`, `history`, and `history_summary`.

**Response (`200 OK`):**
```json
{
  "id": 16,
  "resident": 2,
  "resident_name": "Asha Rao",
  "flat_number": "Flat 101, Block A",
  "reported_by": 2,
  "reporter": { "id": 2, "name": "Asha Rao", "phone": "9876543210" },
  "title": "Water leak near electrical panel",
  "category": "fire",
  "emergency_type": "fire",
  "description": "Sparking on ground floor",
  "latitude": "12.971600",
  "longitude": "77.594600",
  "location_available": true,
  "location": {
    "available": true,
    "latitude": "12.971600",
    "longitude": "77.594600",
    "accuracy": 10.0,
    "captured_at": "2026-11-10T10:35:00Z"
  },
  "status": "ASSIGNED",
  "is_escalated": false,
  "escalated_at": null,
  "assigned_to_id": 5,
  "assigned_to": { "id": 5, "name": "Priya Sharma", "phone": "9800000003" },
  "assigned_at": "2026-11-10T10:38:00Z",
  "acknowledged_at": "2026-11-10T10:38:00Z",
  "in_progress_at": null,
  "resolved_at": null,
  "closed_at": null,
  "close_reason": "",
  "evidence": [
    {
      "id": 1,
      "incident": 16,
      "uploaded_by": 2,
      "uploaded_by_name": "Asha Rao",
      "image": "/media/evidence/2026/11/panel.png",
      "image_url": "http://127.0.0.1:8000/media/evidence/2026/11/panel.png",
      "url": "http://127.0.0.1:8000/media/evidence/2026/11/panel.png",
      "created_at": "2026-11-10T10:35:00Z"
    }
  ],
  "evidence_urls": ["http://127.0.0.1:8000/media/evidence/2026/11/panel.png"],
  "history": [
    {
      "id": 1,
      "incident": 16,
      "changed_by": 2,
      "changed_by_name": "Asha Rao",
      "event_type": "created",
      "from_status": "",
      "to_status": "REPORTED",
      "note": "Incident reported: Water leak near electrical panel",
      "created_at": "2026-11-10T10:35:00Z"
    }
  ],
  "history_summary": {
    "total_events": 1,
    "latest_event_type": "created",
    "latest_note": "Incident reported: Water leak near electrical panel",
    "latest_event_at": "2026-11-10T10:35:00Z"
  },
  "created_at": "2026-11-10T10:35:00Z",
  "updated_at": "2026-11-10T10:38:00Z"
}
```

### 3.5 `GET` & `PATCH /api/incidents/<id>/status/`
- `GET`: Lightweight status response `{ id, status, is_escalated, escalated_at, acknowledged_at, assigned_at, in_progress_at, resolved_at, closed_at, close_reason, updated_at }`.
- `PATCH`: `{ "status": "IN_PROGRESS", "note": "On site", "close_reason": "..." }`
  - `admin`: all valid transitions; early close requires `close_reason`/`note`.
  - `security`: `REPORTED -> ACKNOWLEDGED` (and notes while `ACKNOWLEDGED`).
  - `volunteer` (assigned only): `ASSIGNED -> IN_PROGRESS`, `IN_PROGRESS -> RESOLVED`.
  - `resident` / `guardian`: `403 Forbidden`.
  - Invalid transitions or editing `CLOSED`: `400 Bad Request`.

### 3.6 `POST /api/incidents/<id>/assign/` (Admin only)
**Request:** `{ "volunteer_id": 5, "note": "Respond with first-aid kit" }`
- Volunteer must be active, `role="volunteer"`, `is_available=True`, and assigned to the resident's society.
- Allowed before `IN_PROGRESS` (supports reassignment). Auto-acknowledges `REPORTED` and sets status `ASSIGNED`. Notifies assigned volunteer + resident.

### 3.7 `POST /api/incidents/<id>/evidence/` & `GET /api/incidents/<id>/evidence/`
- `POST` (`multipart/form-data`, `image` or `images`): Reporter only, while incident is not `CLOSED`. Enforces max 5 images total, `<= 5 MB`, `jpg/png/webp`. Writes `evidence_added` history and notifies society admins (`EVIDENCE_ADDED`).

### 3.8 `GET /api/incidents/<id>/history/` & `POST /api/incidents/<id>/escalate/`
- `GET /api/incidents/<id>/history/`: Chronological timeline for any user in `incidents_for_user`.
- `POST /api/incidents/<id>/escalate/`: Sets `is_escalated=true`, triggers multi-target escalation pipeline and notifies admins (`ESCALATED`).

### 3.9 `GET /api/resident/incidents/`
Returns array of logged-in resident's own incidents.

### 3.10 `GET` & `PUT/PATCH /api/resident/escalation-settings/` (Resident only)
- `GET`: View current escalation preferences and live preview of reachable volunteers categorized block-first:
  - `preview.has_verified_guardian`: boolean
  - `preview.security_available`: boolean
  - `preview.volunteer_breakdown`: `{ summary, total_count, same_block_count, same_society_count, neighbour_society_count }`
- `PUT / PATCH`: Update `{ has_security_guard, escalate_to_security, escalate_to_volunteers, escalate_to_secondary_guardian, response_window_seconds, volunteer_radius_km }`. Validates window between 60-300 seconds and radius between 0.5-5.0 km.

### 3.11 `POST /api/incidents/<id>/guardian-ack/` (Guardian only)
Guardian records "I am responding" to active SOS.
- Sets `guardian_acknowledged_at = timezone.now()` and `guardian_acknowledged_by = request.user`.
- Clears `escalate_at = None`, cancelling the server-side auto-escalation timer.
- Moves incident status from `REPORTED` -> `ACKNOWLEDGED`.
- Records history event `guardian_acknowledged` and notifies resident.

### 3.12 `POST /api/incidents/<id>/handoff/` (Guardian only)
Guardian hands off emergency alert when unavailable or far away.
- **Request Body:**
  ```json
  {
    "targets": ["secondary_guardian", "security", "volunteers"],
    "reason": "far_away",
    "note": "Travelling out of town, please dispatch local help."
  }
  ```
- Triggers multi-target escalation pipeline immediately with reason and note.
- Dispatches `ESCALATION_HANDOFF` notifications containing GPS coordinates and Google Maps navigation link.

### 3.13 `POST /api/incidents/<id>/accept/` (Volunteer only)
Atomic first-come, first-served acceptance of an escalated incident (`select_for_update`).
- **First accept:** Claims assignment (`200 OK`), updates status to `ASSIGNED`, sets `assigned_to = user`, unredacts sensitive resident details for the responder, and dispatches `ESCALATION_ACCEPTED` to resident, guardians, security, admin, and competing volunteers ("Taken by <name>").
- **Subsequent accepts:** Returns `409 Conflict` (`{"detail": "This incident was already accepted by <name>."}`).
- Enforces volunteer profile must have `approval_status == 'approved'`.

### 3.14 `PATCH /api/incidents/<id>/location/` (Resident reporter only)
Streams live GPS updates for an active emergency incident:
- **Request Body:** `{"latitude": 12.9716, "longitude": 77.5946, "accuracy": 8.0}`
- Stores audit history in `IncidentLocationUpdate` and updates incident's current coordinates.

---

## 4. Volunteers & Admin Approvals

| Method | Endpoint | Allowed Roles | Description |
|---|---|---|---|
| `GET` | `/api/volunteers/available/?incident_id=` | Admin | Assignable available volunteers in incident/admin society with `open_assignments_count`. |
| `GET` | `/api/volunteer/incidents/` | Volunteer | Incidents assigned to logged-in volunteer (`?status=`). |
| `GET, PATCH` | `/api/volunteer/availability/` | Volunteer | Read or update `{"is_available": true/false}` on active `SocietyAssignment`s. |
| `GET, PATCH` | `/api/volunteer/location/` | Volunteer | Read or update volunteer's live GPS coordinates (`{"latitude", "longitude", "accuracy"}`). Pinged periodically while on-duty. |
| `GET, PATCH` | `/api/volunteer/profile/` | Volunteer | View or update volunteer's base pin (`latitude`, `longitude`, `pin_label`), max travel radius, and `serves_nearby_societies` toggle. |
| `GET` | `/api/admin/volunteers/?status=&search=` | Admin | List volunteer applications for society with approval status, distance to society center, and `pin_far_from_society` warning flag (> 3.0 km). |
| `POST` | `/api/admin/volunteers/<id>/approve/` | Admin | Approve volunteer application (`approval_status='approved'`), activate society assignment, and notify volunteer. |
| `POST` | `/api/admin/volunteers/<id>/reject/` | Admin | Reject volunteer application with mandatory reason (`{"reason": "..."}`). |
| `GET, PATCH` | `/api/society/policy/` | Admin | Society alert policy: `include_neighbour_societies` (Tier 3 toggle), `neighbour_radius_km`, and society center GPS coordinates. |

---

## 5. Notifications (`/api/notifications/`)

| Method | Endpoint | Allowed Roles | Description |
|---|---|---|---|
| `GET` | `/api/notifications/?is_read=&type=alerts\|updates&channel=&delivery_status=` | Recipient | Recipient's notifications (including non-incident guardian notifications with `incident: null`). `alerts` = `INCIDENT_REPORTED, ESCALATED, GUARDIAN_REQUEST`; `updates` = `INCIDENT_ASSIGNED, STATUS_CHANGED, EVIDENCE_ADDED, GUARDIAN_ACCEPTED, GUARDIAN_DECLINED`. |
| `GET` | `/api/notifications/unread-count/` | Authenticated | `{"unread_count": 3}` (unread `in_app` notifications). |
| `POST` | `/api/notifications/read-all/` | Authenticated | Marks all unread `in_app` notifications read (`{"marked_read": 3}`). |
| `GET` | `/api/notifications/<id>/` | Recipient (`404` else) | Single notification detail. |
| `PATCH` | `/api/notifications/<id>/read/` | Recipient (`in_app` only) | Marks one notification read without altering `delivery_status`. |
| `GET` | `/api/incidents/<id>/notifications/` | Admin, Security, Resident | Audit trail of delivery statuses (`403` for guardian/volunteer). |
| `POST` | `/api/incidents/<id>/notifications/retry/` | Admin, Security | Retries `FAILED` deliveries (max 3 attempts, 60s cooldown, atomic claim). |

---

## 6. Health & OpenAPI Docs

- `GET /api/health/` (Public) -> `200 {"status": "ok", "database": "connected"}` or `503`.
- `GET /api/schema/` -> OpenAPI 3.0 schema JSON/YAML.
- `GET /api/docs/` -> Interactive Swagger UI.

