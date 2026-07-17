export type OpenAiRealtimeLifecycle = {
  sessionReady: boolean;
  openingPromptSent: boolean;
  openingResponseStarted: boolean;
  openingRetryUsed: boolean;
};

export const initialOpenAiRealtimeLifecycle: OpenAiRealtimeLifecycle = {
  sessionReady: false,
  openingPromptSent: false,
  openingResponseStarted: false,
  openingRetryUsed: false,
};

export function shouldSendOpenAiOpeningPrompt(
  lifecycle: OpenAiRealtimeLifecycle,
): boolean {
  return lifecycle.sessionReady && !lifecycle.openingPromptSent;
}

export function shouldRetryOpenAiOpeningResponse(
  lifecycle: OpenAiRealtimeLifecycle,
): boolean {
  return (
    lifecycle.sessionReady &&
    lifecycle.openingPromptSent &&
    !lifecycle.openingResponseStarted &&
    !lifecycle.openingRetryUsed
  );
}

export function getOpenAiRealtimeErrorMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const realtimeEvent = event as {
    type?: unknown;
    error?: { message?: unknown };
  };
  if (realtimeEvent.type !== "error") return null;
  const message = realtimeEvent.error?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "OpenAI Realtime reported an unknown error.";
}
