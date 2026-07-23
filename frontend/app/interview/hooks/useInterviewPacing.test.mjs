import assert from "node:assert/strict";
import test from "node:test";

import { calculateQuestionPacingBudget } from "./useInterviewPacing.ts";

test("question pacing keeps the planned allocation when on schedule", () => {
  assert.equal(
    calculateQuestionPacingBudget(180, 600, 3, 180, 120),
    180,
  );
});

test("question pacing compresses only after the interview falls behind schedule", () => {
  assert.equal(
    calculateQuestionPacingBudget(180, 600, 3, 180, 360),
    80,
  );
});

test("question pacing preserves a short final-question floor", () => {
  assert.equal(
    calculateQuestionPacingBudget(120, 600, 1, 480, 590),
    15,
  );
});
