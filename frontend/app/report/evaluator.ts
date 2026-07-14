import type { InterviewAnswer } from "../interview/interviewSession";

export type ReportScores = {
  rubric_version?: string;
  clarity: number;
  specificity: number;
  reasoning_depth: number;
  completion: number;
  overall: number;
  suggestions: string[];
};

/** The Python evaluator is the single scoring authority for every report view. */
export async function evaluateReport(
  apiBase: string,
  answers: InterviewAnswer[],
  totalQuestions?: number,
): Promise<ReportScores> {
  const response = await fetch(`${apiBase}/report/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers: answers.map(({ questionId, question, answer, kind }) => ({
        question_id: questionId,
        question,
        answer,
        kind: kind ?? "primary",
      })),
      total_questions: totalQuestions,
    }),
  });
  if (!response.ok) throw new Error("Could not evaluate report");
  return response.json() as Promise<ReportScores>;
}
