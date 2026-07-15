"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  defaultPracticePlan,
  loadPracticePlan,
  savePracticePlan,
  type PracticePlan,
} from "../interview/practicePlan";

export default function SettingsPage() {
  const [plan, setPlan] = useState<PracticePlan>(defaultPracticePlan);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => setPlan(loadPracticePlan()), []);

  function updateLiveApi(
    provider: "openai" | "google",
    field: "apiKey" | "model",
    value: string,
  ) {
    setPlan((current) => ({
      ...current,
      liveApis: {
        ...current.liveApis,
        [provider]: { ...current.liveApis[provider], [field]: value },
      },
    }));
    setSaved(false);
    setSaveError(false);
  }

  function updatePlannerApi(
    field: "apiKey" | "endpoint" | "model",
    value: string,
  ) {
    setPlan((current) => ({
      ...current,
      plannerApi: { ...current.plannerApi, [field]: value },
    }));
    setSaved(false);
    setSaveError(false);
  }

  function save() {
    try {
      savePracticePlan(plan);
      setSaved(true);
      setSaveError(false);
    } catch {
      setSaved(false);
      setSaveError(true);
    }
  }

  return (
    <main className="page-shell">
      <nav className="topbar" aria-label="Settings navigation">
        <Link href="/">AI Interview Simulator</Link>
        <Link href="/setup">New interview</Link>
        <Link href="/reports">Interview history</Link>
      </nav>
      <section className="setup-layout">
        <div className="setup-copy">
          <p className="eyebrow">Model API settings</p>
          <h1>Configure providers once, choose one per interview.</h1>
          <p>
            These keys are stored only in this browser. Setup chooses the Live
            interviewer. The text planner is configured below and used whenever
            Setup generates an interview plan.
            For safer long-term use, prefer project environment keys because
            same-origin browser scripts can read local storage.
          </p>
        </div>
        <div className="setup-form">
          <fieldset className="director-setup-panel">
            <legend>OpenAI Realtime</legend>
            <label>
              API key
              <input
                onChange={(event) => updateLiveApi("openai", "apiKey", event.target.value)}
                placeholder="Leave blank to use OPENAI_API_KEY from .env"
                type="password"
                value={plan.liveApis.openai.apiKey}
              />
            </label>
            <label>
              Realtime model
              <input
                onChange={(event) => updateLiveApi("openai", "model", event.target.value)}
                value={plan.liveApis.openai.model}
              />
            </label>
          </fieldset>

          <fieldset className="director-setup-panel">
            <legend>Planning text model</legend>
            <p className="input-hint">Use any compatible HTTPS chat-completions endpoint. These values stay in this browser and are sent only to the local backend when a plan is generated.</p>
            <label>
              API key
              <input
                onChange={(event) => updatePlannerApi("apiKey", event.target.value)}
                placeholder="Leave blank to use PLANNER_API_KEY from .env"
                type="password"
                value={plan.plannerApi.apiKey}
              />
            </label>
            <label>
              Endpoint
              <input
                onChange={(event) => updatePlannerApi("endpoint", event.target.value)}
                placeholder="https://provider.example/v1/chat/completions"
                type="url"
                value={plan.plannerApi.endpoint}
              />
            </label>
            <label>
              Model
              <input
                onChange={(event) => updatePlannerApi("model", event.target.value)}
                placeholder="Your planning model ID"
                value={plan.plannerApi.model}
              />
            </label>
          </fieldset>

          <fieldset className="director-setup-panel">
            <legend>Google Gemini Live</legend>
            <label>
              API key
              <input
                onChange={(event) => updateLiveApi("google", "apiKey", event.target.value)}
                placeholder="Leave blank to use GOOGLE_API_KEY from .env"
                type="password"
                value={plan.liveApis.google.apiKey}
              />
            </label>
            <label>
              Live model
              <input
                onChange={(event) => updateLiveApi("google", "model", event.target.value)}
                value={plan.liveApis.google.model}
              />
            </label>
          </fieldset>

          <button className="primary-action full-width" onClick={save} type="button">
            Save API settings
          </button>
          {saved ? <p className="setup-note">Saved locally.</p> : null}
          {saveError ? <p className="error-message">Could not save in this browser. Clear local site data and try again.</p> : null}
        </div>
      </section>
    </main>
  );
}
