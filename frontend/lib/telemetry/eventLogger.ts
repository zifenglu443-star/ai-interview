export type InterviewEventSource =
  | "session"
  | "director"
  | "voice"
  | "whiteboard"
  | "immersion";

export type InterviewEventType =
  | "session_started"
  | "session_ended"
  | "answer_submitted"
  | "director_transition"
  | "control_signal"
  | "candidate_speaking_started"
  | "candidate_speaking_stopped"
  | "interviewer_speaking_started"
  | "interviewer_speaking_stopped"
  | "voice_connected"
  | "voice_disconnected"
  | "whiteboard_updated"
  | "whiteboard_sent"
  | "live_control_requested"
  | "live_control_applied"
  | "live_control_rejected"
  | "response_latency_measured";

export type InterviewEventData = Record<
  string,
  boolean | number | string | null
>;

export type InterviewEvent = {
  id: string;
  type: InterviewEventType;
  source: InterviewEventSource;
  timestamp: string;
  elapsedMs: number;
  data: InterviewEventData;
};

export type InterviewTimelineExport = {
  schemaVersion: "1.0";
  sessionId: string;
  startedAt: string;
  exportedAt: string;
  events: InterviewEvent[];
};

export class InterviewEventLogger {
  private static readonly maximumEvents = 1000;
  private events: InterviewEvent[] = [];
  private readonly now: () => number;
  private sequence = 0;
  private sessionId = "not-started";
  private startedAtMs: number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.startedAtMs = this.now();
  }

  startSession(sessionId: string, atMs = this.now()): void {
    this.events = [];
    this.sequence = 0;
    this.sessionId = sessionId;
    this.startedAtMs = atMs;
  }

  record(
    type: InterviewEventType,
    source: InterviewEventSource,
    data: InterviewEventData = {},
    atMs = this.now(),
  ): InterviewEvent {
    this.sequence += 1;
    const event: InterviewEvent = {
      id: `${this.sessionId}:${this.sequence}`,
      type,
      source,
      timestamp: new Date(atMs).toISOString(),
      elapsedMs: Math.max(0, atMs - this.startedAtMs),
      data: { ...data },
    };
    this.events.push(event);
    if (this.events.length > InterviewEventLogger.maximumEvents) {
      this.events.splice(
        0,
        this.events.length - InterviewEventLogger.maximumEvents,
      );
    }
    return event;
  }

  snapshot(): InterviewEvent[] {
    return this.events.map((event) => ({
      ...event,
      data: { ...event.data },
    }));
  }

  export(atMs = this.now()): InterviewTimelineExport {
    return {
      schemaVersion: "1.0",
      sessionId: this.sessionId,
      startedAt: new Date(this.startedAtMs).toISOString(),
      exportedAt: new Date(atMs).toISOString(),
      events: this.snapshot(),
    };
  }
}

export type Speaker = "candidate" | "interviewer";

type SpeakerDurationState = {
  accumulatedMs: number;
  startedAtMs: number | null;
};

export class SpeakingDurationTracker {
  private readonly state: Record<Speaker, SpeakerDurationState> = {
    candidate: { accumulatedMs: 0, startedAtMs: null },
    interviewer: { accumulatedMs: 0, startedAtMs: null },
  };

  start(speaker: Speaker, atMs: number): boolean {
    if (this.state[speaker].startedAtMs !== null) {
      return false;
    }
    this.state[speaker].startedAtMs = atMs;
    return true;
  }

  stop(speaker: Speaker, atMs: number): boolean {
    const startedAtMs = this.state[speaker].startedAtMs;
    if (startedAtMs === null) {
      return false;
    }
    this.state[speaker].accumulatedMs += Math.max(0, atMs - startedAtMs);
    this.state[speaker].startedAtMs = null;
    return true;
  }

  duration(speaker: Speaker, atMs: number): number {
    const speakerState = this.state[speaker];
    const activeDuration =
      speakerState.startedAtMs === null
        ? 0
        : Math.max(0, atMs - speakerState.startedAtMs);
    return speakerState.accumulatedMs + activeDuration;
  }

  isActive(speaker: Speaker): boolean {
    return this.state[speaker].startedAtMs !== null;
  }

  reset(): void {
    for (const speaker of ["candidate", "interviewer"] as const) {
      this.state[speaker].accumulatedMs = 0;
      this.state[speaker].startedAtMs = null;
    }
  }
}

export type DirectorTelemetryInput = {
  state: string;
  question_index: number;
  current_prompt: string | null;
  follow_up_used: string[];
  control: {
    emotion: string;
    gesture: string;
    whiteboard_action: string | null;
  };
};

export type DirectorTelemetry = {
  state: string;
  questionIndex: number;
  currentQuestion: string | null;
  followUpCount: number;
  emotion: string;
  gesture: string;
  whiteboardAction: string | null;
};

export function deriveDirectorTelemetry(
  session: DirectorTelemetryInput | null,
): DirectorTelemetry {
  return {
    state: session?.state ?? "ready",
    questionIndex: session?.question_index ?? -1,
    currentQuestion: session?.current_prompt ?? null,
    followUpCount: session?.follow_up_used.length ?? 0,
    emotion: session?.control.emotion ?? "neutral",
    gesture: session?.control.gesture ?? "idle",
    whiteboardAction: session?.control.whiteboard_action ?? null,
  };
}
