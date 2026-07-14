export type InterviewerVideoSignals = {
  emotion: string;
  gesture: string;
  isSpeaking: boolean;
};

export type InterviewerPresentation =
  | { kind: "idle"; key: "idle" }
  | { kind: "speech"; key: "speaking-primary" | "speaking-question"; sources: string[] }
  | {
      kind: "action";
      key: "nod-once" | "think" | "lean-in" | "look-screen" | "take-note" | "pause";
      sources: string[];
    };

const root = "/videos/interviewer";

export const INTERVIEWER_VIDEO_PATHS = {
  idle: `${root}/idle.jpg`,
  blink: [`${root}/blink-1.mp4`, `${root}/blink-2.mp4`, `${root}/blink-3.mp4`],
  nod: [`${root}/nod-1.mp4`, `${root}/nod-2.mp4`, `${root}/nod-3.mp4`],
  speakingPrimary: [`${root}/speaking-primary.mp4`],
  speakingQuestion: [`${root}/speaking-question.mp4`],
  thinking: [`${root}/think.mp4`],
  leanIn: [`${root}/lean-in.mp4`],
  lookingAtScreen: [`${root}/look-screen.mp4`],
  takingNotes: [`${root}/take-note.mp4`],
} as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Maps the approved Director signal to a short visual event or an idle still. */
export function selectInterviewerPresentation({
  emotion,
  gesture,
  isSpeaking,
}: InterviewerVideoSignals): InterviewerPresentation {
  const normalizedGesture = normalize(gesture);
  const normalizedEmotion = normalize(emotion);

  if (isSpeaking) {
    return normalizedEmotion === "curious" || normalizedEmotion === "firm"
      ? {
          kind: "speech",
          key: "speaking-question",
          sources: [...INTERVIEWER_VIDEO_PATHS.speakingQuestion],
        }
      : {
          kind: "speech",
          key: "speaking-primary",
          sources: [...INTERVIEWER_VIDEO_PATHS.speakingPrimary],
        };
  }
  if (normalizedGesture === "nodonce") {
    return { kind: "action", key: "nod-once", sources: [...INTERVIEWER_VIDEO_PATHS.nod] };
  }
  if (normalizedGesture === "think" || normalizedEmotion === "skeptical") {
    return { kind: "action", key: "think", sources: [...INTERVIEWER_VIDEO_PATHS.thinking] };
  }
  if (normalizedGesture === "leanin") {
    return { kind: "action", key: "lean-in", sources: [...INTERVIEWER_VIDEO_PATHS.leanIn] };
  }
  if (normalizedGesture === "lookwhiteboard") {
    return {
      kind: "action",
      key: "look-screen",
      sources: [...INTERVIEWER_VIDEO_PATHS.lookingAtScreen],
    };
  }
  if (normalizedGesture === "takenote") {
    return {
      kind: "action",
      key: "take-note",
      sources: [...INTERVIEWER_VIDEO_PATHS.takingNotes],
    };
  }
  if (normalizedGesture === "pause") {
    return { kind: "action", key: "pause", sources: [] };
  }
  // A model may intentionally leave gesture idle while expressing a meaningful
  // reaction. Keep that reaction visible instead of falling straight to still.
  if (normalizedEmotion === "skeptical" || normalizedEmotion === "unconvinced") {
    return { kind: "action", key: "think", sources: [...INTERVIEWER_VIDEO_PATHS.thinking] };
  }
  if (normalizedEmotion === "firm") {
    return { kind: "action", key: "lean-in", sources: [...INTERVIEWER_VIDEO_PATHS.leanIn] };
  }
  if (normalizedEmotion === "satisfied") {
    return { kind: "action", key: "nod-once", sources: [...INTERVIEWER_VIDEO_PATHS.nod] };
  }
  return { kind: "idle", key: "idle" };
}
