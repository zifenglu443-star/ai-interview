export const activeInterviewPointerKey = "ai-interview-active-session-v1";
export const activeInterviewPointerLifetimeMs = 30 * 60 * 1000;

type ActiveInterviewPointer = {
  savedAt: number;
  sessionId: string;
};

export function saveActiveInterviewPointer(
  sessionId: string,
  savedAt = Date.now(),
) {
  window.sessionStorage.setItem(
    activeInterviewPointerKey,
    JSON.stringify({ savedAt, sessionId } satisfies ActiveInterviewPointer),
  );
}

export function loadActiveInterviewPointer(
  now = Date.now(),
): string | null {
  try {
    const stored = window.sessionStorage.getItem(activeInterviewPointerKey);
    if (!stored) return null;
    const pointer = JSON.parse(stored) as Partial<ActiveInterviewPointer>;
    if (
      typeof pointer.sessionId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(pointer.sessionId) ||
      typeof pointer.savedAt !== "number" ||
      !Number.isFinite(pointer.savedAt) ||
      now - pointer.savedAt < 0 ||
      now - pointer.savedAt > activeInterviewPointerLifetimeMs
    ) {
      clearActiveInterviewPointer();
      return null;
    }
    return pointer.sessionId;
  } catch {
    clearActiveInterviewPointer();
    return null;
  }
}

export function clearActiveInterviewPointer() {
  window.sessionStorage.removeItem(activeInterviewPointerKey);
}
