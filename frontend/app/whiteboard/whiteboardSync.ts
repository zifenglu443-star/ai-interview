export const whiteboardChannelName = "ai-interview-simulator.whiteboard-live";
export const whiteboardSnapshotStorageKey =
  "ai-interview-simulator.whiteboard-final-snapshot";
export const whiteboardPersistenceKey = "ai-interview-simulator.whiteboard";
export const whiteboardCurrentQuestionStorageKey =
  "ai-interview-simulator.whiteboard-current-question";
export const whiteboardPendingOperationsStorageKey =
  "ai-interview-simulator.whiteboard-pending-operations";

export type WhiteboardBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WhiteboardFrame = {
  type: "whiteboard-frame";
  data: string;
  mimeType: "image/jpeg";
  updatedAt: number;
  width: number;
  height: number;
  visualFingerprint?: number[];
  bounds?: WhiteboardBounds;
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
  id: string;
  operations: AiWhiteboardOperation[];
  bounds?: WhiteboardBounds;
  createdAt: number;
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

const maximumPendingOperationBatches = 20;

export type WhiteboardImageDifference = {
  changedPixelRatio: number;
  meanAbsoluteDifference: number;
};

export function calculateWhiteboardImageDifference(
  previous: number[] | undefined,
  current: number[] | undefined,
): WhiteboardImageDifference | null {
  if (!previous?.length || previous.length !== current?.length) return null;
  let changedPixels = 0;
  let absoluteDifference = 0;
  for (let index = 0; index < previous.length; index += 1) {
    const difference = Math.abs(previous[index] - current[index]);
    absoluteDifference += difference;
    if (difference >= 12) changedPixels += 1;
  }
  return {
    changedPixelRatio: changedPixels / previous.length,
    meanAbsoluteDifference: absoluteDifference / (previous.length * 255),
  };
}

export function isMaterialWhiteboardDifference(
  difference: WhiteboardImageDifference | null,
): boolean {
  if (!difference) return true;
  return difference.changedPixelRatio >= 0.004 ||
    difference.meanAbsoluteDifference >= 0.0015;
}

export function parsePendingWhiteboardOperations(
  stored: string | null,
): ApplyAiWhiteboardOperations[] {
  if (!stored) return [];
  try {
    const value = JSON.parse(stored) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (batch): batch is ApplyAiWhiteboardOperations =>
        Boolean(batch) &&
        typeof batch === "object" &&
        (batch as ApplyAiWhiteboardOperations).type === "apply-ai-whiteboard-ops" &&
        typeof (batch as ApplyAiWhiteboardOperations).id === "string" &&
        Array.isArray((batch as ApplyAiWhiteboardOperations).operations),
    );
  } catch {
    return [];
  }
}

export function appendPendingWhiteboardOperation(
  stored: string | null,
  batch: ApplyAiWhiteboardOperations,
): string {
  const batches = parsePendingWhiteboardOperations(stored).filter(
    (item) => item.id !== batch.id,
  );
  return JSON.stringify([...batches, batch].slice(-maximumPendingOperationBatches));
}

export function removePendingWhiteboardOperation(
  stored: string | null,
  id: string,
): string {
  return JSON.stringify(
    parsePendingWhiteboardOperations(stored).filter((batch) => batch.id !== id),
  );
}
