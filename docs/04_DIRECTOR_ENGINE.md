# Director Engine

Controls lifecycle, pacing, challenge thresholds, pressure, follow-up,
interviewer attitude, and validated whiteboard actions.

## Locked session configuration

The candidate configures the Director before starting:

- interviewer style sets the baseline attitude (`supportive`, `professional`,
  or `firm`) and the live model's delivery profile: warm/curious, neutral/direct,
  or terse/evidence-demanding;
- initial pressure sets the session's baseline pressure and the live model's
  thinking-pause tolerance, pacing, and probing intensity;
- expected reasoning depth changes whole-question completion semantics: low
  requires an independent answer to every requested part, medium requires a
  coherent chain across key steps, and high additionally requires why those
  steps work through relevant principles, conditions, tradeoffs, or validation;
- interruption frequency changes the confidence required to approve a live-model
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
- `POST /interview/answer` is a guarded legacy endpoint and rejects unreviewed
  typed progression. The browser sends typed backup input through the connected
  live provider for semantic review, or stores it as transcript-only notes.
- `POST /interview/end` moves any active session to `ended`.
- The frontend shows Start only without a session and End for an unfinished session.

## Live-provider control proposals

Either live provider calls the hidden `report_interviewer_state` tool after a
completed candidate turn. The model proposes an `answer_status`, emotion,
gesture, decision, reason, and confidence score. It does not own the resulting
action.

`DirectorEngine.review_live_signal` validates the proposal:

- confidence below 0.65 is rejected;
- interruption confidence thresholds are 0.95 for low, 0.85 for medium, and
  0.75 for high interruption frequency, then receive bounded style/pressure
  adjustments; weaker proposals become challenges;
- challenge proposals also use a bounded style/pressure threshold: friendly/low
  profiles require stronger evidence, while strict/high profiles challenge
  unsupported claims earlier;
- `move_on` requires `answer_status=substantive` and a captured candidate
  answer. Semantic validity comes from the model's structured classification;
  the backend contains no phrase list;
- every live proposal scores completion against the entire original planned
  question and lists covered and missing requirements. `move_on` requires at
  least 90% completion and an empty missing-requirements list. The Director also
  caps the reported score to the covered/total requirement ratio, so covering
  one of two listed parts cannot score above 50%;
- `explain_current` is rejected unless the frontend's current-question timer has
  expired. It does not advance state. Only after the frontend observes the
  spoken explanation can `move_on_after_explanation` advance the question;
- follow-up proposals share a fixed safety cap; the locked light/standard/deep
  setting controls required reasoning depth rather than the number of prompts;
- once effective whole-question completion reaches 90%, at most one follow-up
  is allowed; a later redundant follow-up request is converted to `move_on`
  when the answer still satisfies status, coverage, and reasoning-depth checks;
- completed and ended sessions reject all proposals.

The tool response includes the real state, current question index, total plan
length, and next question. The interviewer uses those values for its spoken
progress update; it never invents progress.

## Asynchronous progress verification

The browser starts a text-model verification branch without awaiting it when
completion rises by at least 25 points, reaches 90%, a move is proposed, or a
near-transition assessment is multipart, inconsistent, semantically risky, or
lower-confidence. It uses the same configured planning-model endpoint, key, and
model. The Live provider and `/interview/live-control` continue immediately.

The verifier treats the transcript as untrusted data and returns only structured
coverage fields. Its input includes the immutable original planned question,
the active prompt, and the complete chronological interviewer/candidate dialogue
from the start of that original question. Director follow-ups remain in the same
segment; the browser resets the dialogue snapshot only when the original question
index advances. The verifier credits only candidate-supplied content, not hints or
explanations spoken by the interviewer. A result supports Live judgment when it finds at least 85%
substantive coverage with no critical gap, or confirms that the increase is
reasonable without a high-risk or critical-gap finding. Supporting results do
not take control from Live. A negative result is cached in the browser and sent
with the next live-control request. If it still applies to the same question,
the Director bounds that later score and missing requirements; if the interview
has already moved, it is delivered only as future calibration. The branch never
waits, rewinds a question, or interrupts the current exchange.

The verifier snapshot is not the post-interview record. On completion, the
Director stores candidate-only summaries against immutable original planned
questions for feedback scoring. Separately, `conversation.json` schema version
2 stores the browser's chronological interviewer/candidate turns. The report
labels these as different sections and never presents a final follow-up plus a
merged answer summary as though they were one spoken exchange.

Whiteboard proposals are separately filtered after the general live-control
review. Coordinates and sizes must be normalized to the current board image,
only one text annotation is allowed per proposal, and malformed or context-free
actions are dropped.

Substantive typed answers, completion-approved voice `move_on`, and explanation-verified
`move_on_after_explanation` are the only question-advance paths. Explicit end
terminates without inventing unanswered progress.
