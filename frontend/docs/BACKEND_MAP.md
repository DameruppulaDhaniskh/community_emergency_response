# Backend API Map — Community Emergency Response & Assistance Network (CERAN)

Generated from Django REST Framework codebase inspection.

## 1. Authentication & Users (`/api/auth/`, `/api/users/`)

| Method | Path | Request Body | Response Shape | Allowed Roles | Notes |
|---|---|---|---|---|---|
| `POST` | `/api/auth/register/` | `{ username, email, first_name, last_name, phone, role, password, confirm_password }` | `UserProfile` | Anyone (AllowAny) | `role` in `['resident', 'guardian', 'volunteer', 'security']` |
| `POST` | `/api/auth/login/` | `{ email, password }` | `{ access: string, refresh: string }` | Anyone (AllowAny) | SimpleJWT TokenObtainPairView (uses `email` as username) |
| `POST` | `/api/auth/token/refresh/` | `{ refresh: string }` | `{ access: string, refresh?: string }` | Anyone | Auto token rotation enabled |
| `POST` | `/api/auth/logout/` | `{ refresh: string }` | `{}` | Authenticated | Blacklists refresh token |
| `GET` | `/api/auth/profile/` | None | `UserProfile` | Authenticated | Returns current authenticated user |
| `GET, PATCH` | `/api/auth/profile/` | `{ first_name?, last_name?, username?, phone?, address?, profile_image_url? }` | `UserProfile` | Authenticated | Validates unique case-insensitive `username` and normalized unique `phone` |
| `POST` | `/api/auth/change-password/` | `{ old_password, new_password }` | `{ detail: string }` | Authenticated | Validates old password |
| `GET` | `/api/users/lookup/?identifier=` | None | `{ id, name, username, masked_phone, role }` | Authenticated (`20/min`) | Exact active user lookup (`404` else) |
| `GET` | `/api/users/` | None | `UserProfile[]` | Authenticated | Admin sees all users; other roles see only themselves |
| `GET` | `/api/users/<id>/` | None | `UserProfile` | Admin / Self | Retrieve user details |
| `PATCH` | `/api/users/<id>/` | Partial `UserProfile` | `UserProfile` | Admin / Self | Admin can update role |
| `DELETE` | `/api/users/<id>/` | None | 204 No Content | Admin only | Removes user |

## 2. Society Management (`/api/society/`)

| Method | Path | Request Body | Response Shape | Allowed Roles | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/society/` | `?search=` | `Society[]` | Authenticated | Search by `name`, `city`, `registration_number` |
| `POST` | `/api/society/` | `Society` payload | `Society` | Admin only | Register complex |
| `GET` | `/api/society/<id>/` | None | `Society` | Authenticated | |
| `PATCH` | `/api/society/<id>/` | Partial `Society` | `Society` | Admin only | |
| `DELETE` | `/api/society/<id>/` | None | 204 No Content | Admin only | Soft-delete (`is_active=False`) |
| `GET` | `/api/society/<society_id>/blocks/` | None | `Block[]` | Authenticated | Blocks under society |
| `POST` | `/api/society/<society_id>/blocks/` | `{ name, total_floors, description? }` | `Block` | Admin only | |
| `GET` | `/api/society/blocks/<id>/` | None | `Block` | Authenticated | Direct block access |
| `PATCH` | `/api/society/blocks/<id>/` | Partial `Block` | `Block` | Admin only | |
| `DELETE` | `/api/society/blocks/<id>/` | None | 204 No Content | Admin only | |
| `GET` | `/api/society/blocks/<block_id>/flats/` | None | `Flat[]` | Authenticated | Flats under block |
| `POST` | `/api/society/blocks/<block_id>/flats/` | `{ flat_number, floor, area_sqft? }` | `Flat` | Admin only | |
| `GET` | `/api/society/flats/<id>/` | None | `Flat` | Authenticated | Direct flat access |
| `PATCH` | `/api/society/flats/<id>/` | Partial `Flat` | `Flat` | Admin only | |
| `DELETE` | `/api/society/flats/<id>/` | None | 204 No Content | Admin only | |
| `GET` | `/api/society/mappings/` | None | `ResidentFlatMapping[]` | Authenticated | Admin sees all; resident sees own |
| `POST` | `/api/society/mappings/` | `{ user, flat, occupancy_type, is_primary_resident, ... }` | `ResidentFlatMapping` | Admin only | Maps resident to flat |
| `GET` | `/api/society/mappings/<id>/` | None | `ResidentFlatMapping` | Authenticated | |
| `PATCH` | `/api/society/mappings/<id>/` | Partial `ResidentFlatMapping` | `ResidentFlatMapping` | Admin only | Syncs `flat.is_occupied` |
| `DELETE` | `/api/society/mappings/<id>/` | None | 204 No Content | Admin only | Sets `flat.is_occupied=False` if empty |

## 3. Emergency Contacts & Guardian Requests (`/api/contacts/`, `/api/guardian/`)

| Method | Path | Request Body | Response Shape | Allowed Roles | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/contacts/` | None | `EmergencyContact[]` | Authenticated | Active contacts (excludes cancelled unless `?status=all`) |
| `POST` | `/api/contacts/` | `{ identifier?, name?, phone?, contact_type, relationship, priority? }` | `EmergencyContact` | Resident | Guardian roles require registered guardian `identifier`; starts `pending` & alerts guardian |
| `GET` | `/api/contacts/<id>/` | None | `EmergencyContact` | Resident / Admin | |
| `PATCH` | `/api/contacts/<id>/` | `{ relationship?, priority? }` (or `name`/`phone` if unlinked) | `EmergencyContact` | Resident / Admin | Linked guardian identity stays synced |
| `DELETE` | `/api/contacts/<id>/` | None | 204 No Content | Resident / Admin | Soft delete (`is_active=False`), frees slot |
| `POST` | `/api/contacts/<id>/cancel/` | None | `EmergencyContact` | Resident | Cancels `pending` guardian request |
| `POST` | `/api/contacts/<id>/resend/` | None | `EmergencyContact` | Resident | Re-notifies `pending` (cooldown) or recreates from `declined` (`201`) |
| `POST` | `/api/contacts/<id>/verify/` | `{ token }` | `{ detail }` | Authenticated | Retired (`410 Gone`) |
| `GET` | `/api/guardian/requests/?status=` | None | `GuardianIncomingRequest[]` | Guardian | Incoming invitations (`pending` default) |
| `POST` | `/api/guardian/requests/<id>/accept/` | None | `GuardianIncomingRequest` | Addressed Guardian (`404` else) | Sets `accepted` & `is_verified=True`, notifies resident |
| `POST` | `/api/guardian/requests/<id>/decline/` | None | `GuardianIncomingRequest` | Addressed Guardian (`404` else) | Sets `declined`, notifies resident |
| `GET` | `/api/guardian/dependents/` | None | `GuardianDependent[]` | Guardian | Accepted dependents with active incident state |

## 4. Incidents & SOS (`/api/incidents/`)

| Method | Path | Request Body | Response Shape | Allowed Roles | Notes |
|---|---|---|---|---|---|
| `POST` | `/api/incidents/sos/` | `{ emergency_type, description?, latitude?, longitude?, location_captured_at?, location_accuracy? }` | `{ id, status, created_at, location_available }` | Resident only | Creates incident and dispatches alerts |
| `GET` | `/api/resident/incidents/` | None | `Incident[]` | Authenticated (Resident) | Resident's own incident history |
| `GET` | `/api/incidents/` | `?status=&emergency_type=` | `Incident[]` | Authenticated | Role filtered via `incidents_for_user`: Guardian sees verified dependents; Security sees assigned society; Volunteer sees active society alerts; Admin sees administered society |
| `GET` | `/api/incidents/<id>/` | None | `Incident` | Authenticated (authorized) | 404 if not authorized |
| `GET` | `/api/incidents/<id>/status/` | None | `{ id, status, updated_at, resolved_at }` | Authenticated (authorized) | Lightweight polling endpoint |

## 5. Notifications (`/api/notifications/`)

| Method | Path | Request Body | Response Shape | Allowed Roles | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/notifications/` | `?is_read=&channel=&delivery_status=` | `Notification[]` | Authenticated | In-app/SMS/Push notifications sent to `request.user` |
| `GET` | `/api/notifications/<id>/` | None | `Notification` | Recipient only | |
| `PATCH` | `/api/notifications/<id>/read/` | None | `Notification` | Recipient only | Marks in-app notification as read |
| `GET` | `/api/incidents/<id>/notifications/` | `?delivery_status=&channel=&recipient_type=` | `NotificationRecord[]` | Security, Admin, Resident | Delivery audit trail for incident |
| `POST` | `/api/incidents/<id>/notifications/retry/` | None | `{ retried, skipped_max_attempts, skipped_cooldown }` | Security, Admin | Retries failed notification channels |

