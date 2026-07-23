export type InterviewRecordSummary = {
  record_id: string;
  completed_at: string;
  target_role: string;
  answered_questions: number;
  total_questions: number;
  has_whiteboard: boolean;
};

export type RecordFilter = "all" | "complete" | "incomplete" | "whiteboard";
export type RecordSort = "newest" | "oldest" | "role" | "completion";

export function filterAndSortRecords(
  records: InterviewRecordSummary[],
  searchQuery: string,
  recordFilter: RecordFilter,
  recordSort: RecordSort,
  formatDate: (value: string) => string,
) {
  const query = searchQuery.trim().toLocaleLowerCase();
  const filtered = records.filter((record) => {
    const matchesQuery =
      !query ||
      [record.target_role, formatDate(record.completed_at)].some((value) =>
        value.toLocaleLowerCase().includes(query),
      );
    const isComplete =
      record.total_questions > 0 &&
      record.answered_questions >= record.total_questions;
    const matchesFilter =
      recordFilter === "all" ||
      (recordFilter === "complete" && isComplete) ||
      (recordFilter === "incomplete" && !isComplete) ||
      (recordFilter === "whiteboard" && record.has_whiteboard);
    return matchesQuery && matchesFilter;
  });

  return filtered.sort((left, right) => {
    if (recordSort === "role") {
      return left.target_role.localeCompare(right.target_role);
    }
    if (recordSort === "completion") {
      return completionRatio(right) - completionRatio(left);
    }
    const direction = recordSort === "oldest" ? 1 : -1;
    return direction * (timestamp(left.completed_at) - timestamp(right.completed_at));
  });
}

function completionRatio(record: InterviewRecordSummary) {
  if (record.total_questions <= 0) return 0;
  return record.answered_questions / record.total_questions;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
