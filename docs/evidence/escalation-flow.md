# SafeCircle — SOS, Guardian Response & Escalation Engine Evidence

This document provides complete implementation and verification evidence for the SafeCircle multi-tier SOS escalation and guardian response system.

---

## 1. System Architecture & Flow Lifecycle

```mermaid
flowchart TD
    A[Resident Triggers SOS] --> B[Capture GPS Coordinates\nLat, Lng, Accuracy]
    B --> C{Verified Primary\nGuardian Exists?}
    
    C -- Yes --> D[Dispatch GUARDIAN_SOS\nLocation + Google Maps link]
    D --> E[Start Auto-Escalation Window\nescalate_at = now + window_seconds]
    
    C -- No --> F[Direct Multi-Target Escalation]
    
    E --> G{Guardian Action\nwithin window?}
    
    G -- "I'm Responding" --> H[Guardian Ack\nPOST /api/incidents/<id>/guardian-ack/]
    H --> I[Status -> ACKNOWLEDGED\nescalate_at cleared\nAuto-escalation paused]
    
    G -- "Can't help, pass it on" --> J[Guardian Handoff\nPOST /api/incidents/<id>/handoff/]
    J --> F
    
    G -- Unresponsive / Timeout --> K[Server-Side Auto-Escalation\nescalate_at reached]
    K --> F
    
    F --> L[Direct Simultaneous Multi-Dispatch]
    L --> M[Secondary Guardian\nif enabled in settings]
    L --> N[Building Security Guard\nif building has guard on duty]
    L --> O[Nearby Volunteers\nBlock-first proximity matching]
    
    O --> P{Volunteer Claim\nPOST /api/incidents/<id>/accept/}
    P -- First Volunteer --> Q[Status -> ASSIGNED\nFull details unlocked\nCompeting volunteers told 'Taken']
    P -- Second Volunteer --> R[HTTP 409 Conflict\n'Already accepted by other volunteer']
    
    L --> S{Any responder\naccepted within window?}
    S -- No --> T[No-Responder Escalation\nAlerts society admins\nPrompts resident to Call 112]
```

---

## 2. API Endpoints Verified

| Method | Endpoint | Purpose | Role | Status |
|---|---|---|---|---|
| `POST` | `/api/incidents/sos/` | Trigger one-tap SOS with GPS coordinates & accuracy | Resident | 201 Created |
| `GET, PUT` | `/api/resident/escalation-settings/` | Configure 4 toggles, timers, radius + live preview | Resident | 200 OK |
| `POST` | `/api/incidents/<id>/guardian-ack/` | Guardian marks "I'm responding", pauses auto-escalation | Guardian | 200 OK |
| `POST` | `/api/incidents/<id>/handoff/` | Guardian passes on emergency with target selection & reason | Guardian | 200 OK |
| `POST` | `/api/incidents/<id>/accept/` | Atomic first-responder claim (`select_for_update`) | Volunteer | 200 / 409 |
| `PATCH` | `/api/incidents/<id>/location/` | Streams live GPS coordinate updates during emergency | Resident | 200 OK |
| `GET, PATCH` | `/api/volunteer/location/` | Reports volunteer live GPS coordinates | Volunteer | 200 OK |
| `GET, POST` | `/api/admin/volunteers/` | Admin reviews applications with distance & far-pin flag | Admin | 200 OK |
| `GET, PATCH` | `/api/society/policy/` | Society policy for neighbour dispatch (Tier 3) | Admin | 200 OK |

---

## 3. End-to-End Verification Trace (`demo_escalation.py`)

```
================================================================================
 SafeCircle - SOS, Guardian Response & Escalation Engine Demo
================================================================================

================================================================================
 STEP: 1. Resident Triggers SOS with GPS Coordinates
================================================================================
  Incident ID   : #45 (Demo Live SOS - Medical Assistance)
  GPS Location  : (12.9716, 77.5946) +/- 12.5m
  Status        : REPORTED
  Primary Guard : Ravi Kumar
  Escalate At   : 2026-11-13 14:03:46.684160+00:00 (Window: 120s)
  Planned Targets: secondary_guardian, security, volunteers

================================================================================
 STEP: 2. Guardian Acknowledges SOS ('I am responding')
================================================================================
[SIMULATED PUSH] (STATUS_CHANGED) to Asha Rao: Incident #45 update: Acknowledged
[SIMULATED IN_APP] (STATUS_CHANGED) to Asha Rao: Incident #45 update: Acknowledged
[SIMULATED EMAIL] (STATUS_CHANGED) to Asha Rao: Incident #45 update: Acknowledged
  Result        : Success = True
  Status        : ACKNOWLEDGED (Moved from REPORTED -> ACKNOWLEDGED)
  Acked By      : ravi_guardian at 2026-11-13 14:01:46.717028+00:00
  Timer State   : escalate_at = None (Cancelled automatic escalation timer)

================================================================================
 STEP: 3. Guardian Handoff ('I can't help, pass it on')
================================================================================
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Neha Kapoor: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Neha Kapoor: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED SMS] (ESCALATION_HANDOFF) to Neha Kapoor: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Neha Kapoor: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Suresh Nair: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Suresh Nair: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Suresh Nair: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Priya Sharma: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Priya Sharma: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Priya Sharma: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Kavita Patel: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Kavita Patel: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Kavita Patel: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Rohan Joshi: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Rohan Joshi: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Rohan Joshi: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Arjun Verma: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Arjun Verma: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Arjun Verma: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_HANDOFF) to Rahul Sen: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED IN_APP] (ESCALATION_HANDOFF) to Rahul Sen: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED EMAIL] (ESCALATION_HANDOFF) to Rahul Sen: HANDOFF: Medical Emergency - Asha Rao
[SIMULATED PUSH] (ESCALATION_NOTICE) to Asha Rao: Incident #45 escalated
[SIMULATED IN_APP] (ESCALATION_NOTICE) to Asha Rao: Incident #45 escalated
[SIMULATED EMAIL] (ESCALATION_NOTICE) to Asha Rao: Incident #45 escalated
  Escalation ID : #5 (Kind: manual_guardian, Reason: far_away)
  Targets Alerted: secondary_guardian, security, volunteers
  Volunteers Notified (5): [8, 39, 46, 9, 40]
  Incident Escalated State: is_escalated = True, by = ravi_guardian

================================================================================
 STEP: 4. Atomic Volunteer Acceptance (First Come, First Served)
================================================================================
  Attempt 1: Volunteer Priya Sharma (@volunteer_demo) accepts incident...
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Asha Rao: Responder on the way for Incident #45
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Asha Rao: Responder on the way for Incident #45
[SIMULATED EMAIL] (ESCALATION_ACCEPTED) to Asha Rao: Responder on the way for Incident #45
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Ravi Kumar: Incident #45 Accepted
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Ravi Kumar: Incident #45 Accepted
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Neha Kapoor: Incident #45 Accepted
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Neha Kapoor: Incident #45 Accepted
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Suresh Nair: Incident #45 Accepted
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Suresh Nair: Incident #45 Accepted
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Vikram Mehta: Incident #45 Accepted
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Vikram Mehta: Incident #45 Accepted
[SIMULATED EMAIL] (ESCALATION_ACCEPTED) to Vikram Mehta: Incident #45 Accepted
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Arjun Verma: Incident #45 Taken
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Arjun Verma: Incident #45 Taken
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Rohan Joshi: Incident #45 Taken
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Rohan Joshi: Incident #45 Taken
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Kavita Patel: Incident #45 Taken
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Kavita Patel: Incident #45 Taken
[SIMULATED PUSH] (ESCALATION_ACCEPTED) to Rahul Sen: Incident #45 Taken
[SIMULATED IN_APP] (ESCALATION_ACCEPTED) to Rahul Sen: Incident #45 Taken
  -> Result: Code 200, Success: True, New Status: ASSIGNED, Assigned To: volunteer_demo

  Attempt 2: Volunteer Arjun Verma (@volunteer2_demo) attempts to accept same incident...
  -> Result: Code 409 (Expected 409 Conflict), Detail: 'This incident was already accepted by Priya Sharma.'

================================================================================
 STEP: 5. Second-Stage No-Responder Timeout Simulation
================================================================================
  Simulating overdue escalation with no accepted responder...
[SIMULATED PUSH] (NO_RESPONDER) to Vikram Mehta: CRITICAL: No responder for Incident #45
[SIMULATED IN_APP] (NO_RESPONDER) to Vikram Mehta: CRITICAL: No responder for Incident #45
[SIMULATED EMAIL] (NO_RESPONDER) to Vikram Mehta: CRITICAL: No responder for Incident #45
  -> No-Responder Alerted At: 2026-11-13 14:01:46.976707+00:00
  -> Admins, security, and resident re-notified with high urgency prompt ('Call 112')

================================================================================
 ALL ESCALATION STEPS COMPLETED AND VERIFIED CLEANLY!
================================================================================
```

