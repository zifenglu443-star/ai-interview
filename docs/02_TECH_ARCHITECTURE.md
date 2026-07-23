# Technical Architecture

## Runtime

```text
Browser (Next.js, 127.0.0.1:3001)
  ├─ Setup / plan preview / waiting room / interview / reports
  ├─ Camera, WebRTC, AudioWorklet, tldraw, local storage
  └─ Gemini Live audio client or OpenAI Realtime WebRTC
                  │
                  ▼
FastAPI (127.0.0.1:8000)
  ├─ Required planning-provider adapter
  ├─ Director session endpoints
  ├─ Gemini WebSocket proxy
  ├─ OpenAI ephemeral client-secret creation
  └─ Deterministic report evaluation
                  │
                  ▼
Director Engine (pure Python state machine)
```

## Ownership

- `PracticePlan` owns pre-session role, focus, topic, voice provider, and
  editable Director settings. It never contains provider credentials.
- `DirectorSession` owns Start/End state, current question, answers, pressure,
  approved control signals, and an immutable copy of `DirectorConfig`.
- Voice providers generate conversation but cannot directly mutate or end the Director.
- Either live provider may propose a transition, but the backend validates it.
  `move_on` requires `answer_status=substantive` and a captured answer. The live
  provider classifies meaning without backend phrase matching and scores the entire
  original question from 0–100 and enumerate covered and missing requirements;
  the backend requires at least 90% with nothing missing before `move_on`, and
  bounds inconsistent scores by the reported coverage ratio. Only the frontend's elapsed question
  timer can authorize `explain_current`; a separate transition remains blocked
  until the frontend has observed the spoken explanation transcript.
- The frontend owns media devices and rendering; camera video stays local.
- Conversation data has three deliberately separate consumers: hidden progress
  verification receives a temporary current-question dialogue snapshot;
  post-interview evaluation receives one candidate-only summary keyed to each
  immutable original planned question; and conversation history archives the
  chronological interviewer/candidate turns for display. None is reconstructed
  from either of the other two.
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
| `GET /configuration/status` | Return provider readiness and model names, never secrets |
| `POST /configuration/provider` | Local-origin-only write to `.env`; accepts masked secret input and never returns it |
| `POST /interview/plan` | Required provider-backed plan creation |
| `POST /interview/start` | Create and lock one Director session |
| `GET /interview/session/{session_id}` | Restore an unexpired Director session from a short-lived browser pointer |
| `POST /interview/answer` | Guarded legacy route; reject typed progression that has not received live semantic review |
| `POST /interview/live-control` | Review a provider control/whiteboard proposal and time-gated transition |
| `POST /interview/verify-progress` | Asynchronously verify risky completion changes with the existing text model; never block Live |
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
Progress verification reuses the planning adapter configuration as a parallel,
non-authoritative branch. Only a negative result is carried into a later
live-control call, where it can calibrate future coverage checks without
reversing an already-spoken transition.

## Supported voice providers

- Google Gemini Live: audio through the FastAPI WebSocket proxy, Director tool
  proposals, voice-answer capture, true progress, reviewed whiteboard actions,
  interruption-aware playback, context compression, and resumable connections.
- OpenAI Realtime: browser WebRTC with a short-lived backend-created secret;
  audio transcription and `report_interviewer_state` function calls feed the
  same Director approval endpoint used by Gemini before question state, avatar
  signals, or whiteboard annotations are changed. Whiteboard JPEG frames are sent
  as `input_image` conversation items, and auto-eagerness semantic VAD balances
  natural thinking pauses against response latency. The browser waits for the
  provider's `session.created` event before sending the opening question, then
  requires `response.created` as proof that generation started. A missing opening
  response is retried once, and provider error events are shown in the room rather
  than leaving a false connected-but-silent state.

Both providers receive the same generated interviewer system instruction so
interview policy, tool secrecy, gestures, and whiteboard limits do not drift.
Ordinary spoken turns are capped at one short acknowledgement and one question;
recaps, stacked follow-ups, and unsolicited mini-lectures are forbidden.
That shared instruction requires completion scoring against every explicit
subpart of the original planned question rather than only the latest follow-up.
The locked interviewer style and initial pressure are compiled into this system
instruction for both providers. They may change tone, pacing, thinking-pause
tolerance, and probing intensity, but are explicitly forbidden from changing
the locked question plan or current topic.
They also share one frontend start/stop orchestration path for camera and
microphone permissions, audio-context activation, the opening-question prompt,
and Director lifecycle. Only the wire adapter differs: WebRTC for OpenAI and the
local WebSocket proxy for Gemini.

Provider keys, models, and the planning endpoint are backend configuration read
from `.env`. The API settings form may submit a new key only to the local backend
from an allowlisted local Origin; the backend writes it with owner-only file
permissions and returns readiness, never the secret. The browser never persists
or refills a provider key. The planning endpoint is validated as HTTPS before
it is written or used.

An active interview stores only its opaque session ID and timestamp in
`sessionStorage`. After a frontend refresh, the backend can return the unexpired
Director session and the user may explicitly resume it. Answers, transcripts,
and provider credentials are not copied into this recovery pointer. A backend
restart still invalidates active sessions.

## Whiteboard synchronization

The interview page and tldraw page communicate through `BroadcastChannel`.
The current question is additionally persisted in localStorage so opening the
board after question start does not lose it. AI annotations use 0..1 coordinates
relative to the exported JPEG; the board maps them back into current page bounds.
The backend validates action type, count, text length, coordinate range, and
whether the approved gesture/decision makes annotation appropriate.
Board exports are debounced, capped at 768 pixels, encoded as 65% JPEG, and
deduplicated. A 48×48 luminance fingerprint estimates the changed image area:
material changes may upload after 1.2 seconds, minor changes are coalesced but
forced by three seconds, and identical frames are skipped. Provider uploads retain
only the newest pending frame and pause while either participant is speaking or a
voice response is pending so image traffic does not compete with the audio path.

The Director console traces perceived turn-to-first-audio latency plus the
locally observable VAD silence, turn-to-tool, local review, and tool-to-audio
segments. OpenAI's provider-internal VAD delay is not separately observable;
Gemini's local 650ms silence detector is included in its total perceived latency.

## Storage

There is no active database. Browser local storage is used for the non-secret
practice plan, whiteboard persistence, and current report. On completion or manual end,
the backend archives each interview under `data/interview_records/` with its
report plus stable evaluation, conversation, plan, and final whiteboard JPEG
snapshot when available. Successfully archived sessions are removed from the
in-memory session registry. Archive files are first written into a temporary
sibling directory; one atomic directory rename publishes the complete record.
If writing fails, the temporary directory is removed and the finished session is
restored so the user can retry. A concurrent duplicate archive cannot publish a
second record. Every published archive is copied atomically to the hidden
`.backups/` directory. Missing or malformed primary JSON is restored from that
copy on read; explicit record deletion removes both copies.

## Runtime hardening

- CORS accepts only explicit HTTP(S) origins, does not allow credentials, and
  limits methods and headers to the local API contract.
- Request logs include method, path, status, duration, and client address but
  never request bodies or secrets.
- A bounded per-client request rate protects public deployments from bursts.
- Director sessions expire and the registry has a hard maximum, preventing
  abandoned sessions from growing memory without bound.
- Gemini reconnects with session resumption and capped exponential backoff while
  the interview remains active.

## Active interviewer video module

The active room uses `InterviewerAvatarVideo`, a still image, and small local
H.264 clips. `idle` renders only the still image; one-shot actions overlay it
briefly and then release their decoder. Speaking uses a short loop only while
the interviewer audio is active. There is no 3D model or WebGL renderer in the
runtime.
