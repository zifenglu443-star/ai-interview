import assert from "node:assert/strict";
import test from "node:test";

import { getApiErrorMessage } from "./configurationError.ts";

test("configuration errors preserve simple backend messages", () => {
  assert.equal(
    getApiErrorMessage({ detail: "Only local configuration is allowed." }),
    "Only local configuration is allowed.",
  );
});

test("configuration errors flatten validation details", () => {
  assert.equal(
    getApiErrorMessage({
      detail: [
        { msg: "API key must contain at least 8 characters." },
        { msg: "Planner endpoint must use HTTPS." },
      ],
    }),
    "API key must contain at least 8 characters. Planner endpoint must use HTTPS.",
  );
});

test("configuration errors use a stable fallback", () => {
  assert.equal(getApiErrorMessage(null), "Configuration could not be saved.");
  assert.equal(
    getApiErrorMessage({ detail: [{}] }),
    "Configuration could not be saved.",
  );
});
