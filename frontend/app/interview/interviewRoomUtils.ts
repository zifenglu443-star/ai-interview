import {
  isValidWhiteboardFrame,
  whiteboardPersistenceKey,
  whiteboardSnapshotStorageKey,
  type AiWhiteboardOperation,
  type WhiteboardFrame,
} from "../whiteboard/whiteboardSync";
import type { LiveInterviewerStateProposal } from "./interviewSession";

export async function callBackend<T>(
  path: string,
  body?: object,
): Promise<T> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const response = await fetch(`${baseUrl}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
    method: body ? "POST" : "GET",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      detail?: string;
    } | null;
    throw new Error(
      payload?.detail || `Director request failed: ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export function loadStoredWhiteboardFrame(): WhiteboardFrame | null {
  try {
    const stored = window.localStorage.getItem(whiteboardSnapshotStorageKey);
    if (!stored) return null;
    const frame = JSON.parse(stored) as unknown;
    if (!isValidWhiteboardFrame(frame)) {
      window.localStorage.removeItem(whiteboardSnapshotStorageKey);
      return null;
    }
    return frame;
  } catch {
    return null;
  }
}

export function clearStoredWhiteboardDatabase() {
  window.indexedDB.deleteDatabase(
    `TLDRAW_DOCUMENT_v2${whiteboardPersistenceKey}`,
  );
}

export function sanitizeAiWhiteboardActions(
  actions: LiveInterviewerStateProposal["whiteboard_actions"],
): AiWhiteboardOperation[] {
  if (!Array.isArray(actions)) return [];
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  const sanitized: AiWhiteboardOperation[] = [];
  for (const action of actions.slice(0, 4)) {
    if (!action || typeof action !== "object") continue;
    const kind = action.kind;
    const x = number(action.x);
    const y = number(action.y);
    if (kind === "note" || kind === "summary") {
      const text =
        typeof action.text === "string"
          ? action.text.trim().slice(0, 240)
          : "";
      if (text) sanitized.push({ kind, text, x, y });
      continue;
    }
    if (kind === "arrow" || kind === "line") {
      sanitized.push({
        kind,
        x,
        y,
        toX: number(action.toX),
        toY: number(action.toY),
      });
      continue;
    }
    if (kind === "circle" || kind === "highlight") {
      const w = number(action.w);
      const h = number(action.h);
      if (w > 0.01 && h > 0.01) {
        sanitized.push({ kind, x, y, w, h });
      }
    }
  }
  return sanitized;
}

export function formatLiveControlStatus(
  status: "offline" | "ready" | "evaluating" | "active" | "error",
): string {
  return {
    offline: "Interviewer signal channel offline",
    ready: "Interviewer signal channel ready",
    evaluating: "Interviewer is evaluating the current turn",
    active: "Interviewer signal applied",
    error: "Interviewer signal channel error",
  }[status];
}
