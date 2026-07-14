# UX

Looks like a meeting room, not ChatGPT.

## Before and during the interview

- Setup is the only editing surface for voice model and Director parameters.
- Starting the interview freezes those choices for a consistent simulation.
- Tool shows a clearly labelled `Locked session profile`; it is a live monitor,
  not a second settings form.
- To change the profile, leave the session and create a new one from Setup.

## Current room layout

```text
┌──────────────────────┬──────────────────────┐
│ AI interviewer       │ Candidate camera     │
├──────────────────────┼──────────────────────┤
│ Answer notes         │ Session signals      │
└──────────────────────┴──────────────────────┘
                Meeting controls
```

- All four core areas fit in one viewport without page scrolling.
- Tool is a separate drawer with its own vertical scrolling and no overlapping
  sections.
- The Director console visualizes state and decisions but does not expose hidden
  chain-of-thought or provider secrets.
- The interviewer and candidate video tiles have equal visual weight.
- Answer notes is a working scratchpad, not decorative UI.
- Status cards are restrained signals, not real-time coaching answers.

## Interviewer presence

The current implementation uses a static interviewer base image, short
one-shot reaction videos, and brief looping speech clips. Reactions return to
the still image after playback; only an active clip allocates a video decoder.
