# Backend Gaps & Frontend Contract Specifications

This document outlines the missing endpoints, model fields, and capabilities in the Django backend discovered during the frontend redesign. As instructed, these gaps are not faked silently: they are formally specified here and backed by isolated, clearly marked mock adapters in `frontend/src/api/` that mirror the exact planned API contracts.

---

## 1. Guardian Request & Verification Flow

### Problem
In `backend/contacts/models.py`, `EmergencyContact` has:
- `linked_user`: ForeignKey to User (nullable)
- `is_verified`: Boolean (default=False)
- `verification_token`: string (used only with a direct token submission)

However:
1. When a resident adds a guardian by phone or email, there is no field to track whether the guardian has **accepted** or **declined** the request (`status: 'pending' | 'accepted' | 'declined'`).
2. There is **no endpoint** for a guardian to view requests sent to them (`GET /api/guardian/requests/`).
3. There is **no endpoint** for a guardian to accept or decline (`POST /api/guardian/requests/<id>/accept/` and `POST /api/guardian/requests/<id>/decline/`).
4. In `backend/incidents/access.py`, a guardian only sees incidents for residents where `EmergencyContact.objects.filter(linked_user=user, is_verified=True, is_active=True)`. Without an accept endpoint, the guardian is never linked with `is_verified=True`.

### Planned Backend Specification
- **Model additions to `EmergencyContact`**:
  ```python
  STATUS_CHOICES = [
      ('pending', 'Pending Approval'),
      ('accepted', 'Accepted'),
      ('declined', 'Declined'),
      ('cancelled', 'Cancelled by Resident'),
  ]
  status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='pending')
  guardian_notes = models.CharField(max_length=200, blank=True)
  responded_at = models.DateTimeField(null=True, blank=True)
  ```
- **New Endpoints**:
  - `GET /api/guardian/requests/` (Guardian role): Returns list of emergency contacts where `linked_user=request.user` or matching `phone`/`email` with `status='pending'`.
  - `POST /api/guardian/requests/<id>/accept/` (Guardian role): Sets `status='accepted'`, `is_verified=True`, `verified_at=now()`, and links `linked_user=request.user`. Automatically creates an in-app notification for the resident.
  - `POST /api/guardian/requests/<id>/decline/` (Guardian role): Sets `status='declined'`, `is_active=False`. Dispatches notification to resident.
  - `POST /api/contacts/<id>/cancel/` (Resident role): Cancels a pending request before guardian responds.

### Frontend Mock Adapter
- Implemented in: [`src/api/guardianRequests.ts`](file:///d:/Infosys%20project/Community%20Emergency%20Response/Community%20Emergency%20Response/frontend/src/api/guardianRequests.ts)
- Persists to `localStorage` (bridged to `/api/contacts/` data) so requests survive page reloads and immediately update dependent counts, badges, and escalation chain warnings.

---

## 2. Incident Status Updates & Responders

### Problem
- `backend/incidents/views.py` only provides `SOSCreateView`, `IncidentListView`, `IncidentDetailView`, and `IncidentStatusView` (all read-only except SOS create).
- Security personnel and admins cannot change an incident's status to `ACTIVE_RESPONSE`, `ESCALATED`, `RESOLVED`, or `CANCELLED`.
- No endpoints exist for responders (security or volunteers) to claim an incident (`accepted`, `en_route`, `arrived`).
- No endpoint for incident chat / notes thread (`GET/POST /api/incidents/<id>/messages/`).

### Planned Backend Specification
- `PATCH /api/incidents/<id>/`: Update status and add closure notes (Security, Admin).
- `POST /api/incidents/<id>/respond/`: `{ action: 'accept' | 'decline' | 'en_route' | 'arrived' }` (Volunteer, Security).
- `GET /api/incidents/<id>/messages/` & `POST /api/incidents/<id>/messages/`: Incident discussion.

### Frontend Mock Adapter
- Implemented in: `src/api/incidents.ts` (`updateIncidentStatus`, `getIncidentMessages`, `postIncidentMessage`, `getIncidentResponders`).

---

## 3. Volunteer Availability Toggle

### Problem
- `backend/society/models.py` has `SocietyAssignment.is_available = models.BooleanField(default=True)`.
- However, no view or URL is registered in `society/urls.py` allowing a volunteer to view or toggle their availability.

### Planned Backend Specification
- `GET /api/volunteer/availability/`
- `POST /api/volunteer/availability/`: `{ is_available: boolean }`

### Frontend Mock Adapter
- Implemented in: `src/api/volunteers.ts` (`getAvailability`, `toggleAvailability`).

---

## 4. Password Reset

### Problem
- No password reset endpoint exists in `backend/users/urls.py`.

### Frontend Mock Adapter
- Implemented in: `src/api/auth.ts` (`forgotPassword`, `resetPassword`).

