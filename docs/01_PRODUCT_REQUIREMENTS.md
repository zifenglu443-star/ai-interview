# Product Requirements

## Audience and promise

The MVP serves students preparing for interviews. Its promise is a realistic,
controlled interview session with useful feedback—not an open-ended AI chat.

## Required flow

1. Setup collects target role, practice focus, optional topics/question file,
   reference duration, voice model, and Director settings: interviewer style,
   initial pressure, expected reasoning depth, and interruption frequency.
   Settings separately stores the optional planning text-model endpoint, key,
   and model. Browser settings override local environment planner values only
   while generating a plan.
2. The planning provider allocates time by question difficulty and shows the
   exact plan before the waiting room. Relevant edits invalidate a stale plan.
3. Waiting room checks readiness before entering the room.
4. Start interview creates a Director session and changes to End interview.
5. The room keeps interviewer video, candidate camera, current question, notes,
   progress, and status visible.
6. End or natural completion stops media, atomically archives the session, and produces a report.

## Interview room contract

- Interviewer and candidate appear in equal video tiles.
- Answer notes is editable only during a created, unfinished session. It is a
  private scratchpad and typed-answer fallback; Submit advances the Director.
- Tool opens a separate vertically scrollable drawer. Tool content must not
  overlap notes or status panels.
- Tool includes a visual Director console showing the active state path,
  observe/interpret/decide/act flow, live metrics, and decision timeline.
- Director settings are editable only in Setup. Starting the interview locks a
  copy into the session; the room displays that profile but provides no editor.
- The voice model is chosen in Setup and cannot be changed mid-session.
- Session, reaction, and pressure signals are visible without exposing internal
  model tool calls or hidden reasoning.
- Turn boundaries belong to the live model/provider; the frontend audio meter is
  telemetry only and never truncates a candidate turn.
- Time is a flexible reference. At 80% of a question budget and at the budget
  boundary, pacing instructions ask the model to focus or close without giving
  away the answer.
- Progress is the Director session's real question index and plan length.
- Setup can disable automatic AI whiteboard annotations. The current question
  remains visible on the board regardless of that preference.

## Current storage

Practice plan, browser-entered provider keys, whiteboard state, and the latest
report stay in the browser. Completed reports are also archived in the project
folder. A complete archive becomes visible only after every file is written, and
history offers a two-step local delete action. The local MVP has no authentication
or database.
