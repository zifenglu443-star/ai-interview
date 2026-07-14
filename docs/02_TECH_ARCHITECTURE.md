# Technical Architecture

## Runtime

```text
Browser (Next.js, 127.0.0.1:3001)
  ├─ Setup / plan preview / waiting room / interview / reports
  ├─ Camera, WebRTC, tldraw, local storage
  └─ Gemini Live audio client or OpenAI Realtime WebRTC
                  │
                  ▼
FastAPI (127.0.0.1:8000)
  ├─ Planning-provider adapter with deterministic fallback
  ├─ Director session endpoints
  ├─ Gemini WebSocket proxy
  ├─ OpenAI ephemeral client-secret creation
  └─ Deterministic report evaluation
                  │
                  ▼
Director Engine (pure Python state machine)
```

## Ownership

- `PracticePlan` owns pre-session role, focus, topic, voice provider, and the
  editable Director settings.
- `DirectorSession` owns Start/End state, current question, answers, pressure,
  approved control signals, and an immutable copy of `DirectorConfig`.
- Voice providers generate conversation but cannot directly mutate or end the Director.
- Gemini Live may propose `move_on`, but the backend validates the proposal,
  requires a captured candidate answer, and performs the actual transition.
- The frontend owns media devices and rendering; camera video stays local.
- The in-browser event logger feeds the visual Director console in both local
  production and development builds; it stores events in memory only.

## Director configuration flow

```text
Setup editor → PracticePlan/localStorage → POST /interview/plan → plan preview
             → waiting room → POST /interview/start
             → Python DirectorConfig → DirectorSession → read-only dashboard
```

The frontend never changes an active session's profile. `POST /interview/start`
returns a session ID; later lifecycle requests send only that ID, and the backend
uses its in-memory session as the source of truth. An active interview therefore
cannot survive a backend restart.

## Local API surface

| Route | Responsibility |
|---|---|
| `GET /health` | Launcher readiness check |
| `POST /interview/plan` | Provider-backed or deterministic plan creation |
| `POST /interview/start` | Create and lock one Director session |
| `POST /interview/answer` | Record typed fallback input and advance |
| `POST /interview/live-control` | Review a Gemini control/whiteboard proposal |
| `POST /interview/end` | Manually terminate an active session |
| `POST /interview/archive` | Persist the finished report, conversation, plan, and board |
| `GET /interview/records...` | List and read local interview history |
| `DELETE /interview/records/{record_id}` | Delete one complete local archive |
| `GET /voice/providers` | Report configured voice-provider readiness |
| `POST /realtime/client-secret` | Create an OpenAI Realtime short-lived secret |
| `WS /google/live` | Proxy Gemini Live audio and tool traffic |
| `POST /report/evaluate` | Run deterministic local scoring |

The former standalone text-generation route is intentionally absent: planning
has one adapter and live interviewing has one route per supported voice protocol.

## Supported voice providers

- Google Gemini Live: audio through the FastAPI WebSocket proxy, Director tool
  proposals, voice-answer capture, true progress, and reviewed whiteboard actions.
- OpenAI Realtime: browser WebRTC with a short-lived backend-created secret;
  typed notes currently advance the deterministic question state.

The browser sends a Gemini key in the first WebSocket message, not in the URL.
The proxy then creates the upstream provider socket. This keeps the key out of
local access-log URLs. Browser-stored keys still carry normal localStorage/XSS risk.

## Whiteboard synchronization

The interview page and tldraw page communicate through `BroadcastChannel`.
The current question is additionally persisted in localStorage so opening the
board after question start does not lose it. AI annotations use 0..1 coordinates
relative to the exported JPEG; the board maps them back into current page bounds.
The backend validates action type, count, text length, coordinate range, and
whether the approved gesture/decision makes annotation appropriate.

## Storage

There is no active database. Browser local storage is used for the practice
plan, whiteboard persistence, and current report. On completion or manual end,
the backend archives each interview under `data/interview_records/` with its
report plus stable evaluation, conversation, plan, and final whiteboard JPEG
snapshot when available. Successfully archived sessions are removed from the
in-memory session registry. Archive files are first written into a temporary
sibling directory; one atomic directory rename publishes the complete record.
If writing fails, the temporary directory is removed and the finished session is
restored so the user can retry. A concurrent duplicate archive cannot publish a
second record.

## Active interviewer video module

The active room uses `InterviewerAvatarVideo`, a still image, and small local
H.264 clips. `idle` renders only the still image; one-shot actions overlay it
briefly and then release their decoder. Speaking uses a short loop only while
the interviewer audio is active. There is no 3D model or WebGL renderer in the
runtime.
