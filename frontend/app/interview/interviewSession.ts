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
  decision: "continue" | "follow_up" | "challenge" | "interrupt" | "move_on";
  reason: string;
  confidence: number;
  follow_up_prompt?: string;
  candidate_answer?: string;
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
  whiteboard_actions: NonNullable<LiveInterviewerStateProposal["whiteboard_actions"]>;
  session: DirectorSession;
};

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
