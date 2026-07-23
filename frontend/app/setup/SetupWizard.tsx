"use client";

import Link from "next/link";
import type {
  ChangeEvent,
  Dispatch,
  SetStateAction,
} from "react";

import {
  practiceFocusLabels,
  type FollowUpDepth,
  type InterruptionFrequency,
  type InterviewerStyle,
  type PracticeFocus,
  type PracticePlan,
  type PressureLevel,
  type VoiceProviderId,
  voiceProviderLabels,
} from "../interview/practicePlan";

export type SetupStep = 1 | 2 | 3;

type SetupWizardProps = {
  step: SetupStep;
  setStep: Dispatch<SetStateAction<SetupStep>>;
  plan: PracticePlan;
  setPlan: Dispatch<SetStateAction<PracticePlan>>;
  isPlanning: boolean;
  planningError: string | null;
  planningSource: "provider" | null;
  onImportQuestions: (event: ChangeEvent<HTMLInputElement>) => void;
  onGeneratePlan: () => Promise<boolean>;
  onContinueToReview: () => Promise<void>;
};

export function SetupIntro({ step }: { step: SetupStep }) {
  return (
    <div className="setup-copy">
      <p className="eyebrow">Session setup · Step {step} of 3</p>
      <h1>
        {step === 1
          ? "Choose the interview you want to practise."
          : step === 2
            ? "Give the planner useful question material."
            : "Review the plan before entering the room."}
      </h1>
      <p>
        {step === 1
          ? "Set the role, focus, duration, and live interviewer. You can adjust deeper interview behaviour next."
          : step === 2
            ? "Use your own questions, upload a small question file, or provide topics for the configured planner."
            : "Check question order and timing. The next screen tests your microphone, camera, network, and model readiness."}
      </p>
      <ol className="setup-steps" aria-label="Setup progress">
        <ProgressStep active={step >= 1} index={1} label="Interview basics" />
        <ProgressStep active={step >= 2} index={2} label="Questions and behaviour" />
        <ProgressStep active={step >= 3} index={3} label="Plan review" />
      </ol>
    </div>
  );
}

export default function SetupWizard({
  step,
  setStep,
  plan,
  setPlan,
  isPlanning,
  planningError,
  planningSource,
  onImportQuestions,
  onGeneratePlan,
  onContinueToReview,
}: SetupWizardProps) {
  if (step === 1) {
    return (
      <>
        <StepHeading index={1}>Interview basics</StepHeading>
        <label>
          Target role
          <input
            maxLength={120}
            name="role"
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                targetRole: event.target.value,
                plannedQuestions: [],
              }))
            }
            placeholder="Software Engineering Intern"
            required
            value={plan.targetRole}
          />
        </label>
        <label>
          Practice focus
          <select
            name="focus"
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                focus: event.target.value as PracticeFocus,
                plannedQuestions: [],
              }))
            }
            value={plan.focus}
          >
            {Object.entries(practiceFocusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interview duration
          <select
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                directorSettings: {
                  ...current.directorSettings,
                  totalDurationMinutes: Number(event.target.value) as 10 | 15 | 20 | 30,
                },
                plannedQuestions: [],
              }))
            }
            value={plan.directorSettings.totalDurationMinutes}
          >
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={20}>20 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
        </label>
        <label>
          Live interviewer
          <select
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                voiceProvider: event.target.value as VoiceProviderId,
              }))
            }
            value={plan.voiceProvider}
          >
            <option value="openai">{voiceProviderLabels.openai}</option>
            <option value="google">{voiceProviderLabels.google}</option>
          </select>
          <span className="input-hint">
            Provider secrets stay on the backend. Check readiness in{" "}
            <Link href="/settings">API settings</Link>.
          </span>
        </label>
        <button
          className="primary-action full-width"
          disabled={!plan.targetRole.trim()}
          onClick={() => setStep(2)}
          type="button"
        >
          Continue to questions
        </button>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <StepHeading index={2}>Questions and interview behaviour</StepHeading>
        <label>
          Questions or topics
          <textarea
            maxLength={20_000}
            name="topics"
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                topics: event.target.value,
                plannedQuestions: [],
              }))
            }
            placeholder={"1. Explain the architecture of my project.\n2. Ask me about binary search.\n3. Practise an internship behavioural question."}
            rows={7}
            value={plan.topics}
          />
          <span className="input-hint">
            Number complete questions. For generated questions, enter one unnumbered topic per line.
          </span>
        </label>
        <label>
          Question file
          <input
            accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
            onChange={onImportQuestions}
            type="file"
          />
          <span className="input-hint">
            {plan.questionBank.trim()
              ? "Question file loaded. It takes priority over the text above."
              : "Optional, up to 20 KB. Numbered questions and blank-separated paragraphs are preserved."}
          </span>
        </label>
        <AdvancedInterviewSettings plan={plan} setPlan={setPlan} />
        <PlanningError message={planningError} />
        <div className="setup-actions">
          <button className="secondary-action" onClick={() => setStep(1)} type="button">
            Back
          </button>
          <button
            className="primary-action"
            disabled={isPlanning}
            onClick={() => void onContinueToReview()}
            type="button"
          >
            {isPlanning ? "Generating plan..." : "Generate plan"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeading index={3}>Interview plan</StepHeading>
      <section className="plan-review" aria-live="polite">
        {plan.plannedQuestions.map((question, index) => (
          <article key={question.id}>
            <div>
              <span>Question {index + 1}</span>
              <strong>
                {Math.max(1, Math.round(question.allocated_seconds / 60))} min · {question.focus}
              </strong>
            </div>
            <p>{question.prompt}</p>
          </article>
        ))}
        {planningSource ? (
          <p className="input-hint">Generated by the configured planning provider.</p>
        ) : null}
      </section>
      <PlanningError message={planningError} />
      <div className="setup-actions">
        <button className="secondary-action" onClick={() => setStep(2)} type="button">
          Back
        </button>
        <button
          className="secondary-action"
          disabled={isPlanning}
          onClick={() => void onGeneratePlan()}
          type="button"
        >
          {isPlanning ? "Regenerating..." : "Regenerate"}
        </button>
        <button className="primary-action" type="submit">
          Enter waiting room
        </button>
      </div>
    </>
  );
}

function AdvancedInterviewSettings({
  plan,
  setPlan,
}: Pick<SetupWizardProps, "plan" | "setPlan">) {
  return (
    <details className="advanced-settings">
      <summary>Advanced interview behaviour</summary>
      <p>Control follow-up depth, pressure, and interruptions. These settings lock when the session starts.</p>
      <div className="director-setup-grid">
        <label>
          Interviewer style
          <select
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                directorSettings: {
                  ...current.directorSettings,
                  interviewerStyle: event.target.value as InterviewerStyle,
                },
              }))
            }
            value={plan.directorSettings.interviewerStyle}
          >
            <option value="friendly">Friendly</option>
            <option value="professional">Professional</option>
            <option value="strict">Strict</option>
          </select>
        </label>
        <label>
          Initial pressure
          <select
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                directorSettings: {
                  ...current.directorSettings,
                  initialPressure: event.target.value as PressureLevel,
                },
              }))
            }
            value={plan.directorSettings.initialPressure}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Expected reasoning depth
          <select
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                directorSettings: {
                  ...current.directorSettings,
                  followUpDepth: event.target.value as FollowUpDepth,
                },
              }))
            }
            value={plan.directorSettings.followUpDepth}
          >
            <option value="light">Low · answer each requested part</option>
            <option value="standard">Medium · connect every key step</option>
            <option value="deep">High · explain why the steps work</option>
          </select>
        </label>
        <label>
          Interruption frequency
          <select
            onChange={(event) =>
              setPlan((current) => ({
                ...current,
                directorSettings: {
                  ...current.directorSettings,
                  interruptionFrequency: event.target.value as InterruptionFrequency,
                },
              }))
            }
            value={plan.directorSettings.interruptionFrequency}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <label className="checkbox-row">
        <input
          checked={plan.allowAiWhiteboardAnnotations}
          onChange={(event) =>
            setPlan((current) => ({
              ...current,
              allowAiWhiteboardAnnotations: event.target.checked,
            }))
          }
          type="checkbox"
        />
        <span>
          Allow reviewed AI whiteboard annotations
          <small>Turn this off to prevent automatic shapes, highlights, and notes.</small>
        </span>
      </label>
    </details>
  );
}

function ProgressStep({
  active,
  index,
  label,
}: {
  active: boolean;
  index: number;
  label: string;
}) {
  return (
    <li className={active ? "setup-step-active" : ""}>
      <span>{index}</span>
      {label}
    </li>
  );
}

function StepHeading({
  children,
  index,
}: {
  children: string;
  index: number;
}) {
  return (
    <div className="setup-form-heading">
      <span>Step {index}</span>
      <h2>{children}</h2>
    </div>
  );
}

function PlanningError({ message }: { message: string | null }) {
  return message ? (
    <p aria-live="polite" className="error-message" role="alert">
      {message}
    </p>
  ) : null;
}
