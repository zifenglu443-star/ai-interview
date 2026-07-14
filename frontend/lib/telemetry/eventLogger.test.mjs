import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDirectorTelemetry,
  InterviewEventLogger,
  SpeakingDurationTracker,
} from "./eventLogger.ts";

test("event logger records ordered session-relative events", () => {
  let now = Date.parse("2026-07-10T10:00:00.000Z");
  const logger = new InterviewEventLogger(() => now);
  logger.startSession("session-test", now);

  logger.record("session_started", "session", { state: "asking" });
  now += 425;
  logger.record("director_transition", "director", {
    from: "asking",
    to: "follow_up",
  });

  const events = logger.snapshot();
  assert.equal(events.length, 2);
  assert.equal(events[0].id, "session-test:1");
  assert.equal(events[1].elapsedMs, 425);
  assert.equal(events[1].data.to, "follow_up");

  const exported = logger.export(now + 50);
  assert.equal(exported.schemaVersion, "1.0");
  assert.equal(exported.sessionId, "session-test");
  assert.equal(exported.events.length, 2);
});

test("event logger bounds long-running session history", () => {
  const logger = new InterviewEventLogger(() => 0);
  logger.startSession("bounded-session", 0);

  for (let index = 0; index < 1100; index += 1) {
    logger.record("control_signal", "director", { index }, index);
  }

  const events = logger.snapshot();
  assert.equal(events.length, 1000);
  assert.equal(events[0].id, "bounded-session:101");
  assert.equal(events.at(-1).id, "bounded-session:1100");
});

test("speaking duration tracker accumulates completed and active intervals", () => {
  const tracker = new SpeakingDurationTracker();

  assert.equal(tracker.start("candidate", 1000), true);
  assert.equal(tracker.start("candidate", 1200), false);
  assert.equal(tracker.duration("candidate", 1800), 800);
  assert.equal(tracker.stop("candidate", 2000), true);
  assert.equal(tracker.duration("candidate", 2500), 1000);

  tracker.start("candidate", 3000);
  tracker.stop("candidate", 3400);
  assert.equal(tracker.duration("candidate", 4000), 1400);
});

test("director telemetry exposes debug panel fields", () => {
  const telemetry = deriveDirectorTelemetry({
    state: "follow_up",
    question_index: 2,
    current_prompt: "Can you be more specific?",
    follow_up_used: ["intro", "project"],
    control: {
      emotion: "curious",
      gesture: "lean_in",
      whiteboard_action: "note_follow_up",
    },
  });

  assert.deepEqual(telemetry, {
    state: "follow_up",
    questionIndex: 2,
    currentQuestion: "Can you be more specific?",
    followUpCount: 2,
    emotion: "curious",
    gesture: "lean_in",
    whiteboardAction: "note_follow_up",
  });
});

test("director telemetry has stable ready defaults", () => {
  assert.deepEqual(deriveDirectorTelemetry(null), {
    state: "ready",
    questionIndex: -1,
    currentQuestion: null,
    followUpCount: 0,
    emotion: "neutral",
    gesture: "idle",
    whiteboardAction: null,
  });
});
