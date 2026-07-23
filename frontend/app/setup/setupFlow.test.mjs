import assert from "node:assert/strict";
import test from "node:test";

import {
  canStartFromWaitingRoom,
  validatePlanInput,
} from "./setupFlow.ts";

test("setup requires a role and question material", () => {
  assert.equal(
    validatePlanInput({ targetRole: " ", topics: "systems", questionBank: "" }),
    "Add the role you want to practise before continuing.",
  );
  assert.equal(
    validatePlanInput({ targetRole: "Engineer", topics: " ", questionBank: "" }),
    "Add at least one topic, question, or question file.",
  );
  assert.equal(
    validatePlanInput({
      targetRole: "Engineer",
      topics: "",
      questionBank: "1. Design a queue",
    }),
    null,
  );
});

test("waiting room requires every mandatory readiness check", () => {
  assert.equal(
    canStartFromWaitingRoom({
      isMicrophoneReady: true,
      isOnline: true,
      isProviderReady: true,
      isStarting: false,
    }),
    true,
  );
  assert.equal(
    canStartFromWaitingRoom({
      isMicrophoneReady: false,
      isOnline: true,
      isProviderReady: true,
      isStarting: false,
    }),
    false,
  );
  assert.equal(
    canStartFromWaitingRoom({
      isMicrophoneReady: true,
      isOnline: false,
      isProviderReady: true,
      isStarting: false,
    }),
    false,
  );
  assert.equal(
    canStartFromWaitingRoom({
      isMicrophoneReady: true,
      isOnline: true,
      isProviderReady: false,
      isStarting: false,
    }),
    false,
  );
});
