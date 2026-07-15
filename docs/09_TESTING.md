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
  control proposal advances only when `move_on` includes a candidate answer.
  Confirm the spoken progress matches the room counter and next question.
- OpenAI: confirm WebRTC connects using an ephemeral key and can be stopped.
- Leave browser API keys blank and confirm `.env` fallback works. If a browser
  Gemini key is used, confirm it does not appear in the `/google/live` URL.
- Internal tool arguments and model reasoning must never appear in the room.
