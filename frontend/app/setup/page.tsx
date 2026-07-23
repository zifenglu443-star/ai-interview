"use client";

import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useState,
} from "react";

import AppNav from "../components/AppNav";
import {
  defaultPracticePlan,
  loadPracticePlan,
  savePracticePlan,
  type PracticePlan,
} from "../interview/practicePlan";
import SetupWizard, {
  SetupIntro,
  type SetupStep,
} from "./SetupWizard";
import { validatePlanInput } from "./setupFlow";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(1);
  const [plan, setPlan] = useState<PracticePlan>(defaultPracticePlan);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [planningSource, setPlanningSource] = useState<"provider" | null>(null);

  useEffect(() => {
    setPlan(loadPracticePlan());
  }, []);

  function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan.plannedQuestions.length) {
      setPlanningError("Generate an interview plan before entering the waiting room.");
      setStep(2);
      return;
    }
    try {
      savePracticePlan({
        ...plan,
        targetRole: plan.targetRole.trim() || defaultPracticePlan.targetRole,
        topics: plan.topics.trim(),
      });
      router.push("/interview");
    } catch {
      setPlanningError(
        "Setup could not be saved. Exit private browsing or free some browser storage, then try again.",
      );
    }
  }

  function importQuestions(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 20_000) {
      setPlanningError("Question files must be 20 KB or smaller.");
      event.target.value = "";
      return;
    }
    void file
      .text()
      .then((text) => {
        setPlanningError(null);
        setPlan((current) => ({
          ...current,
          questionBank: text,
          plannedQuestions: [],
        }));
      })
      .catch(() => setPlanningError("The selected question file could not be read."));
  }

  async function generatePlan(): Promise<boolean> {
    const validationError = validatePlanInput(plan);
    if (validationError) {
      setPlanningError(validationError);
      return false;
    }

    setIsPlanning(true);
    setPlanningError(null);
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${baseUrl}/interview/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_role: plan.targetRole.trim(),
          practice_focus: plan.focus,
          practice_topics: plan.topics.trim(),
          question_bank: plan.questionBank,
          total_duration_seconds:
            plan.directorSettings.totalDurationMinutes * 60,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(payload?.detail || "Planning request failed.");
      }
      const result = (await response.json()) as {
        provider: "provider";
        questions: PracticePlan["plannedQuestions"];
      };
      if (!result.questions.length) {
        throw new Error("The planner returned no questions.");
      }
      setPlan((current) => ({
        ...current,
        plannedQuestions: result.questions,
      }));
      setPlanningSource(result.provider);
      return true;
    } catch (error) {
      setPlanningError(
        error instanceof Error
          ? error.message
          : "The interview plan could not be generated.",
      );
      return false;
    } finally {
      setIsPlanning(false);
    }
  }

  async function continueToPlanReview() {
    if (await generatePlan()) {
      setStep(3);
    }
  }

  return (
    <main className="page-shell">
      <AppNav />
      <section className="setup-layout">
        <SetupIntro step={step} />
        <form className="setup-form" onSubmit={submitSetup}>
          <SetupWizard
            isPlanning={isPlanning}
            onContinueToReview={continueToPlanReview}
            onGeneratePlan={generatePlan}
            onImportQuestions={importQuestions}
            plan={plan}
            planningError={planningError}
            planningSource={planningSource}
            setPlan={setPlan}
            setStep={setStep}
            step={step}
          />
        </form>
      </section>
    </main>
  );
}
