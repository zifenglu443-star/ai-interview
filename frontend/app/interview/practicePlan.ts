export type PracticeFocus =
  | "behavioral"
  | "technical"
  | "project"
  | "case"
  | "custom";

export type VoiceProviderId = "openai" | "google";

export type InterviewerStyle = "friendly" | "professional" | "strict";
export type PressureLevel = "low" | "medium" | "high";
export type FollowUpDepth = "light" | "standard" | "deep";
export type InterruptionFrequency = "low" | "medium" | "high";

export type DirectorSettings = {
  interviewerStyle: InterviewerStyle;
  initialPressure: PressureLevel;
  followUpDepth: FollowUpDepth;
  interruptionFrequency: InterruptionFrequency;
  totalDurationMinutes: 10 | 15 | 20 | 30;
};

export type LiveApiSettings = {
  apiKey: string;
  model: string;
};

export type PlannerApiSettings = {
  apiKey: string;
  endpoint: string;
  model: string;
};

export type PlannedInterviewQuestion = {
  id: string;
  prompt: string;
  focus: string;
  follow_up_prompt: string;
  allocated_seconds: number;
};

export type PracticePlan = {
  planFormatVersion: 4;
  targetRole: string;
  focus: PracticeFocus;
  topics: string;
  voiceProvider: VoiceProviderId;
  questionBank: string;
  allowAiWhiteboardAnnotations: boolean;
  liveApis: Record<VoiceProviderId, LiveApiSettings>;
  plannerApi: PlannerApiSettings;
  directorSettings: DirectorSettings;
  plannedQuestions: PlannedInterviewQuestion[];
};

export const practicePlanStorageKey = "ai-interview-simulator.practice-plan";

export const defaultPracticePlan: PracticePlan = {
  planFormatVersion: 4,
  targetRole: "Student or internship role",
  focus: "behavioral",
  topics: "",
  voiceProvider: "google",
  questionBank: "",
  allowAiWhiteboardAnnotations: true,
  liveApis: {
    openai: { apiKey: "", model: "gpt-realtime-2.1" },
    google: { apiKey: "", model: "gemini-3.1-flash-live-preview" },
  },
  plannerApi: { apiKey: "", endpoint: "", model: "" },
  directorSettings: {
    interviewerStyle: "professional",
    initialPressure: "low",
    followUpDepth: "standard",
    interruptionFrequency: "medium",
    totalDurationMinutes: 10,
  },
  plannedQuestions: [],
};

export const practiceFocusLabels: Record<PracticeFocus, string> = {
  behavioral: "Behavioral stories",
  technical: "Technical explanation",
  project: "Project deep dive",
  case: "Problem solving / case",
  custom: "My specific questions",
};

export const voiceProviderLabels: Record<VoiceProviderId, string> = {
  openai: "OpenAI Realtime · Ash (male voice, typed progression)",
  google: "Google Gemini Live · Charon",
};

export function loadPracticePlan(): PracticePlan {
  if (typeof window === "undefined") {
    return defaultPracticePlan;
  }

  try {
    const stored = window.localStorage.getItem(practicePlanStorageKey);
    if (!stored) {
      return defaultPracticePlan;
    }
    const parsed = JSON.parse(stored) as Partial<Omit<PracticePlan, "planFormatVersion">> & {
      planFormatVersion?: number;
    };
    return {
      planFormatVersion: 4,
      targetRole: parsed.targetRole?.trim() || defaultPracticePlan.targetRole,
      focus: isPracticeFocus(parsed.focus) ? parsed.focus : defaultPracticePlan.focus,
      topics: parsed.topics?.trim() ?? "",
      voiceProvider: isVoiceProviderId(parsed.voiceProvider)
        ? parsed.voiceProvider
        : defaultPracticePlan.voiceProvider,
      questionBank: parsed.questionBank?.trim() ?? "",
      allowAiWhiteboardAnnotations:
        typeof parsed.allowAiWhiteboardAnnotations === "boolean"
          ? parsed.allowAiWhiteboardAnnotations
          : defaultPracticePlan.allowAiWhiteboardAnnotations,
      // Versions before 3 may contain stale browser keys that override fresh
      // project .env values. Preserve settings from version 3 onward.
      liveApis: (parsed.planFormatVersion ?? 0) >= 3
        ? parseLiveApis(parsed.liveApis)
        : defaultPracticePlan.liveApis,
      plannerApi: (parsed.planFormatVersion ?? 0) >= 3
        ? parsePlannerApi(parsed.plannerApi)
        : defaultPracticePlan.plannerApi,
      directorSettings: parseDirectorSettings(parsed.directorSettings),
      // Version 4 adds verified one-to-one source mapping. Older previews may
      // contain merged, omitted, reordered, or rewritten source questions.
      plannedQuestions:
        parsed.planFormatVersion === 4
          ? parsePlannedQuestions(parsed.plannedQuestions)
          : [],
    };
  } catch {
    return defaultPracticePlan;
  }
}

function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return value === "openai" || value === "google";
}

export function savePracticePlan(plan: PracticePlan) {
  window.localStorage.setItem(practicePlanStorageKey, JSON.stringify(plan));
}

function isPracticeFocus(value: unknown): value is PracticeFocus {
  return (
    value === "behavioral" ||
    value === "technical" ||
    value === "project" ||
    value === "case" ||
    value === "custom"
  );
}

function parsePlannedQuestions(value: unknown): PlannedInterviewQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item, index) => {
    const question = item as Partial<PlannedInterviewQuestion>;
    if (!question.prompt?.trim()) return [];
    return [{
      id: question.id?.trim() || `plan-${index + 1}`,
      prompt: question.prompt.trim(),
      focus: question.focus?.trim() || "Interview question",
      follow_up_prompt: question.follow_up_prompt?.trim() || "What assumption or tradeoff mattered most?",
      allocated_seconds: Number.isFinite(question.allocated_seconds) ? Math.max(30, Number(question.allocated_seconds)) : 0,
    }];
  });
}

function parseLiveApis(value: unknown): Record<VoiceProviderId, LiveApiSettings> {
  const stored = (value ?? {}) as Partial<Record<VoiceProviderId, Partial<LiveApiSettings>>>;
  return {
    openai: {
      apiKey: stored.openai?.apiKey ?? "",
      model: stored.openai?.model?.trim() || defaultPracticePlan.liveApis.openai.model,
    },
    google: {
      apiKey: stored.google?.apiKey ?? "",
      model: stored.google?.model?.trim() || defaultPracticePlan.liveApis.google.model,
    },
  };
}

function parsePlannerApi(value: unknown): PlannerApiSettings {
  const stored = (value ?? {}) as Partial<PlannerApiSettings>;
  return {
    apiKey: stored.apiKey ?? "",
    endpoint: stored.endpoint?.trim() ?? "",
    model: stored.model?.trim() ?? "",
  };
}

function parseDirectorSettings(value: unknown): DirectorSettings {
  const stored = (value ?? {}) as Partial<DirectorSettings>;
  const defaults = defaultPracticePlan.directorSettings;
  return {
    interviewerStyle: ["friendly", "professional", "strict"].includes(
      stored.interviewerStyle ?? "",
    )
      ? (stored.interviewerStyle as InterviewerStyle)
      : defaults.interviewerStyle,
    initialPressure: ["low", "medium", "high"].includes(
      stored.initialPressure ?? "",
    )
      ? (stored.initialPressure as PressureLevel)
      : defaults.initialPressure,
    followUpDepth: ["light", "standard", "deep"].includes(
      stored.followUpDepth ?? "",
    )
      ? (stored.followUpDepth as FollowUpDepth)
      : defaults.followUpDepth,
    interruptionFrequency: ["low", "medium", "high"].includes(
      stored.interruptionFrequency ?? "",
    )
      ? (stored.interruptionFrequency as InterruptionFrequency)
      : defaults.interruptionFrequency,
    totalDurationMinutes: [10, 15, 20, 30].includes(
      stored.totalDurationMinutes ?? 0,
    )
      ? (stored.totalDurationMinutes as DirectorSettings["totalDurationMinutes"])
      : defaults.totalDurationMinutes,
  };
}
