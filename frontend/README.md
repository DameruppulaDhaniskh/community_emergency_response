# Community Emergency Response & Assistance Network (CERAN) – Frontend

Frontend web application for the gated society/apartment emergency response platform. Residents can trigger emergency SOS alerts which are routed to guardians, security staff, volunteers, and neighbours, with timed auto-escalation if unacknowledged.

---

## Tech Stack

- **Framework**: React 19 + TypeScript + Vite
- **Routing**: React Router 7 (role-based route guards)
- **Server State & Polling**: TanStack React Query (5–10s polling for live incident data)
- **Forms & Validation**: React Hook Form + Zod
- **Styling**: Tailwind CSS v4 with custom design-token layer (WCAG AA compliant warm palette)
- **Icons**: Lucide React
- **Charts**: Recharts
- **HTTP Client**: Axios with JWT authentication interceptors and token auto-refresh

---

## Role-Based Architecture

The application has a role-aware shell supporting 5 distinct roles:

1. **Resident** (Mobile-first):
   - One-tap 120px Emergency SOS button with 5-second accidental press countdown & cancel
   - Category selection (Medical, Fall, Fire, Security, Accident, Other)
   - Background GPS location capture
   - Visual escalation chain & emergency contacts management with verification flow
   - Personal incident history & notifications

2. **Guardian** (Mobile-first):
   - Real-time alerts for dependents
   - Incident timeline, responder updates, and notifications

3. **Volunteer** (Mobile-first):
   - Availability toggle
   - Incoming incident alert cards with 1-tap Accept / Decline
   - Incident discussion thread & assistance coordination

4. **Security Staff** (Desktop-first, responsive):
   - Live incident dashboard prioritized by urgency (Escalated → Open → Active → Resolved)
   - Incident status workflow (Begin Response → Escalate → Resolve)
   - Filter by status, category, and block

5. **Admin** (Desktop-first, responsive):
   - Society tree drill-down: Societies → Blocks / Towers → Flats
   - User directory with role management
   - Analytics & Reports (response times, categories, resolution & escalation rates) with plain-language summaries

---

## Getting Started

### 1. Environment Configuration

Create or verify `.env` in the `frontend` root:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Development Server

```bash
npm run dev
```

The frontend will start at `http://localhost:5173`.

### 4. Build for Production

```bash
npm run build
```

---

## Project Structure

```
frontend/
├── docs/
│   ├── BACKEND_MAP.md       # Complete mapping of Django REST backend endpoints & roles
│   └── BACKEND_GAPS.md      # Documented backend gaps and mock adapter specifications
├── src/
│   ├── api/
│   │   ├── client.ts        # Axios client with JWT interceptor & auto-refresh
│   │   ├── types.ts         # TypeScript interfaces matching Django models
│   │   ├── auth.ts          # Authentication endpoints
│   │   ├── society.ts       # Societies, blocks, flats API
│   │   ├── contacts.ts      # Emergency contacts API
│   │   ├── incidents.ts     # Incidents, SOS, discussion API
│   │   ├── notifications.ts # In-app and incident notification records API
│   │   ├── users.ts         # User management API
│   │   └── volunteers.ts    # Volunteer availability & response API
│   ├── components/          # Reusable design token primitives (Button, Input, StatusBadge, Modal, Toast, Skeleton, EmptyState)
│   ├── features/
│   │   ├── auth/            # Login, registration with role cards
│   │   ├── sos/             # SOS countdown flow and resident home
│   │   ├── incidents/       # Incident detail with timeline, discussion & notification delivery
│   │   ├── contacts/        # Numbered escalation chain & contact manager
│   │   ├── volunteers/      # Volunteer incoming incident cards & availability
│   │   ├── society/         # Society drill-down manager
│   │   ├── admin/           # User management
│   │   ├── reports/         # Recharts honest analytics & takeaways
│   │   ├── notifications/   # Notification center
│   │   └── profile/         # Profile & password updates
│   ├── routes/              # AppShell layout and role-based guards
│   ├── lib/                 # Formatters & date utils (relative time)
│   ├── index.css            # Tailwind CSS tokens & accessible palette
│   └── App.tsx              # Application router
```
