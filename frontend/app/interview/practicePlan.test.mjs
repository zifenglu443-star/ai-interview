import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPracticePlan,
  loadPracticePlan,
  practicePlanStorageKey,
} from "./practicePlan.ts";

function installStoredPlan(plan) {
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return key === practicePlanStorageKey ? JSON.stringify(plan) : null;
      },
      setItem() {},
    },
  };
}

test.afterEach(() => {
  delete globalThis.window;
});

test("version 4 clears older previews while preserving current API settings", () => {
  installStoredPlan({
    ...defaultPracticePlan,
    planFormatVersion: 3,
    liveApis: {
      openai: { apiKey: "openai-browser-key", model: "openai-model" },
      google: { apiKey: "google-browser-key", model: "google-model" },
    },
    plannerApi: {
      apiKey: "planner-browser-key",
      endpoint: "https://planner.example/v1",
      model: "planner-model",
    },
    plannedQuestions: [{
      id: "stale",
      prompt: "Potentially merged question",
      focus: "Old preview",
      follow_up_prompt: "Old follow-up",
      allocated_seconds: 600,
    }],
  });

  const loaded = loadPracticePlan();

  assert.equal(loaded.planFormatVersion, 4);
  assert.deepEqual(loaded.plannedQuestions, []);
  assert.equal(loaded.liveApis.google.apiKey, "google-browser-key");
  assert.equal(loaded.plannerApi.apiKey, "planner-browser-key");
});

test("version 4 keeps a preview generated with verified source mapping", () => {
  installStoredPlan({
    ...defaultPracticePlan,
    plannedQuestions: [{
      id: "verified",
      prompt: "Exact source question",
      focus: "Verified preview",
      follow_up_prompt: "Verified follow-up",
      allocated_seconds: 600,
    }],
  });

  const loaded = loadPracticePlan();

  assert.equal(loaded.plannedQuestions.length, 1);
  assert.equal(loaded.plannedQuestions[0].prompt, "Exact source question");
});
