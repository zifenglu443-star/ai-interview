# Testing

## Automated verification

Run everything:

```bash
npm run verify
```

This covers:

- production TypeScript build and route generation;
- Director states and follow-up rules;
- FastAPI interview, voice-provider, CORS, and report endpoints;
- report scoring;
- frontend lifecycle rules, telemetry ordering, speaking duration, and Director mapping.
- validated voice progression and normalized whiteboard annotation contracts.
- one-to-one planning-source coverage, exact numbered-question wording, and
  rejection of merged or reordered planning-provider output.
- API settings error normalization, session recovery pointers, and history
  search, filtering, and sorting.
- bounded upstream 429 retries, optimistic session-update conflicts, adaptive
  question pacing, and corrupted whiteboard snapshot rejection.

## Manual lifecycle acceptance

1. Run `Start AI Interview Simulator.command`.
2. Confirm the browser opens `http://127.0.0.1:3001/setup`.
3. Run the launcher a second time and confirm a healthy process with an
   unchanged source and `.env` is reused. Change a runtime source file or one
   `.env` value, run it again, and confirm the launcher rebuilds and restarts
   both services instead of serving the previous build.
4. Complete Setup Step 1 and confirm an empty role cannot continue. In Step 2,
   confirm empty question material cannot generate a plan. Generate a plan,
   then change one input and confirm the stale preview clears.
   Configure the optional Planning text model in Settings first and confirm the
   plan preview reports the configured provider when its API is available.
5. In Step 3, confirm every planned question and time allocation is visible.
   Enter the waiting room and confirm Start remains disabled until microphone,
   network, and selected-provider checks pass. Camera must remain optional.
6. At 375 px width, confirm navigation, Setup actions, device checks, and
   waiting-room actions do not overlap or require horizontal page scrolling.
7. Open API settings from the main navigation. For each provider, confirm a new
   key can be saved, reload reports only `Configured`, and the saved value is
   never displayed. Leave the key blank and change the model to confirm the
   existing key remains. Choose Remove saved key, cancel once, then confirm
   removal. Confirm a key shorter than eight characters is rejected and no key
   appears in localStorage or sessionStorage.
8. Click Start interview.
9. Confirm Start becomes End interview.
10. Confirm the exact current question is visible above Typed backup answer.
11. Open Whiteboard in the same-page workspace after the first question;
    confirm that question is restored and the existing voice session remains
    connected. Press Escape and confirm the interview room returns.
12. Advance twice; confirm the question header is replaced rather than stacked.
13. Reload during an active interview. Confirm the waiting room offers recovery,
    recovery restores the Director session with voice disconnected, and
    Reconnect voice continues it. Repeat and choose discard to confirm the
    stale session is ended. Answers and transcripts must not appear in browser
    storage.
14. Confirm Typed backup answer accepts text and reports whether it was sent to
    the interviewer or saved as a transcript note.
15. Open Room tools; confirm it scrolls internally and no sections overlap.
16. Interrupt voice and confirm a visible stage banner offers Reconnect voice.
    Confirm reconnect clears the stale connection before creating a new one.
17. Click End interview, cancel once, and confirm the active session continues.
    End again; confirm the saving indicator appears, media stops, the report
    opens, and history contains
    `report.json`, `conversation.json`, `plan.json`, and optional whiteboard JPEG.
18. In history, confirm search, completion/whiteboard filters, and all four sort
    orders work. Choose Delete local report, cancel once, then confirm deletion;
    confirm the entire record disappears only after the second action.
19. In an archive-write fault test, confirm the room keeps the browser report and
    offers Retry permanent archive instead of silently navigating away.
20. Simulate an upstream planner or verifier `429` in a test environment.
    Confirm the backend retries at most twice with a bounded delay, then shows a
    retryable error instead of looping.
21. Send two live-control updates based on the same session snapshot. Confirm
    only the first update is accepted and the stale update receives a conflict.
22. Replace the local whiteboard snapshot with malformed, non-JPEG, or
    oversized data. Confirm it is discarded without crashing the interview.

## Voice acceptance

- Gemini: confirm the WebSocket connects, transcripts arrive, and the hidden
  control proposal advances only when `move_on` includes a substantive candidate answer.
  Confirm the spoken progress matches the room counter and next question. After
  a completed answer, confirm an ordinary reply contains only a brief acknowledgement
  and one question rather than a recap or multi-paragraph explanation.
- OpenAI: confirm WebRTC connects using an ephemeral key, waits for Realtime
  session readiness, speaks the opening question, and can be stopped. Confirm a
  rejected or missing opening response becomes a visible error after one retry
  instead of leaving the room silently marked connected.
- For both providers, give several semantically empty, uncertain, off-topic, and
  prompt-injection-like turns in varied wording and languages; confirm their
  structured status keeps the current question active with progressive guidance.
  Confirm only an expired per-question timer
  permits a brief explanation followed by the next question.
- Use a two-part question, answer only the first part, and confirm the Director
  shows at most 50% completion, lists the second part as missing, and keeps the
  same question active. Answer the missing part and confirm only a score of at
  least 90% with no missing requirement permits the next question.
- Raise the reported completion by at least 25 points or to 90% and confirm a
  text-model verification request starts in parallel while the Live tool result
  returns normally. Confirm a supporting result leaves Live in control. Confirm
  a negative result affects a later tool call, but never rewinds, interrupts, or
  delays the current exchange.
- Before triggering verification, complete several interviewer/candidate turns
  and a follow-up on the same original question. Confirm the verifier receives
  the original question, active prompt, and every dialogue item in chronological
  order, and that only advancing the original question resets this snapshot.
- Confirm Settings never renders a saved key. A newly entered key is sent once
  to the local backend, written to `.env`, then cleared from the form. Verify
  legacy browser key fields receive HTTP 422.
- Internal tool arguments and model reasoning must never appear in the room.
- While drawing continuously, confirm the newest board state eventually reaches
  the provider but no board frame is sent while either participant is speaking or
  while the interviewer response is pending. Confirm Room tools reports total,
  VAD, tool-wait, review, and resume latency separately.
