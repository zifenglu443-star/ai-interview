import assert from "node:assert/strict";
import test from "node:test";

import { filterAndSortRecords } from "./reportHistory.ts";

const records = [
  {
    record_id: "older-complete",
    completed_at: "2026-07-20T10:00:00Z",
    target_role: "Backend engineer",
    answered_questions: 4,
    total_questions: 4,
    has_whiteboard: false,
  },
  {
    record_id: "newer-incomplete",
    completed_at: "2026-07-22T10:00:00Z",
    target_role: "Frontend engineer",
    answered_questions: 2,
    total_questions: 4,
    has_whiteboard: true,
  },
];

const formatDate = (value) => value.slice(0, 10);

test("history filtering distinguishes complete records and whiteboards", () => {
  assert.deepEqual(
    filterAndSortRecords(records, "", "complete", "newest", formatDate).map(
      (record) => record.record_id,
    ),
    ["older-complete"],
  );
  assert.deepEqual(
    filterAndSortRecords(records, "", "whiteboard", "newest", formatDate).map(
      (record) => record.record_id,
    ),
    ["newer-incomplete"],
  );
});

test("history search includes role and formatted date", () => {
  assert.deepEqual(
    filterAndSortRecords(records, "2026-07-20", "all", "newest", formatDate).map(
      (record) => record.record_id,
    ),
    ["older-complete"],
  );
  assert.deepEqual(
    filterAndSortRecords(records, "frontEND", "all", "newest", formatDate).map(
      (record) => record.record_id,
    ),
    ["newer-incomplete"],
  );
});

test("history supports date, role, and completion sorting", () => {
  assert.deepEqual(
    filterAndSortRecords(records, "", "all", "oldest", formatDate).map(
      (record) => record.record_id,
    ),
    ["older-complete", "newer-incomplete"],
  );
  assert.deepEqual(
    filterAndSortRecords(records, "", "all", "completion", formatDate).map(
      (record) => record.record_id,
    ),
    ["older-complete", "newer-incomplete"],
  );
});
