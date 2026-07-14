export const whiteboardChannelName = "ai-interview-simulator.whiteboard-live";
export const whiteboardSnapshotStorageKey =
  "ai-interview-simulator.whiteboard-final-snapshot";
export const whiteboardPersistenceKey = "ai-interview-simulator.whiteboard";
export const whiteboardCurrentQuestionStorageKey =
  "ai-interview-simulator.whiteboard-current-question";

export type WhiteboardFrame = {
  type: "whiteboard-frame";
  data: string;
  mimeType: "image/jpeg";
  updatedAt: number;
  width: number;
  height: number;
};

export type WhiteboardCleared = {
  type: "whiteboard-cleared";
  updatedAt: number;
};

export type WhiteboardFrameRequest = {
  type: "request-whiteboard-frame";
};

export type WhiteboardResetRequest = {
  type: "reset-whiteboard";
  requestId: string;
};

export type WhiteboardResetComplete = {
  type: "whiteboard-reset-complete";
  requestId: string;
};

export type AiWhiteboardOperation =
  | { kind: "question"; text: string }
  | { kind: "note" | "summary"; text: string; x: number; y: number }
  | { kind: "arrow" | "line"; x: number; y: number; toX: number; toY: number }
  | { kind: "circle" | "highlight"; x: number; y: number; w: number; h: number };

export type ApplyAiWhiteboardOperations = {
  type: "apply-ai-whiteboard-ops";
  operations: AiWhiteboardOperation[];
};

export type WhiteboardCurrentQuestion = {
  type: "whiteboard-current-question";
  questionIndex: number;
  prompt: string;
};

export type WhiteboardSyncMessage =
  | WhiteboardFrame
  | WhiteboardCleared
  | WhiteboardFrameRequest
  | WhiteboardResetRequest
  | WhiteboardResetComplete
  | ApplyAiWhiteboardOperations;
