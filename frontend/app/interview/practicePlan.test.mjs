import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPracticePlan,
  loadPracticePlan,
  practicePlanStorageKey,
  savePracticePlan,
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

test("version 5 drops browser credentials and clears unverified old previews", () => {
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

  assert.equal(loaded.planFormatVersion, 5);
  assert.deepEqual(loaded.plannedQuestions, []);
  assert.equal("liveApis" in loaded, false);
  assert.equal("plannerApi" in loaded, false);
});

test("version 5 keeps a preview generated with verified source mapping", () => {
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

test("saving a plan uses an allowlist and never persists legacy credentials", () => {
  let savedValue = "";
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem(key, value) {
        assert.equal(key, practicePlanStorageKey);
        savedValue = value;
      },
    },
  };

  savePracticePlan({
    ...defaultPracticePlan,
    apiKey: "legacy-key",
    liveApis: { google: { apiKey: "legacy-key" } },
  });

  assert.equal(savedValue.includes("legacy-key"), false);
  assert.equal(JSON.parse(savedValue).planFormatVersion, 5);
});
