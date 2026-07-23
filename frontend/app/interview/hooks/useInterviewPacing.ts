"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DirectorSession } from "../interviewSession";

type InterviewPacingOptions = {
  isInterviewActive: boolean;
  onInterviewOver: () => void;
  onPaceInstruction: (instruction: string) => void;
  session: DirectorSession | null;
};

export function calculateQuestionPacingBudget(
  allocatedSeconds: number,
  totalSeconds: number,
  remainingQuestionCount: number,
  plannedElapsedBeforeQuestion: number,
  elapsedSeconds: number,
) {
  const safeRemainingQuestionCount = Math.max(remainingQuestionCount, 1);
  const plannedBudget = Math.max(
    15,
    allocatedSeconds || Math.floor(totalSeconds / safeRemainingQuestionCount),
  );
  if (elapsedSeconds <= plannedElapsedBeforeQuestion) return plannedBudget;

  const remainingSeconds = Math.max(totalSeconds - elapsedSeconds, 0);
  const fairShare = Math.max(
    15,
    Math.floor(remainingSeconds / safeRemainingQuestionCount),
  );
  return Math.min(plannedBudget, fairShare);
}

export function useInterviewPacing({
  isInterviewActive,
  onInterviewOver,
  onPaceInstruction,
  session,
}: InterviewPacingOptions) {
  const interviewClockStartedAtRef = useRef<number | null>(null);
  const questionStartedAtRef = useRef<number | null>(null);
  const paceStageRef = useRef<0 | 1 | 2>(0);
  const questionTimeExpiredRef = useRef(false);
  const questionExplanationPendingRef = useRef(false);
  const questionExplanationDeliveredRef = useRef(false);
  const endingPromptSentRef = useRef(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [interviewClockStartedAtMs, setInterviewClockStartedAtMs] =
    useState<number | null>(null);
  const callbacksRef = useRef({ onInterviewOver, onPaceInstruction });

  useEffect(() => {
    callbacksRef.current = { onInterviewOver, onPaceInstruction };
  }, [onInterviewOver, onPaceInstruction]);

  useEffect(() => {
    if (!session || !isInterviewActive || interviewClockStartedAtMs === null) {
      return;
    }
    paceStageRef.current = 0;
    questionTimeExpiredRef.current = false;
    questionExplanationPendingRef.current = false;
    questionExplanationDeliveredRef.current = false;
    const totalSeconds = session.director_config.total_duration_seconds;
    const questionCount = Math.max(session.question_plan.length, 1);
    const questionBudget = calculateQuestionPacingBudget(
      session.question_plan[session.question_index]?.allocated_seconds ?? 0,
      totalSeconds,
      questionCount - session.question_index,
      session.question_plan
        .slice(0, session.question_index)
        .reduce((sum, question) => sum + question.allocated_seconds, 0),
      Math.floor((Date.now() - interviewClockStartedAtMs) / 1000),
    );
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - interviewClockStartedAtMs) / 1000);
      const remaining = Math.max(totalSeconds - elapsed, 0);
      setRemainingSeconds(remaining);
      const questionElapsed =
        questionStartedAtRef.current === null
          ? 0
          : Math.floor((Date.now() - questionStartedAtRef.current) / 1000);
      if (
        questionElapsed >= Math.floor(questionBudget * 0.8) &&
        paceStageRef.current === 0
      ) {
        paceStageRef.current = 1;
        callbacksRef.current.onPaceInstruction(
          "Time is tightening. Ask the candidate to state their approach, key assumption, and strongest evidence concisely. Do not give them an answer.",
        );
      }
      if (questionElapsed >= questionBudget && paceStageRef.current === 1) {
        paceStageRef.current = 2;
        questionTimeExpiredRef.current = true;
        callbacksRef.current.onPaceInstruction(
          "The current question time has expired. Call report_interviewer_state with decision explain_current. After Director approval, briefly explain the correct approach and key reasoning gap for this same question without asking the next question yet. After speaking the explanation, call report_interviewer_state with decision move_on_after_explanation; only then may you ask the returned next question.",
        );
      }
      if (
        remaining <= Math.min(60, Math.floor(totalSeconds * 0.1)) &&
        !endingPromptSentRef.current
      ) {
        endingPromptSentRef.current = true;
        callbacksRef.current.onPaceInstruction(
          "The interview is nearly over. Guide the candidate to conclude with their independent approach, key tradeoff, and next step. Do not introduce a new deep question or provide an answer.",
        );
      }
      if (elapsed >= totalSeconds + 20) {
        callbacksRef.current.onInterviewOver();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    interviewClockStartedAtMs,
    isInterviewActive,
    session?.director_config.total_duration_seconds,
    session?.question_index,
    session?.question_plan,
  ]);

  const startInterviewClock = useCallback(
    (startedAtMs: number, totalDurationSeconds: number) => {
      if (interviewClockStartedAtRef.current !== null) return;
      interviewClockStartedAtRef.current = startedAtMs;
      setInterviewClockStartedAtMs(startedAtMs);
      setRemainingSeconds(totalDurationSeconds);
    },
    [],
  );

  const markQuestionStarted = useCallback((startedAtMs: number) => {
    if (questionStartedAtRef.current === null) {
      questionStartedAtRef.current = startedAtMs;
    }
  }, []);

  const resetQuestionPacing = useCallback(() => {
    questionStartedAtRef.current = null;
    paceStageRef.current = 0;
    questionTimeExpiredRef.current = false;
    questionExplanationPendingRef.current = false;
    questionExplanationDeliveredRef.current = false;
  }, []);

  const resetInterviewPacing = useCallback(() => {
    interviewClockStartedAtRef.current = null;
    endingPromptSentRef.current = false;
    setInterviewClockStartedAtMs(null);
    setRemainingSeconds(null);
    resetQuestionPacing();
  }, [resetQuestionPacing]);

  return {
    markQuestionStarted,
    questionExplanationDeliveredRef,
    questionExplanationPendingRef,
    questionTimeExpiredRef,
    remainingSeconds,
    resetInterviewPacing,
    resetQuestionPacing,
    startInterviewClock,
  };
}
