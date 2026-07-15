# AI Interview Simulator

An immersive local mock-interview app for students. The product is a meeting
experience, not a chatbot: the Python Director owns the interview lifecycle,
voice models perform the conversation, and the frontend renders the room.

## One supported local workflow

Double-click [Start AI Interview Simulator.command](<./Start AI Interview Simulator.command>).

The launcher always:

1. reuses an already healthy local frontend/backend pair when it matches the
   current Git revision, so opening the app again does not destroy an active
   in-memory interview;
2. otherwise stops partial or stale services on ports `3001` and `8000`;
3. starts FastAPI with the project `.venv`;
4. creates a fresh production frontend build;
5. starts Next.js on `http://127.0.0.1:3001`;
6. opens `http://127.0.0.1:3001/setup` only after both services respond.

After a committed app update, the next launcher run deliberately rebuilds and
restarts the frontend so the browser cannot keep serving an older interface.

Runtime logs are written to `.runtime-logs/` and are ignored by Git.

## First-time setup

```bash
cp .env.example .env
npm --prefix frontend install
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

Add at least one voice key to `.env`: `GOOGLE_API_KEY` or `OPENAI_API_KEY`.
Use `frontend/package-lock.json` when installing frontend dependencies; the root
package provides repository-wide scripts and workspace routing.

## Manual development

Use two terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Both development and production use the same addresses:

- Frontend: `http://127.0.0.1:3001`
- Backend: `http://127.0.0.1:8000`
- Backend health: `http://127.0.0.1:8000/health`

## Product flow

```text
Setup + plan preview → Waiting room → Interview + whiteboard → Report → History
```

- Setup chooses role, focus, reference duration, voice model, and Director profile.
- Settings also contains a provider-neutral Planning text model section. Its
  browser-stored HTTPS endpoint, API key, and model override the corresponding
  `.env` planner values for plan-generation requests only.
- The planning provider builds a difficulty-weighted question plan. Editing role,
  focus, topics, uploaded questions, or duration invalidates the old preview.
- When input contains `1.`, `2.`, `3.` and so on, each numbered item is one
  question: wrapped prose and formula lines remain attached to that item. This
  rule is used by both the planning provider and the offline fallback.
- The selected model and Director profile are locked for the session and only
  displayed in the room.
- Start creates a Director session; the button then becomes End interview.
- The current question is visible in the room and is also placed at the top of
  the shared whiteboard. Opening the board late still restores the current question.
- Answer notes is a private scratchpad and typed-answer fallback. It is editable
  during the session; submitting it advances the Director.
- Gemini Live can propose a bounded follow-up or `move_on`. The backend Director
  validates the proposal, records the voice answer, advances the real question
  index, and returns the actual progress to the interviewer.
- Whiteboard annotations use normalized image coordinates and are accepted only
  after backend validation. Candidate content is never deleted automatically,
  and Setup can disable automatic AI annotations without hiding the question.
- End stops camera and voice, stores the local report, and enables View report.
  If permanent archive writing fails, the ended room keeps a retry action while
  the browser copy remains available.
- Every completed or manually ended interview is also archived in
  `data/interview_records/`. Each archive contains the report, the submitted
  answers and voice transcript, stable evaluation, `plan.json`, and a
  `whiteboard.jpg` snapshot when a shared whiteboard is available.
- After an interview is archived, the app opens its feedback page automatically.
  The home page links to all saved reports, and each report can be exported via
  the browser's Save as PDF flow. History also supports an explicit two-step
  deletion of the complete local record.

## Repository map

- `frontend/`: Next.js interface, state-driven interviewer video, voice clients,
  whiteboard, and bounded telemetry.
- `backend/`: FastAPI endpoints and protected provider integrations.
- `director/`: deterministic interview lifecycle and control validation.
- `reporting/`: deterministic report scoring.
- `tests/`: backend, Director, reporting, and telemetry tests.
- `docs/`: current product, architecture, UX, testing, and interviewer plans.

There is no database or authentication in the current local product. Session
setup, browser-entered API keys, whiteboard state, and the latest report are
local-browser data; the active Director session is held in backend memory and
ends if the backend restarts. Completed interviews are additionally written to
`data/interview_records/`. Keep both services bound to `127.0.0.1`; this build
is not approved for public deployment.

## Verification

```bash
npm run verify
```

See [docs/09_TESTING.md](docs/09_TESTING.md) for manual acceptance checks.
