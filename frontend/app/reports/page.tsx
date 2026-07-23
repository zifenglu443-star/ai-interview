"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppNav from "../components/AppNav";
import {
  filterAndSortRecords,
  type InterviewRecordSummary,
  type RecordFilter,
  type RecordSort,
} from "./reportHistory";

export default function ReportsPage() {
  const [records, setRecords] = useState<InterviewRecordSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [recordFilter, setRecordFilter] = useState<RecordFilter>("all");
  const [recordSort, setRecordSort] = useState<RecordSort>("newest");
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

  useEffect(() => {
    fetch(`${apiBase}/interview/records`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load reports");
        return response.json() as Promise<InterviewRecordSummary[]>;
      })
      .then(setRecords)
      .catch(() => setError("Reports could not be loaded. Start the Python backend first."))
      .finally(() => setIsLoading(false));
  }, [apiBase]);

  const filteredRecords = useMemo(() => {
    return filterAndSortRecords(
      records,
      searchQuery,
      recordFilter,
      recordSort,
      formatDate,
    );
  }, [recordFilter, recordSort, records, searchQuery]);

  async function deleteRecord(recordId: string) {
    setDeletingRecordId(recordId);
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/interview/records/${encodeURIComponent(recordId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not delete report");
      setRecords((current) => current.filter((record) => record.record_id !== recordId));
      setDeleteCandidateId(null);
    } catch {
      setError("This local report could not be deleted. Check that the backend is running and try again.");
    } finally {
      setDeletingRecordId(null);
    }
  }

  return (
    <main className="page-shell">
      <AppNav />
      <section className="report-layout">
        <div>
          <p className="eyebrow">Interview history</p>
          <h1>All reports</h1>
          <p className="report-intro">Open a completed interview to review its feedback, conversation, and whiteboard.</p>
        </div>
        {error ? <p aria-live="polite" className="error-message">{error}</p> : null}
        {isLoading ? <p aria-live="polite" className="report-intro">Loading local reports…</p> : null}
        {records.length ? (
          <div className="report-filters" role="search">
            <label>
              Search reports
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Role or completion date"
                type="search"
                value={searchQuery}
              />
            </label>
            <label>
              Show
              <select
                onChange={(event) => setRecordFilter(event.target.value as typeof recordFilter)}
                value={recordFilter}
              >
                <option value="all">All reports</option>
                <option value="complete">All questions answered</option>
                <option value="incomplete">Some questions unanswered</option>
                <option value="whiteboard">With whiteboard</option>
              </select>
            </label>
            <label>
              Sort
              <select
                onChange={(event) => setRecordSort(event.target.value as RecordSort)}
                value={recordSort}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="role">Role A-Z</option>
                <option value="completion">Most complete</option>
              </select>
            </label>
          </div>
        ) : null}
        {records.length ? (
          <section className="answer-summary">
            {filteredRecords.map((record) => {
              const accessibleName = `${record.target_role || "Interview practice"}, ${formatDate(record.completed_at)}`;
              return (
              <article className="report-record-row" key={record.record_id}>
                <Link className="report-record-link" href={`/reports/${record.record_id}`}>
                  <div>
                    <h2>{record.target_role || "Interview practice"}</h2>
                    <p>{formatDate(record.completed_at)}</p>
                  </div>
                  <span>{record.answered_questions}/{record.total_questions} answered{record.has_whiteboard ? " · Whiteboard saved" : ""}</span>
                </Link>
                <div className="report-record-actions">
                  {deleteCandidateId === record.record_id ? (
                    <>
                      <button
                        aria-label={`Confirm deletion of ${accessibleName}`}
                        className="danger-action"
                        disabled={deletingRecordId === record.record_id}
                        onClick={() => void deleteRecord(record.record_id)}
                        type="button"
                      >
                        {deletingRecordId === record.record_id ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button
                        aria-label={`Cancel deletion of ${accessibleName}`}
                        className="secondary-action"
                        disabled={deletingRecordId === record.record_id}
                        onClick={() => setDeleteCandidateId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      aria-label={`Delete ${accessibleName}`}
                      className="text-danger-action"
                      onClick={() => setDeleteCandidateId(record.record_id)}
                      type="button"
                    >
                      Delete local report
                    </button>
                  )}
                </div>
              </article>
              );
            })}
            {!filteredRecords.length ? <p aria-live="polite">No reports match these filters.</p> : null}
          </section>
        ) : !error && !isLoading ? <p className="report-intro">No completed interviews yet.</p> : null}
      </section>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown completion time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
