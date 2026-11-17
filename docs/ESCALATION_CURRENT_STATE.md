# SafeCircle SOS Location, Guardian Response & Escalation: Current State Assessment

This document analyzes the current baseline of the SafeCircle / CERAN system across backend (`backend/`) and frontend (`frontend/`) before implementing the complete SOS location, guardian response, block-first volunteer matching, and multi-tier escalation system.

---

## 1. Executive Summary

SafeCircle currently implements:
- Core 6-status incident lifecycle (`REPORTED`, `ACKNOWLEDGED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`) and basic boolean `is_escalated`.
- Verified guardian consent flow (`pending` -> `accepted` | `declined` | `cancelled`) with unique usernames and normalized phones.
- Basic location capture on SOS (`latitude`, `longitude`, `location_accuracy`, `location_captured_at`) on the `Incident` model.
- Static society assignments for security and volunteers (`SocietyAssignment`), and whole-society notification broadcasts.

### Key Gaps Before This Implementation
1. **SOS Dispatch Logic:** Currently broadcasts immediately to verified guardians, security, and available volunteers across the society at once upon creation (`notify_incident`), rather than alerting the verified primary guardian first with a response window.
2. **Missing Escalation Plan & State Machine:** `Incident` lacks `guardian_alerted_at`, `guardian_acknowledged_at/by`, `escalate_at`, `escalation_window_seconds`, `escalation_plan` (JSON snapshot), `escalation_trigger`, and `no_responder_alerted_at`.
3. **Missing Models:**
   - `ResidentEscalationSettings` (per-resident configuration: `has_security_guard`, target toggles, `response_window_seconds`, `volunteer_radius_km`).
   - `IncidentEscalation` (audit trail of manual handoffs, auto-timeouts, and no-responder alerts).
   - `VolunteerLocation` (live volunteer coordinates, staleness tracking).
   - `VolunteerProfile` (block assignment, `serves_nearby_societies`, `approval_status`, far-pin warning, travel limit).
   - `IncidentLocationUpdate` (live incident tracking).
4. **Volunteer Matching:** Currently has no proximity/Haversine ranking, no block-first tiering (Tier 1 same block, Tier 2 same society, Tier 3 neighbouring society), no admin approval workflow, and no first-come-first-served atomic `accept` endpoint (`POST /api/incidents/{id}/accept/`).
5. **Server-Side Timers:** Escalation timer does not run server-side; no background worker (`run_escalation_worker`) or opportunistic tick exists.
6. **Frontend Experience:**
   - SOS flow uses basic single-shot geolocation and a hardcoded countdown.
   - Safety Circle page lacks Escalation Settings and tier preview.
   - Guardian Live Alerts page lacks a real OpenStreetMap Leaflet map, "I'm responding" ack, "I can't help" handoff modal, and live countdown banner.
   - Volunteer and Security views lack incoming escalated alert cards, live location reporting, and atomic accept actions.
   - Admin lacks Volunteer Approvals and Neighbouring Society policy configuration.

---

## 2. Backend Inventory

### 2.1 Models & DB Schema

| App | Model | Current Fields / Behavior | Needed Extensions |
| --- | --- | --- | --- |
| `incidents` | `Incident` | `resident`, `reported_by`, `title`, `category`, `emergency_type`, `description`, `latitude`, `longitude`, `location_accuracy`, `location_captured_at`, `status`, `assigned_to`, `assigned_at`, `acknowledged_at`, `in_progress_at`, `resolved_at`, `closed_at`, `close_reason`, `is_escalated`, `escalated_at` | Add `guardian_alerted_at`, `guardian_acknowledged_at`, `guardian_acknowledged_by`, `escalate_at`, `escalation_window_seconds`, `escalation_plan` (JSON), `escalated_by`, `escalation_trigger` (`none`, `manual_guardian`, `manual_resident`, `auto_timeout`), `no_responder_alerted_at` |
| `incidents` | `ResidentEscalationSettings` | *Does not exist* | New model: `resident` (OneToOne), `has_security_guard`, `escalate_to_security`, `escalate_to_volunteers`, `escalate_to_secondary_guardian`, `response_window_seconds` (60–300), `volunteer_radius_km` (0.5–5.0) |
| `incidents` | `IncidentEscalation` | *Does not exist* | New model: `incident` (FK), `kind` (`manual_guardian`, `manual_resident`, `auto_timeout`, `no_responder`), `triggered_by` (FK nullable), `targets` (JSON), `reason`, `note`, `volunteer_ids` (JSON), `created_at` |
| `incidents` | `IncidentLocationUpdate` | *Does not exist* | New model: `incident` (FK), `latitude`, `longitude`, `accuracy`, `captured_at` |
| `users` / `society` | `VolunteerProfile` | *Does not exist* | New model: `user` (OneToOne), `society` (FK required), `block` (FK nullable), `serves_nearby_societies` (bool), `approval_status` (`pending`, `approved`, `rejected`), `approval_reviewed_by`, `approval_reviewed_at`, `approval_note`, `pin_far_from_society` (bool), `pin_distance_from_society_km`, `latitude`, `longitude`, `max_travel_km` |
| `users` / `incidents` | `VolunteerLocation` | *Does not exist* | New model: `user` (OneToOne), `latitude`, `longitude`, `accuracy`, `updated_at` |
| `society` | `Society` | `name`, `registration_number`, `address`, `city`, `state`, `pincode`, `contact_email`, `contact_phone`, `admin`, `is_active` | Add `latitude`, `longitude` (nullable) |
| `society` | `SocietyAlertPolicy` | `society`, `notify_community` | Add `include_neighbour_societies` (bool default false), `neighbour_radius_km` (float default 3.0, 0.5–10.0) |
| `notifications` | `Notification` | Event types: `INCIDENT_REPORTED`, `INCIDENT_ASSIGNED`, `STATUS_CHANGED`, `EVIDENCE_ADDED`, `ESCALATED`, `GUARDIAN_REQUEST`, `GUARDIAN_ACCEPTED`, `GUARDIAN_DECLINED` | Add event types: `GUARDIAN_SOS`, `ESCALATION_HANDOFF`, `ESCALATION_AUTO`, `ESCALATION_ACCEPTED`, `NO_RESPONDER`, `ESCALATION_NOTICE` |

### 2.2 Endpoints Inventory

| Method & Path | Current State | Required Escalation State |
| --- | --- | --- |
| `POST /api/incidents/sos/` | Stores coordinates, returns M3 incident, immediately alerts guardians, security, volunteers | Validate coordinates (-90..90, -180..180, >=0 accuracy; both or neither). If resident has verified guardian: notify primary guardian only, set `escalate_at = now + window_seconds`. If no verified guardian: escalate immediately. Return escalation plan snapshot. |
| `GET /api/incidents/{id}/` | Returns standard incident detail | Extend with `location` (with Google Maps link), `escalation` (window, timer, countdown, trigger, history), `guardian_acknowledged`, `alerted` summary, `handoff_defaults`. Enforce cross-society volunteer privacy rule (limited fields prior to acceptance). |
| `GET, PUT /api/resident/escalation-settings/` | *Not implemented* | Implement for resident; validate ranges; provide preview with guardian names, security availability, and tier breakdown ("X in block, Y in society, Z in neighbouring societies"). |
| `POST /api/incidents/{id}/guardian-ack/` | *Not implemented* | Implement for verified guardian: sets `guardian_acknowledged_at/by`, transitions `REPORTED` -> `ACKNOWLEDGED`, writes history, cancels pending auto-escalation, notifies resident. |
| `POST /api/incidents/{id}/handoff/` | *Not implemented* | Implement for verified guardian: accepts `{targets, reason, note}`, verifies targets against resident settings and society guard availability, performs distance ranking for volunteers, creates `IncidentEscalation`, stops auto timer, dispatches notifications. |
| `POST /api/incidents/{id}/accept/` | *Not implemented* | Implement atomic first-come volunteer accept using `select_for_update`. Sets `assigned_to`, transitions to `ASSIGNED`, writes history, notifies resident/guardians/security/admins, tells others "Taken". Second caller receives `409 Conflict`. |
| `PATCH, GET /api/volunteer/location/` | *Not implemented* | Implement for volunteers to report current GPS position; checks 15-minute staleness window. |
| `GET /api/admin/volunteers/` | *Not implemented* | Implement paginated list filtered by `status=pending|approved|rejected&search=`, including distance from society and far-pin warning. |
| `POST /api/admin/volunteers/{id}/approve/` & `/reject/` | *Not implemented* | Admin approval/rejection endpoints with audit fields and notifications. |
| `GET, PATCH /api/volunteer/profile/` | *Not implemented* | Profile endpoint for volunteers to manage block, pin, travel radius, and `serves_nearby_societies`. |
| `PATCH /api/society/policy/` | Only handles `notify_community` | Extend to support `include_neighbour_societies`, `neighbour_radius_km`, and society latitude/longitude. |

---

## 3. Frontend Inventory

| Page / Component | Current Implementation | Needed Implementation |
| --- | --- | --- |
| `features/sos/SOSFlow.tsx` | Single `getCurrentPosition` call; static 90s countdown; basic mock notification list | High-accuracy `watchPosition` (up to 5s, selects lowest accuracy value). Displays accuracy label ("Location accurate to 12 m" or "Location not shared"). Real countdown bound to `escalate_at`. Displays escalation target list. "Escalate now" button. Status updates for guardian response / handoff / volunteer acceptance. Prominent "Call 112" alert on `no_responder` trigger. |
| `features/contacts/ContactsPage.tsx` | Manages contacts & guardian requests; lacks escalation configuration | Add "Escalation settings" card with switches for security guard, target checkboxes, response time selector (1, 2, 3, 5 min), volunteer radius (0.5, 1, 2, 5 km), live preview sentence, and tier preview. |
| `features/incidents/GuardianIncidentsPage.tsx` | List of incidents and pending requests; no map, ack, or handoff modal | Full "Live Alerts" detail panel: urgency sort, real Leaflet OpenStreetMap card with coordinates, Google Maps link, "Copy coordinates". Big action buttons: "Call resident", "I'm responding", "I can't help, pass it on". Modal with reasons, category defaults, note, and handoff execution. Countdown banner and alert history. Active alert indicator in sidebar and header. |
| `features/volunteers/VolunteerAssignmentList.tsx` | Simple list of assigned incidents; availability toggle | Incoming escalated alert cards with category, distance, elapsed time, Leaflet map, and "Accept" button. "Taken by <name>" state. Cross-society privacy view (limited details until accepted). Background browser location reporting every 60s when on-duty. |
| `features/incidents/LiveDashboardPage.tsx` (Security) | Incident list and basic actions | Incoming alert card with location map, Acknowledge button, escalation info. |
| `features/admin/UserManagementPage.tsx` & new `VolunteerApprovalsPage.tsx` | Admin user CRUD | Dedicated Volunteer Approvals view with Pending/Approved/Rejected tabs, far-pin warnings, map preview, and Approve/Reject dialogs. Neighbouring societies configuration card. |

---

## 4. Execution Plan

1. **Backend Database & Models:**
   - Add `ResidentEscalationSettings`, `IncidentEscalation`, `VolunteerProfile`, `VolunteerLocation`, and `IncidentLocationUpdate`.
   - Add new fields to `Incident`, `Society`, and `SocietyAlertPolicy`.
   - Update `Notification.EVENT_TYPES` with the 6 new escalation event types.
   - Run migrations with data backfills (existing volunteers migrated as `approval_status='approved'`).
2. **Matching Engine & Services:**
   - Implement `backend/incidents/matching.py` with Haversine distance calculation, Tier 1/2/3 matching, stale location fallback, radius widening, and cross-society privacy checks.
   - Implement `backend/incidents/escalation.py` with `process_due_escalations()`, `escalate_incident()`, guardian ack, handoff, and volunteer atomic accept.
   - Implement `run_escalation_worker` management command and opportunistic cache-throttled check.
3. **API Views & Serializers:**
   - Update `SOSCreateView`, `IncidentDetailView`, and add settings, handoff, ack, accept, volunteer location, and admin volunteer approval views.
4. **Backend Tests:**
   - Comprehensive test suite for all escalation paths, timers, matching tiers, permissions, and 409 conflict.
5. **Frontend Implementation:**
   - Leaflet map integration with OpenStreetMap tiles.
   - Resident SOS flow, high-accuracy geolocation, and countdown screen.
   - Safety Circle Escalation Settings card and live preview.
   - Guardian Live Alerts: map card, Call button, "I'm responding", "I can't help" modal, countdown banner.
   - Volunteer incoming alert card, location tracking, and atomic accept.
   - Security and Admin approval views.
6. **Verification & Evidence:**
   - End-to-end multi-account verification script, Newman run, build/lint checks, and documentation in `docs/evidence/escalation-flow.md` and `docs/evidence/volunteer-matching.md`.

