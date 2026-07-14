"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  interviewStorageKey,
  type InterviewReport,
} from "../interview/interviewSession";
import { evaluateReport, type ReportScores } from "./evaluator";

export default function ReportPage() {
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [scores, setScores] = useState<ReportScores | null>(null);
  const [scoreError, setScoreError] = useState(false);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

  useEffect(() => {
    const savedReport = window.localStorage.getItem(interviewStorageKey);

    if (!savedReport) return;
    try {
      const parsed = JSON.parse(savedReport) as InterviewReport;
      if (!parsed.completedAt || !Array.isArray(parsed.answers)) throw new Error("Invalid report");
      setReport(parsed);
    } catch {
      window.localStorage.removeItem(interviewStorageKey);
    }
  }, []);

  useEffect(() => {
    if (!report) return;
    let active = true;
    setScoreError(false);
    evaluateReport(apiBase, report.answers, report.totalQuestions)
      .then((result) => {
        if (active) setScores(result);
      })
      .catch(() => {
        if (active) setScoreError(true);
      });
    return () => {
      active = false;
    };
  }, [apiBase, report]);

  const completedAt = report
    ? isValidDate(report.completedAt)
      ? new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(report.completedAt))
      : "an unknown time"
    : null;

  return (
    <main className="page-shell">
      <nav className="topbar" aria-label="Report navigation">
        <Link href="/">AI Interview Simulator</Link>
        <Link href="/reports">Interview history</Link>
      </nav>

      <section className="report-layout">
        <div>
          <p className="eyebrow">Session report</p>
          <h1>{report ? "Interview complete" : "Interview report"}</h1>
          <p className="report-intro">
            {report
              ? `Completed ${completedAt}. This report summarizes scores and suggestions from the completed interview.`
              : "Complete an interview first to generate your report."}
          </p>
        </div>

        <div className="report-grid">
          <article>
            <span>Overall</span>
            <strong>{scores ? `${scores.overall}` : scoreError ? "Unavailable" : "Pending"}</strong>
          </article>
          <article>
            <span>Reasoning depth</span>
            <strong>{scores ? `${scores.reasoning_depth}` : scoreError ? "Unavailable" : "Pending"}</strong>
          </article>
          <article>
            <span>Questions</span>
            <strong>
              {report
                ? `${report.answeredQuestions}/${report.totalQuestions}`
                : "0/5"}
            </strong>
          </article>
        </div>

        {scores ? (
          <section className="score-breakdown">
            <article>
              <span>Clarity</span>
              <strong>{scores.clarity}</strong>
            </article>
            <article>
              <span>Specificity</span>
              <strong>{scores.specificity}</strong>
            </article>
            <article>
              <span>Completion</span>
              <strong>{scores.completion}</strong>
            </article>
          </section>
        ) : null}

        {scores ? (
          <p className="score-disclaimer">
            {scores.rubric_version ?? "Local rubric"}. These practice indicators are based on visible answer structure and evidence. They do not verify technical correctness or replace human judgment.
          </p>
        ) : null}

        {scoreError ? (
          <p className="error-message">Scores are unavailable while the local backend is offline. Your answers remain saved.</p>
        ) : null}

        {scores ? (
          <section className="answer-summary">
            <h2>Suggestions</h2>
            {scores.suggestions.map((suggestion) => (
              <article key={suggestion}>
                <p>{suggestion}</p>
              </article>
            ))}
          </section>
        ) : null}

        {report ? (
          <section className="answer-summary">
            <h2>Submitted answers</h2>
            {report.answers.map((answer) => (
              <article key={answer.questionId}>
                <h3>{answer.question}</h3>
                <p>{answer.answer || "Skipped"}</p>
              </article>
            ))}
          </section>
        ) : null}

        {report?.realtimeTranscript?.length ? (
          <section className="answer-summary">
            <h2>Realtime transcript</h2>
            {report.realtimeTranscript.map((item) => (
              <article key={item.id}>
                <h3>{item.speaker}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </section>
        ) : null}

        {report?.plan?.length ? (
          <section className="answer-summary report-plan">
            <h2>Interview plan</h2>
            {report.plan.map((question, index) => (
              <article key={question.id}>
                <span>Question {index + 1} · {formatDuration(question.allocated_seconds)} · {question.focus}</span>
                <p>{question.prompt}</p>
              </article>
            ))}
          </section>
        ) : null}

        <div className="report-actions">
          <Link className="primary-action" href="/setup">
            New interview
          </Link>
          <Link className="secondary-action" href="/reports">Interview history</Link>
        </div>
      </section>
    </main>
  );
}

function formatDuration(seconds: number) {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds}s`;
}

function isValidDate(value: string) {
  return Number.isFinite(new Date(value).getTime());
}
