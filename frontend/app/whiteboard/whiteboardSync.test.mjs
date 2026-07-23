import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPendingWhiteboardOperation,
  calculateWhiteboardImageDifference,
  isValidWhiteboardFrame,
  isMaterialWhiteboardDifference,
  parsePendingWhiteboardOperations,
  removePendingWhiteboardOperation,
} from "./whiteboardSync.ts";

const batch = (id) => ({
  type: "apply-ai-whiteboard-ops",
  id,
  createdAt: 1,
  bounds: { x: 10, y: 20, w: 300, h: 200 },
  operations: [{ kind: "note", text: "Check this", x: 0.5, y: 0.25 }],
});

test("pending AI annotations survive until the whiteboard consumes them", () => {
  const stored = appendPendingWhiteboardOperation(null, batch("one"));
  assert.deepEqual(parsePendingWhiteboardOperations(stored), [batch("one")]);
  assert.deepEqual(parsePendingWhiteboardOperations(removePendingWhiteboardOperation(stored, "one")), []);
});

test("pending annotation queue deduplicates ids and stays bounded", () => {
  let stored = null;
  for (let index = 0; index < 25; index += 1) {
    stored = appendPendingWhiteboardOperation(stored, batch(String(index)));
  }
  stored = appendPendingWhiteboardOperation(stored, batch("24"));
  const parsed = parsePendingWhiteboardOperations(stored);
  assert.equal(parsed.length, 20);
  assert.equal(parsed.at(-1).id, "24");
  assert.equal(parsed.filter((item) => item.id === "24").length, 1);
});

test("invalid pending annotation storage is ignored", () => {
  assert.deepEqual(parsePendingWhiteboardOperations("not-json"), []);
  assert.deepEqual(parsePendingWhiteboardOperations("{}"), []);
});

test("whiteboard image comparison ignores tiny JPEG noise", () => {
  const previous = Array(100).fill(240);
  const current = [...previous];
  current[0] = 233;
  current[1] = 235;

  const difference = calculateWhiteboardImageDifference(previous, current);

  assert.equal(isMaterialWhiteboardDifference(difference), false);
  assert.equal(difference.changedPixelRatio, 0);
});

test("whiteboard image comparison detects a meaningful changed region", () => {
  const previous = Array(1000).fill(255);
  const current = [...previous];
  for (let index = 0; index < 10; index += 1) current[index] = 0;

  const difference = calculateWhiteboardImageDifference(previous, current);

  assert.equal(difference.changedPixelRatio, 0.01);
  assert.equal(isMaterialWhiteboardDifference(difference), true);
});

test("missing fingerprints upload conservatively", () => {
  assert.equal(calculateWhiteboardImageDifference(undefined, [1, 2]), null);
  assert.equal(isMaterialWhiteboardDifference(null), true);
});

test("stored whiteboard frames require a valid bounded JPEG payload", () => {
  const frame = {
    type: "whiteboard-frame",
    data: "YWJjZGVmZ2hpamtsbW5vcA==",
    mimeType: "image/jpeg",
    updatedAt: 1_000,
    width: 1280,
    height: 720,
  };

  assert.equal(isValidWhiteboardFrame(frame), true);
  assert.equal(isValidWhiteboardFrame({ ...frame, data: "not base64!" }), false);
  assert.equal(isValidWhiteboardFrame({ ...frame, width: 0 }), false);
  assert.equal(isValidWhiteboardFrame({ ...frame, height: 20_000 }), false);
});
