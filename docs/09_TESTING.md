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

## Manual lifecycle acceptance

1. Run `Start AI Interview Simulator.command`.
2. Confirm the browser opens `http://127.0.0.1:3001/setup`.
3. Enter role/topics and duration, generate a plan, then change one input and
   confirm the stale preview clears.
   Configure the optional Planning text model in Settings first and confirm the
   plan preview reports the configured provider when its API is available.
4. Generate again, enter the waiting room, and click Start interview.
5. Confirm Start becomes End interview.
6. Confirm the exact current question is visible above Answer notes.
7. Open Whiteboard after the first question; confirm that question is restored.
8. Advance twice; confirm the question header is replaced rather than stacked.
9. Confirm Answer notes accepts typing and Submit advances the real counter.
10. Open Room tools; confirm it scrolls internally and no sections overlap.
11. End the interview; confirm media stops, report opens, and history contains
    `report.json`, `conversation.json`, `plan.json`, and optional whiteboard JPEG.
12. In history, choose Delete local report, cancel once, then confirm deletion;
    confirm the entire record disappears only after the second action.
13. In an archive-write fault test, confirm the room keeps the browser report and
    offers Retry permanent archive instead of silently navigating away.

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
- Leave browser API keys blank and confirm `.env` fallback works. If a browser
  Gemini key is used, confirm it does not appear in the `/google/live` URL.
- Internal tool arguments and model reasoning must never appear in the room.
- While drawing continuously, confirm the newest board state eventually reaches
  the provider but no board frame is sent while either participant is speaking or
  while the interviewer response is pending. Confirm Room tools reports total,
  VAD, tool-wait, review, and resume latency separately.
