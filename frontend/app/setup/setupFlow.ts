import type { PracticePlan } from "../interview/practicePlan";

export function validatePlanInput(
  plan: Pick<PracticePlan, "targetRole" | "topics" | "questionBank">,
): string | null {
  if (!plan.targetRole.trim()) {
    return "Add the role you want to practise before continuing.";
  }
  if (!plan.topics.trim() && !plan.questionBank.trim()) {
    return "Add at least one topic, question, or question file.";
  }
  return null;
}

export function canStartFromWaitingRoom({
  isMicrophoneReady,
  isOnline,
  isProviderReady,
  isStarting,
}: {
  isMicrophoneReady: boolean;
  isOnline: boolean;
  isProviderReady: boolean;
  isStarting: boolean;
}): boolean {
  return isMicrophoneReady && isOnline && isProviderReady && !isStarting;
}
