# Community Emergency Response & Assistance Network

A Django REST Framework backend for a community emergency response platform. Residents in societies and apartment complexes can trigger an SOS, and the system notifies their guardians, security personnel, volunteers and neighbours, then tracks the incident until it is resolved.

The backend powers a web administration portal and a mobile app.

## Progress

| Milestone | Weeks | Status |
|---|---|---|
| 1. Resident, Society & Emergency Contact Management | 1-2 | Completed |
| 2. SOS Alert & Emergency Notification Management | 3-4 | Completed |
| 3. Community Response & Guardian Escalation | 5-6 | Upcoming |
| 4. Mobile Application, Testing & Deployment | 7-8 | Upcoming |

## Tech Stack

- Python, Django, Django REST Framework
- JWT authentication (`djangorestframework-simplejwt`)
- `django-filter` for API filtering
- `django-cors-headers` for frontend access
- SQLite for development

## Project Structure

```
backend/
  config/      project settings and root URLs
  users/       user accounts, roles and authentication
  society/     societies, blocks, flats and resident mapping
  contacts/    emergency contacts and guardians
  sos/         SOS alerts, notifications, routing and monitoring
  demo_sos.py  demo script for the SOS flow
  manage.py
  requirements.txt
```

## Getting Started

Run these inside the `backend` folder.

```
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

The API is available at `http://127.0.0.1:8000/api/`.

Create a `.env` file in `backend` if the project settings need one (ask the team for the values). The `.env` file is not stored in GitHub.

## Milestone 1: Resident, Society & Emergency Contact Management

- **Users and roles:** resident, guardian, volunteer, security and admin, with authentication and role-based access control
- **Society management:** societies, blocks / towers, flats and resident-to-flat mapping
- **Emergency contacts:** primary guardian, secondary guardian and other emergency contacts

See each app's `urls.py` for its endpoints. Society endpoints are under `/api/society/`.

## Milestone 2: SOS Alert & Emergency Notification System

App: `backend/sos`

### Features

- One-tap SOS with emergency category, message and location
- Alert routing to the primary guardian, security personnel, volunteers and community members
- Notification channels: push, SMS, email and in-app
- Alert monitoring: status tracking, delivery tracking and response updates

Push and SMS are simulated in development (printed to the console), and email uses Django's console backend. Real providers can be connected later.

### Alert routing

| Recipient | Channels |
|---|---|
| Primary guardian | Push, SMS, Email, In-App |
| Security personnel | Push, In-App |
| Volunteers | Push, In-App |
| Community (other residents in the same society) | In-App |

Every delivery attempt is saved with a `sent` or `failed` status.

### Alert lifecycle

Active -> Acknowledged -> Resolved. A resident can also cancel an alert while it is still active.

Response statuses: Acknowledged, On The Way, Arrived, Resolved.

### Who can do what

| Role | Access |
|---|---|
| Resident | Trigger SOS, view and cancel their own alerts |
| Guardian | View alerts from residents who linked them as a contact, and respond |
| Security | View all alerts, respond, resolve, view delivery reports |
| Volunteer | View active alerts and respond (cannot resolve) |
| Admin | View all alerts |

### API endpoints

All endpoints are under `/api/sos/` and require authentication.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/sos/` | Trigger an SOS (residents only) |
| GET | `/api/sos/` | List alerts you can see (filter by `status`, `category`) |
| GET | `/api/sos/<id>/` | Alert details |
| POST | `/api/sos/<id>/cancel/` | Cancel your own active alert |
| POST | `/api/sos/<id>/respond/` | Update the response status |
| GET | `/api/sos/<id>/responses/` | List responses to an alert |
| GET | `/api/sos/<id>/delivery/` | Notification delivery report |
| GET | `/api/sos/notifications/` | My in-app notifications (filter by `is_read`) |
| POST | `/api/sos/notifications/<id>/read/` | Mark a notification as read |

### Example: trigger an SOS

```
POST /api/sos/
{
  "category": "medical",
  "message": "Chest pain, please help",
  "latitude": "16.506200",
  "longitude": "80.648000",
  "location_text": "Flat 101, Block A"
}
```

## Testing

Run all tests:

```
python manage.py test users society contacts sos
```

The `sos` app has 13 automated tests covering SOS creation, role permissions, alert routing, responses, delivery tracking and the notification center.

Run the demo of the full SOS flow (resident triggers, security acknowledges and resolves, delivery report):

```
python demo_sos.py
```

## Notes for Frontend Developers

- CORS is enabled for development, so the frontend can call the API from another origin.
- All SOS endpoints need a JWT token in the `Authorization: Bearer <token>` header.
- Restrict CORS origins before deploying to production.

## Upcoming (Milestone 3)

- Guardian escalation workflow with a configurable response time window
- Volunteer availability, incident acceptance and responder assignment
- Emergency chat and incident discussion thread
- Full incident lifecycle and closure documentation
