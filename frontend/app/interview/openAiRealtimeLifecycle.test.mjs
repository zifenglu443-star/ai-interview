import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpenAiRealtimeErrorMessage,
  initialOpenAiRealtimeLifecycle,
  shouldRetryOpenAiOpeningResponse,
  shouldSendOpenAiOpeningPrompt,
} from "./openAiRealtimeLifecycle.ts";

test("does not send the opening prompt before session.created", () => {
  assert.equal(shouldSendOpenAiOpeningPrompt(initialOpenAiRealtimeLifecycle), false);
  assert.equal(
    shouldSendOpenAiOpeningPrompt({
      ...initialOpenAiRealtimeLifecycle,
      sessionReady: true,
    }),
    true,
  );
});

test("retries once only when an opening response never starts", () => {
  const waiting = {
    sessionReady: true,
    openingPromptSent: true,
    openingResponseStarted: false,
    openingRetryUsed: false,
  };

  assert.equal(shouldRetryOpenAiOpeningResponse(waiting), true);
  assert.equal(
    shouldRetryOpenAiOpeningResponse({ ...waiting, openingRetryUsed: true }),
    false,
  );
  assert.equal(
    shouldRetryOpenAiOpeningResponse({ ...waiting, openingResponseStarted: true }),
    false,
  );
});

test("surfaces Realtime error messages", () => {
  assert.equal(
    getOpenAiRealtimeErrorMessage({
      type: "error",
      error: { message: "The response could not be created." },
    }),
    "The response could not be created.",
  );
  assert.equal(getOpenAiRealtimeErrorMessage({ type: "session.created" }), null);
});
