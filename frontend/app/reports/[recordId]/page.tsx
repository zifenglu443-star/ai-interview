"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { evaluateReport, type ReportScores } from "../../report/evaluator";
import type { InterviewAnswer } from "../../interview/interviewSession";

type TranscriptItem = { id: string; speaker: "candidate" | "interviewer"; text: string };
type SubmittedAnswer = { interviewer: string; candidate: string; kind: string };
type ArchivedRecord = {
  record_id: string;
  has_whiteboard: boolean;
  report: {
    completed_at: string;
    total_questions: number;
    answered_questions: number;
    answers: Array<{ question_id: string; question: string; answer: string; kind?: string }>;
    practice_plan?: { target_role?: string; focus?: string; topics?: string };
    evaluation?: ReportScores;
  };
  conversation: {
    submitted_question_answers: SubmittedAnswer[];
    realtime_transcript: TranscriptItem[];
  };
  plan: {
    total_duration_seconds: number;
    questions: Array<{ id: string; prompt: string; focus: string; allocated_seconds: number }>;
  };
};

export default function ArchivedReportPage() {
  const params = useParams<{ recordId: string }>();
  const recordId = params.recordId;
  const [record, setRecord] = useState<ArchivedRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<ReportScores | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

  useEffect(() => {
    fetch(`${apiBase}/interview/records/${encodeURIComponent(recordId)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load report");
        return response.json() as Promise<ArchivedRecord>;
      })
      .then((loadedRecord) => {
        setRecord(loadedRecord);
        if (loadedRecord.report.evaluation) setScores(loadedRecord.report.evaluation);
      })
      .catch(() => setError("This report could not be found."));
  }, [apiBase, recordId]);

  const answers = useMemo<InterviewAnswer[]>(() => record?.report.answers.map((answer) => ({
    questionId: answer.question_id,
    question: answer.question,
    answer: answer.answer,
    kind: answer.kind,
  })) ?? [], [record]);
  useEffect(() => {
    if (!record || record.report.evaluation) return;
    evaluateReport(apiBase, answers, record.report.total_questions).then(setScores).catch(() => setScores(null));
  }, [answers, apiBase, record]);

  if (error) {
    return <main className="page-shell"><p className="error-message">{error}</p></main>;
  }
  if (!record) {
    return <main className="page-shell"><p className="report-intro">Loading report…</p></main>;
  }

  const plan = record.report.practice_plan;
  const transcript = record.conversation.realtime_transcript;
  const questionAnswers = record.conversation.submitted_question_answers;
  const factualCompletion = record.report.total_questions > 0
    ? Math.round((record.report.answered_questions / record.report.total_questions) * 100)
    : 0;

  return (
    <main className="page-shell printable-report">
      <nav className="topbar report-navigation" aria-label="Report navigation">
        <Link href="/">AI Interview Simulator</Link>
        <Link href="/reports">Interview history</Link>
        <Link href="/setup">New interview</Link>
      </nav>
      <section className="report-layout">
        <div>
          <p className="eyebrow">Interview feedback</p>
          <h1>{plan?.target_role || "Interview practice"}</h1>
          <p className="report-intro">Completed {formatDate(record.report.completed_at)}. This page combines the feedback report, spoken conversation, and final whiteboard.</p>
        </div>

        <div className="report-grid">
          <article><span>Overall</span><strong>{scores?.overall ?? "Pending"}</strong></article>
          <article><span>Reasoning depth</span><strong>{scores ? scores.reasoning_depth ?? "Legacy" : "Pending"}</strong></article>
          <article><span>Questions</span><strong>{record.report.answered_questions}/{record.report.total_questions}</strong></article>
        </div>

        <section className="answer-summary">
          <h2>Feedback</h2>
          <div className="score-breakdown">
            <article><span>Clarity</span><strong>{scores?.clarity ?? "Pending"}</strong></article>
            <article><span>Specificity</span><strong>{scores?.specificity ?? "Pending"}</strong></article>
            <article><span>Completion</span><strong>{factualCompletion}</strong></article>
          </div>
          {scores ? <p className="score-disclaimer">{scores.rubric_version ?? "Legacy local rubric"}. Practice indicators measure visible answer structure and evidence; they do not verify technical correctness or replace human judgment.</p> : null}
          {scores?.suggestions.map((suggestion) => <article key={suggestion}><p>{suggestion}</p></article>) ?? <p>Feedback is unavailable while the backend is offline.</p>}
        </section>

        {plan?.topics ? <section className="answer-summary"><h2>Practice topic</h2><p>{plan.topics}</p></section> : null}

        {record.plan.questions.length ? <section className="answer-summary report-plan"><h2>Interview plan</h2>{record.plan.questions.map((question, index) => (
          <article key={question.id}><span>Question {index + 1} · {formatDuration(question.allocated_seconds)} · {question.focus}</span><p>{question.prompt}</p></article>
        ))}</section> : null}

        <section className="answer-summary">
          <h2>Question and answer record</h2>
          {(questionAnswers.length ? questionAnswers : answers.map((answer) => ({ interviewer: answer.question, candidate: answer.answer, kind: answer.kind ?? "primary" }))).map((item, index) => (
            <article key={`${item.interviewer}-${index}`}>
              <h3>Interviewer</h3><p>{item.interviewer}</p>
              <h3>Candidate</h3><p>{item.candidate || "Skipped"}</p>
            </article>
          ))}
        </section>

        {transcript.length ? <section className="answer-summary"><h2>Voice conversation</h2>{transcript.map((item) => <article key={item.id}><h3>{item.speaker === "candidate" ? "Candidate" : "Interviewer"}</h3><p>{item.text}</p></article>)}</section> : null}

        {record.has_whiteboard ? <section className="answer-summary whiteboard-report"><h2>Final whiteboard</h2><img alt="Final interview whiteboard" src={`${apiBase}/interview/records/${encodeURIComponent(record.record_id)}/whiteboard`} /></section> : null}

        <div className="report-actions report-navigation">
          <button className="primary-action" onClick={() => window.print()} type="button">Export / save as PDF</button>
          <Link className="secondary-action" href="/setup">New interview</Link>
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDuration(seconds: number) {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds}s`;
}
