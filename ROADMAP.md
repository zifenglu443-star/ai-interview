# Roadmap

## Current MVP

- Student-focused setup and waiting room.
- Director-controlled interview lifecycle.
- Gemini Live and OpenAI Realtime voice choices.
- Two-person meeting layout, typed notes, status signals, and whiteboard.
- Deterministic report and development telemetry.
- Local reasoning-depth practice indicator with an explicit non-semantic disclaimer.
- Atomic local report archives and user-controlled report deletion.

## Current priority

Validate immersion and reliability with repeatable student interviews. Fix
session lifecycle, latency, voice, and interaction problems before adding more
roles or integrations.

## Next

- Replace the deterministic score heuristic with a versioned semantic rubric
  for independent completion, reasoning depth, correctness, and communication.
- Add semantic-evaluator model and evidence provenance; the local heuristic rubric is now versioned.
- Complete hands-free Director progression for the OpenAI Realtime option; the
  current OpenAI path uses typed notes to advance questions.
- Resolve production licenses and provenance for the whiteboard SDK and
  interviewer media before any external release.
- Add replay once event and transcript synchronization is stable.

## Later

- Authentication and persistent storage.
- More interview categories and interviewer personas.
- Deployment, billing, and team features.
