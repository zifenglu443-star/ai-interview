import assert from "node:assert/strict";
import test from "node:test";

import { createInterviewReport, deriveInterviewUiState } from "./interviewSession.ts";

test("ready room shows Start and keeps answer notes disabled", () => {
  assert.deepEqual(deriveInterviewUiState(null, false, false), {
    isInterviewActive: false,
    canEditNotes: false,
    showStartButton: true,
    showEndButton: false,
  });
});

test("started interview replaces Start with End and enables answer notes", () => {
  assert.deepEqual(
    deriveInterviewUiState({ state: "asking" }, false, false),
    {
      isInterviewActive: true,
      canEditNotes: true,
      showStartButton: false,
      showEndButton: true,
    },
  );
});

test("follow-up keeps End visible and answer notes editable", () => {
  assert.deepEqual(
    deriveInterviewUiState({ state: "follow_up" }, false, false),
    {
      isInterviewActive: true,
      canEditNotes: true,
      showStartButton: false,
      showEndButton: true,
    },
  );
});

test("finished interview disables notes and hides lifecycle buttons", () => {
  assert.deepEqual(
    deriveInterviewUiState({ state: "ended" }, true, false),
    {
      isInterviewActive: false,
      canEditNotes: false,
      showStartButton: false,
      showEndButton: false,
    },
  );
});

test("report completion counts questions rather than follow-up turns", () => {
  const report = createInterviewReport(
    [
      { questionId: "q1", question: "Question", answer: "Initial", kind: "primary" },
      { questionId: "q1", question: "Follow-up", answer: "More", kind: "follow_up" },
    ],
    [],
    4,
  );

  assert.equal(report.answeredQuestions, 1);
  assert.equal(report.totalQuestions, 4);
});
