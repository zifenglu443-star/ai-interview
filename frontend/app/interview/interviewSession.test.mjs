import assert from "node:assert/strict";
import test from "node:test";

import {
  appendQuestionDialogue,
  createInterviewReport,
  deriveInterviewUiState,
  getProgressVerificationTriggers,
  mergeTranscriptText,
  normalizeLiveInterviewerProposal,
} from "./interviewSession.ts";

test("current-question dialogue preserves both speakers in chronological order", () => {
  let dialogue = [];
  dialogue = appendQuestionDialogue(dialogue, "interviewer", "Original question", "i1");
  dialogue = appendQuestionDialogue(dialogue, "candidate", "First answer", "c1");
  dialogue = appendQuestionDialogue(dialogue, "interviewer", "Follow-up question", "i2");
  dialogue = appendQuestionDialogue(dialogue, "candidate", "Second", "c2");
  dialogue = appendQuestionDialogue(dialogue, "candidate", "Second answer expanded", "c2");

  assert.deepEqual(dialogue.map(({ speaker, text }) => ({ speaker, text })), [
    { speaker: "interviewer", text: "Original question" },
    { speaker: "candidate", text: "First answer" },
    { speaker: "interviewer", text: "Follow-up question" },
    { speaker: "candidate", text: "Second answer expanded" },
  ]);
});

test("same-speaker turns with different ids remain separate", () => {
  let dialogue = [];
  dialogue = appendQuestionDialogue(dialogue, "candidate", "First answer", "turn-1");
  dialogue = appendQuestionDialogue(dialogue, "candidate", "Second answer", "turn-2");

  assert.deepEqual(dialogue.map(({ id, text }) => ({ id, text })), [
    { id: "turn-1", text: "First answer" },
    { id: "turn-2", text: "Second answer" },
  ]);
});

test("streamed transcript chunks merge only within one turn id", () => {
  assert.equal(mergeTranscriptText("The final ans", "answer is four"), "The final answer is four");
  assert.equal(mergeTranscriptText("The answer", "The answer is four"), "The answer is four");
});

test("ready room shows Start and keeps answer notes disabled", () => {
  assert.deepEqual(deriveInterviewUiState(null, false, false), {
    isInterviewActive: false,
    canEditNotes: false,
    showStartButton: true,
    showEndButton: false,
  });
});

test("progress verification triggers only near risky transitions", () => {
  const quiet = normalizeLiveInterviewerProposal({
    decision: "continue",
    answer_status: "partial",
    confidence: 0.9,
    question_completion_percentage: 45,
  });
  assert.deepEqual(getProgressVerificationTriggers(35, quiet), []);

  const risky = normalizeLiveInterviewerProposal({
    decision: "move_on",
    answer_status: "substantive",
    confidence: 0.8,
    question_completion_percentage: 92,
    covered_requirements: ["part one"],
    missing_requirements: ["part two"],
  });
  assert.deepEqual(new Set(getProgressVerificationTriggers(55, risky)), new Set([
    "sudden_completion_increase",
    "completion_at_least_90",
    "move_on_proposed",
    "multi_part_near_transition",
    "assessment_inconsistent",
    "lower_confidence_near_transition",
  ]));
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

test("malformed live-provider proposals degrade to a safe continue signal", () => {
  const proposal = normalizeLiveInterviewerProposal(
    {
      emotion: "furious",
      gesture: "throw_laptop",
      decision: "skip_everything",
      confidence: 7,
      question_completion_percentage: 140,
      covered_requirements: ["first", 2, "second"],
      whiteboard_actions: [{ kind: "circle", x: "bad", y: 0.2, w: 0.4, h: 0.4 }],
    },
    "Candidate answer",
  );

  assert.equal(proposal.emotion, "neutral");
  assert.equal(proposal.gesture, "idle");
  assert.equal(proposal.decision, "continue");
  assert.equal(proposal.answer_status, "uncertain");
  assert.equal(proposal.reasoning_depth_achieved, "none");
  assert.equal(proposal.confidence, 0);
  assert.equal(proposal.question_completion_percentage, 100);
  assert.deepEqual(proposal.covered_requirements, ["first", "second"]);
  assert.deepEqual(proposal.whiteboard_actions, []);
  assert.equal(proposal.candidate_answer, "Candidate answer");
});

test("live reasoning-depth reports accept only the shared semantic levels", () => {
  const proposal = normalizeLiveInterviewerProposal({
    reasoning_depth_achieved: "principled_reasoning",
  });
  assert.equal(proposal.reasoning_depth_achieved, "principled_reasoning");
});
