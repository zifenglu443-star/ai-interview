# Director Engine

Controls lifecycle, pacing, challenge thresholds, pressure, follow-up,
interviewer attitude, and validated whiteboard actions.

## Locked session configuration

The candidate configures the Director before starting:

- interviewer style sets the baseline attitude (`supportive`, `professional`,
  or `firm`);
- initial pressure sets the session's baseline pressure;
- follow-up depth changes how readily a concise answer is probed;
- challenge frequency changes the confidence required to approve a live-model
  interruption. It does not generate random frontend notifications.

`POST /interview/start` copies these values into `DirectorSession`. They remain
unchanged through follow-ups, question advances, completion, and manual end.
The visual dashboard is observation-only during the interview.

## Lifecycle

```text
ready → asking ↔ follow_up → completed
             └────────────→ ended
```

- `POST /interview/start` creates a session in `asking`.
- `POST /interview/answer` records typed fallback input and advances or follows up.
- `POST /interview/end` moves any active session to `ended`.
- The frontend shows Start only without a session and End for an unfinished session.

## Gemini Live control proposals

Gemini Live may call the hidden `report_interviewer_state` tool after a
meaningful candidate turn. The model proposes an emotion, gesture, decision,
reason, and confidence score. It does not own the resulting action.

`DirectorEngine.review_live_signal` validates the proposal:

- confidence below 0.65 is rejected;
- interruption confidence thresholds are 0.95 for low, 0.85 for medium, and
  0.75 for high interruption frequency; weaker proposals become challenges;
- `move_on` requires a captured candidate answer. When approved, the Director
  records a voice answer and advances exactly one planned question;
- completed and ended sessions reject all proposals.

The tool response includes the real state, current question index, total plan
length, and next question. The interviewer uses those values for its spoken
progress update; it never invents progress.

Whiteboard proposals are separately filtered after the general live-control
review. Coordinates and sizes must be normalized to the current board image,
only one text annotation is allowed per proposal, and malformed or context-free
actions are dropped.

Typed answer submission and approved voice `move_on` are the only question
advance paths. Explicit end terminates without inventing unanswered progress.
