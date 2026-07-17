export type InterviewQuestion = {
  id: string;
  prompt: string;
  focus: string;
};

export type InterviewAnswer = {
  questionId: string;
  question: string;
  answer: string;
  kind?: string;
};

export type InterviewReport = {
  completedAt: string;
  totalQuestions: number;
  answeredQuestions: number;
  answers: InterviewAnswer[];
  realtimeTranscript?: RealtimeTranscriptItem[];
  plan?: PlannedQuestion[];
  evaluation?: InterviewEvaluation;
};

export type InterviewEvaluation = {
  rubric_version?: string;
  clarity: number;
  specificity: number;
  reasoning_depth: number;
  completion: number;
  overall: number;
  suggestions: string[];
  sufficient_evidence?: boolean;
};

export type DirectorAnswer = {
  question_id: string;
  question: string;
  answer: string;
  kind: string;
};

export type PlannedQuestion = {
  id: string;
  prompt: string;
  focus: string;
  follow_up_prompt: string;
  allocated_seconds: number;
};

export type DirectorSession = {
  session_id: string;
  state: "asking" | "follow_up" | "completed" | "ended";
  question_index: number;
  current_prompt: string | null;
  current_focus: string | null;
  attitude: string;
  pressure: string;
  control: {
    emotion: string;
    gesture: string;
    whiteboard_action: string | null;
  };
  director_config: {
    interviewer_style: "friendly" | "professional" | "strict";
    initial_pressure: "low" | "medium" | "high";
    follow_up_depth: "light" | "standard" | "deep";
    interruption_frequency: "low" | "medium" | "high";
    total_duration_seconds: number;
  };
  turn_index: number;
  answers: DirectorAnswer[];
  follow_up_used: string[];
  question_plan: PlannedQuestion[];
};

export type VoiceProvider = {
  id: "openai" | "google";
  label: string;
  ready: boolean;
  primary: boolean;
  detail: string;
};

export type RealtimeClientSecret = {
  provider: string;
  value: string;
  expires_at: number | null;
  model: string;
  voice: string;
};

export type RealtimeTranscriptItem = {
  id: string;
  speaker: "candidate" | "interviewer";
  text: string;
};

export function appendQuestionDialogue(
  items: RealtimeTranscriptItem[],
  speaker: RealtimeTranscriptItem["speaker"],
  text: string,
  id: string,
  maximumItems = 200,
): RealtimeTranscriptItem[] {
  const normalizedText = text.trim();
  if (!normalizedText) return items;
  const existingIndex = items.findIndex((item) => item.id === id && item.speaker === speaker);
  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    const updated = [...items];
    updated[existingIndex] = {
      ...existing,
      text: mergeTranscriptText(existing.text, normalizedText),
    };
    return updated.slice(-maximumItems);
  }
  return [...items, { id, speaker, text: normalizedText }].slice(-maximumItems);
}

export function mergeTranscriptText(existing: string, incoming: string): string {
  const previous = existing.trim();
  const next = incoming.trim();
  if (!previous) return next;
  if (!next || previous === next || previous.startsWith(next) || previous.endsWith(next)) {
    return previous;
  }
  if (next.startsWith(previous)) return next;
  const maximumOverlap = Math.min(previous.length, next.length);
  for (let overlap = maximumOverlap; overlap >= 3; overlap -= 1) {
    if (previous.slice(-overlap) === next.slice(0, overlap)) {
      return `${previous}${next.slice(overlap)}`.replace(/\s+/g, " ").trim();
    }
  }
  return `${previous} ${next}`.replace(/\s+/g, " ").trim();
}

export type LiveInterviewerStateProposal = {
  emotion:
    | "neutral"
    | "attentive"
    | "curious"
    | "skeptical"
    | "unconvinced"
    | "satisfied"
    | "firm";
  gesture:
    | "idle"
    | "nod_once"
    | "think"
    | "lean_in"
    | "look_whiteboard"
    | "take_note"
    | "pause";
  decision:
    | "continue"
    | "follow_up"
    | "challenge"
    | "interrupt"
    | "move_on"
    | "explain_current"
    | "move_on_after_explanation";
  reason: string;
  confidence: number;
  answer_status:
    | "substantive"
    | "partial"
    | "non_answer"
    | "off_topic"
    | "uncertain";
  reasoning_depth_achieved:
    | "none"
    | "answer"
    | "linked_reasoning"
    | "principled_reasoning";
  follow_up_prompt?: string;
  candidate_answer?: string;
  question_completion_percentage?: number;
  covered_requirements?: string[];
  missing_requirements?: string[];
  whiteboard_actions?: Array<{
    kind: "note" | "summary" | "arrow" | "line" | "circle" | "highlight";
    text?: string;
    x: number;
    y: number;
    toX?: number;
    toY?: number;
    w?: number;
    h?: number;
  }>;
};

export type LiveControlReview = {
  approved: boolean;
  approved_decision: string;
  control: DirectorSession["control"];
  attitude: string;
  pressure: string;
  reason_code: string;
  answer_status: LiveInterviewerStateProposal["answer_status"];
  reasoning_depth_achieved: LiveInterviewerStateProposal["reasoning_depth_achieved"];
  question_completion_percentage: number;
  covered_requirements: string[];
  missing_requirements: string[];
  verification_id: string | null;
  verification_applied: boolean;
  verification_guidance: string | null;
  whiteboard_actions: NonNullable<LiveInterviewerStateProposal["whiteboard_actions"]>;
  session: DirectorSession;
};

export type ProgressVerificationResult = {
  verification_id: string;
  question_index: number;
  question_id: string;
  turn_index: number;
  verified_completion: number;
  answer_status: LiveInterviewerStateProposal["answer_status"];
  verified_reasoning_depth_achieved: LiveInterviewerStateProposal["reasoning_depth_achieved"];
  increase_reasonable: boolean;
  critical_missing_requirements: string[];
  risk_level: "low" | "medium" | "high";
  confidence: number;
  reason: string;
  supports_live_judgment: boolean;
  requires_calibration: boolean;
};

export function getProgressVerificationTriggers(
  previousCompletion: number,
  proposal: LiveInterviewerStateProposal,
): string[] {
  const completion = proposal.question_completion_percentage ?? 0;
  const covered = proposal.covered_requirements ?? [];
  const missing = proposal.missing_requirements ?? [];
  const requirementCount = covered.length + missing.length;
  const triggers = new Set<string>();
  if (completion - previousCompletion >= 25) triggers.add("sudden_completion_increase");
  if (completion >= 90) triggers.add("completion_at_least_90");
  if (proposal.decision === "move_on") triggers.add("move_on_proposed");
  if (requirementCount >= 2 && completion >= 80) triggers.add("multi_part_near_transition");
  if (
    (proposal.answer_status === "substantive" && missing.length > 0) ||
    (proposal.answer_status !== "substantive" && completion >= 85)
  ) {
    triggers.add("assessment_inconsistent");
  }
  if (proposal.confidence < 0.85 && (completion >= 80 || proposal.decision === "move_on")) {
    triggers.add("lower_confidence_near_transition");
  }
  if (
    ["off_topic", "uncertain"].includes(proposal.answer_status) &&
    (completion >= 50 || proposal.decision === "move_on")
  ) {
    triggers.add("semantic_risk_near_transition");
  }
  return [...triggers];
}

export function normalizeLiveInterviewerProposal(
  input: unknown,
  candidateAnswer = "",
): LiveInterviewerStateProposal {
  const value = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const oneOf = <T extends string>(
    candidate: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T => typeof candidate === "string" && allowed.includes(candidate as T)
    ? candidate as T
    : fallback;
  const text = (candidate: unknown, fallback = "", maximum = 2_000) =>
    typeof candidate === "string"
      ? candidate.trim().slice(0, maximum)
      : fallback;
  const confidence = typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1
    ? value.confidence
    : 0;
  const completion = typeof value.question_completion_percentage === "number" &&
    Number.isFinite(value.question_completion_percentage)
    ? Math.max(0, Math.min(100, Math.round(value.question_completion_percentage)))
    : 0;
  const stringList = (candidate: unknown) => Array.isArray(candidate)
    ? candidate
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    emotion: oneOf(
      value.emotion,
      ["neutral", "attentive", "curious", "skeptical", "unconvinced", "satisfied", "firm"] as const,
      "neutral",
    ),
    gesture: oneOf(
      value.gesture,
      ["idle", "nod_once", "think", "lean_in", "look_whiteboard", "take_note", "pause"] as const,
      "idle",
    ),
    decision: oneOf(
      value.decision,
      ["continue", "follow_up", "challenge", "interrupt", "move_on", "explain_current", "move_on_after_explanation"] as const,
      "continue",
    ),
    reason: text(
      value.reason,
      "Provider submitted an incomplete control signal.",
      240,
    ) || "Provider submitted an incomplete control signal.",
    confidence,
    answer_status: oneOf(
      value.answer_status,
      ["substantive", "partial", "non_answer", "off_topic", "uncertain"] as const,
      "uncertain",
    ),
    reasoning_depth_achieved: oneOf(
      value.reasoning_depth_achieved,
      ["none", "answer", "linked_reasoning", "principled_reasoning"] as const,
      "none",
    ),
    follow_up_prompt: text(value.follow_up_prompt),
    candidate_answer: text(candidateAnswer, "", 20_000),
    question_completion_percentage: completion,
    covered_requirements: stringList(value.covered_requirements),
    missing_requirements: stringList(value.missing_requirements),
    whiteboard_actions: normalizeWhiteboardActions(value.whiteboard_actions),
  };
}

function normalizeWhiteboardActions(
  input: unknown,
): NonNullable<LiveInterviewerStateProposal["whiteboard_actions"]> {
  if (!Array.isArray(input)) return [];
  const unit = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : null;
  const actions: NonNullable<LiveInterviewerStateProposal["whiteboard_actions"]> = [];
  for (const item of input.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const action = item as Record<string, unknown>;
    const x = unit(action.x);
    const y = unit(action.y);
    if (x === null || y === null) continue;
    if (action.kind === "note" || action.kind === "summary") {
      const actionText = typeof action.text === "string"
        ? action.text.trim().slice(0, 240)
        : "";
      if (actionText) actions.push({ kind: action.kind, text: actionText, x, y });
      continue;
    }
    if (action.kind === "arrow" || action.kind === "line") {
      const toX = unit(action.toX);
      const toY = unit(action.toY);
      if (toX !== null && toY !== null) {
        actions.push({ kind: action.kind, x, y, toX, toY });
      }
      continue;
    }
    if (action.kind === "circle" || action.kind === "highlight") {
      const w = unit(action.w);
      const h = unit(action.h);
      if (w !== null && h !== null && w > 0.01 && h > 0.01) {
        actions.push({ kind: action.kind, x, y, w, h });
      }
    }
  }
  return actions;
}

export const interviewStorageKey = "ai-interview-simulator.report";
export const interviewTotalQuestions = 5;

export type InterviewUiState = {
  isInterviewActive: boolean;
  canEditNotes: boolean;
  showStartButton: boolean;
  showEndButton: boolean;
};

export function deriveInterviewUiState(
  session: Pick<DirectorSession, "state"> | null,
  isComplete: boolean,
  isEnding: boolean,
): InterviewUiState {
  const hasSession = Boolean(session);
  const isInterviewActive = Boolean(
    session && session.state !== "completed" && session.state !== "ended",
  );

  return {
    isInterviewActive,
    canEditNotes: isInterviewActive && !isComplete && !isEnding,
    showStartButton: !hasSession,
    showEndButton: isInterviewActive && !isComplete,
  };
}

export function createInterviewReport(
  answers: InterviewAnswer[],
  realtimeTranscript: RealtimeTranscriptItem[] = [],
  totalQuestions = interviewTotalQuestions,
  plan: PlannedQuestion[] = [],
): InterviewReport {
  return {
    completedAt: new Date().toISOString(),
    totalQuestions,
    answeredQuestions: new Set(
      answers
        .filter((answer) => answer.answer.trim())
        .map((answer) => answer.questionId),
    ).size,
    answers,
    realtimeTranscript,
    plan,
  };
}

export function mapDirectorAnswers(
  answers: DirectorAnswer[],
): InterviewAnswer[] {
  return answers.map((answer) => ({
    questionId: answer.question_id,
    question: answer.question,
    answer: answer.answer,
    kind: answer.kind,
  }));
}
