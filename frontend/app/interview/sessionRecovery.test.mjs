import assert from "node:assert/strict";
import test from "node:test";

import {
  activeInterviewPointerKey,
  activeInterviewPointerLifetimeMs,
  clearActiveInterviewPointer,
  loadActiveInterviewPointer,
  saveActiveInterviewPointer,
} from "./sessionRecovery.ts";

function installSessionStorage() {
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    },
  };
  return values;
}

test.afterEach(() => {
  delete globalThis.window;
});

test("active interview recovery stores only the session pointer", () => {
  const values = installSessionStorage();

  saveActiveInterviewPointer("session_123", 1_000);

  const stored = values.get(activeInterviewPointerKey);
  assert.equal(stored.includes("session_123"), true);
  assert.equal(stored.includes("answer"), false);
  assert.equal(loadActiveInterviewPointer(2_000), "session_123");
});

test("expired or malformed recovery pointers are removed", () => {
  const values = installSessionStorage();
  saveActiveInterviewPointer("session_123", 1_000);

  assert.equal(
    loadActiveInterviewPointer(1_000 + activeInterviewPointerLifetimeMs + 1),
    null,
  );
  assert.equal(values.has(activeInterviewPointerKey), false);

  values.set(activeInterviewPointerKey, '{"sessionId":"not valid","savedAt":10}');
  assert.equal(loadActiveInterviewPointer(20), null);
  clearActiveInterviewPointer();
  assert.equal(values.has(activeInterviewPointerKey), false);
});
