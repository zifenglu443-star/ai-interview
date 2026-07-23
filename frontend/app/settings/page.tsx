"use client";

import { type FormEvent, useEffect, useState } from "react";

import AppNav from "../components/AppNav";
import {
  getApiErrorMessage,
  type ApiErrorPayload,
} from "./configurationError";

type ProviderStatus = {
  ready: boolean;
  model: string;
};

type ConfigurationStatus = {
  openai: ProviderStatus;
  google: ProviderStatus;
  planner: ProviderStatus;
};

type ProviderId = keyof ConfigurationStatus;

type ProviderDraft = {
  apiKey: string;
  endpoint: string;
  model: string;
};

const providers: Array<{
  id: ProviderId;
  label: string;
  environment: string;
  helpUrl: string;
}> = [
  {
    id: "openai",
    label: "OpenAI Realtime",
    environment: "OPENAI_API_KEY",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    label: "Google Gemini Live",
    environment: "GOOGLE_API_KEY",
    helpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "planner",
    label: "Question planner",
    environment: "PLANNER_API_KEY",
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
];

const initialDrafts: Record<ProviderId, ProviderDraft> = {
  openai: {
    apiKey: "",
    endpoint: "",
    model: "gpt-realtime-2.1",
  },
  google: {
    apiKey: "",
    endpoint: "",
    model: "gemini-3.1-flash-live-preview",
  },
  planner: {
    apiKey: "",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
  },
};

export default function SettingsPage() {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const [status, setStatus] = useState<ConfigurationStatus | null>(null);
  const [drafts, setDrafts] =
    useState<Record<ProviderId, ProviderDraft>>(initialDrafts);
  const [loadError, setLoadError] = useState(false);
  const [savingProvider, setSavingProvider] = useState<ProviderId | null>(null);
  const [removalCandidate, setRemovalCandidate] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState<{
    provider: ProviderId;
    type: "error" | "success";
    text: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/configuration/status`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Configuration status unavailable");
        return response.json() as Promise<ConfigurationStatus>;
      })
      .then((nextStatus) => {
        setStatus(nextStatus);
        setDrafts((current) => ({
          openai: { ...current.openai, model: nextStatus.openai.model },
          google: { ...current.google, model: nextStatus.google.model },
          planner: { ...current.planner, model: nextStatus.planner.model },
        }));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(true);
        }
      });
    return () => controller.abort();
  }, [apiBase]);

  function updateDraft(
    provider: ProviderId,
    field: keyof ProviderDraft,
    value: string,
  ) {
    setDrafts((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        [field]: value,
      },
    }));
  }

  async function saveProvider(
    provider: ProviderId,
    event?: FormEvent<HTMLFormElement>,
    removeKey = false,
  ) {
    event?.preventDefault();
    setSavingProvider(provider);
    setMessage(null);
    setRemovalCandidate(null);
    const draft = drafts[provider];
    try {
      const response = await fetch(`${apiBase}/configuration/provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          api_key: removeKey || !draft.apiKey.trim() ? undefined : draft.apiKey.trim(),
          model: draft.model.trim(),
          endpoint: provider === "planner" ? draft.endpoint.trim() : undefined,
          remove_key: removeKey,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ConfigurationStatus
        | ApiErrorPayload
        | null;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload as ApiErrorPayload | null));
      }
      setStatus(payload as ConfigurationStatus);
      setDrafts((current) => ({
        ...current,
        [provider]: { ...current[provider], apiKey: "" },
      }));
      setMessage({
        provider,
        type: "success",
        text: removeKey
          ? "Saved key removed."
          : "Configuration saved. The new value is active now.",
      });
    } catch (error) {
      setMessage({
        provider,
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Configuration could not be saved.",
      });
    } finally {
      setSavingProvider(null);
    }
  }

  return (
    <main className="page-shell">
      <AppNav />
      <section className="configuration-layout">
        <header className="configuration-header">
          <p className="eyebrow">Local API settings</p>
          <h1>Connect the interview models.</h1>
          <p>
            Keys are sent only to the backend running on this computer and saved
            in the project <code>.env</code>. They are never stored in the
            browser or returned by the API.
          </p>
        </header>

        {loadError ? (
          <p className="error-message" role="alert">
            The local backend is unavailable. Start the one-click launcher and reload this page.
          </p>
        ) : null}

        <div className="provider-settings-list">
          {providers.map((provider) => {
            const providerStatus = status?.[provider.id];
            const draft = drafts[provider.id];
            const isSaving = savingProvider === provider.id;
            return (
              <form
                className="provider-settings"
                key={provider.id}
                onSubmit={(event) => void saveProvider(provider.id, event)}
              >
                <div className="provider-settings-heading">
                  <div>
                    <h2>{provider.label}</h2>
                    <span
                      className={
                        providerStatus?.ready
                          ? "provider-ready"
                          : "provider-not-ready"
                      }
                    >
                      {providerStatus
                        ? providerStatus.ready
                          ? "Configured"
                          : "Not configured"
                        : "Checking..."}
                    </span>
                  </div>
                  <a href={provider.helpUrl} rel="noreferrer" target="_blank">
                    Get API key
                  </a>
                </div>

                <div className="provider-fields">
                  <label>
                    API key
                    <input
                      autoComplete="new-password"
                      disabled={isSaving}
                      maxLength={512}
                      minLength={8}
                      onChange={(event) =>
                        updateDraft(provider.id, "apiKey", event.target.value)
                      }
                      placeholder={
                        providerStatus?.ready
                          ? "Leave blank to keep the saved key"
                          : `Paste ${provider.environment}`
                      }
                      type="password"
                      value={draft.apiKey}
                    />
                  </label>
                  <label>
                    Model
                    <input
                      disabled={isSaving}
                      maxLength={160}
                      onChange={(event) =>
                        updateDraft(provider.id, "model", event.target.value)
                      }
                      required
                      value={draft.model}
                    />
                  </label>
                  {provider.id === "planner" ? (
                    <label className="provider-endpoint-field">
                      HTTPS endpoint
                      <input
                        disabled={isSaving}
                        maxLength={500}
                        onChange={(event) =>
                          updateDraft(provider.id, "endpoint", event.target.value)
                        }
                        required
                        type="url"
                        value={draft.endpoint}
                      />
                    </label>
                  ) : null}
                </div>

                <p className="input-hint">
                  Saved in <code>.env</code> as <code>{provider.environment}</code>.
                  Existing keys are never displayed.
                </p>
                {message?.provider === provider.id ? (
                  <p
                    className={
                      message.type === "error"
                        ? "error-message"
                        : "configuration-success"
                    }
                    role="status"
                  >
                    {message.text}
                  </p>
                ) : null}
                <div className="provider-actions">
                  {providerStatus?.ready ? (
                    removalCandidate === provider.id ? (
                      <>
                        <button
                          className="danger-action"
                          disabled={isSaving}
                          onClick={() => void saveProvider(provider.id, undefined, true)}
                          type="button"
                        >
                          Confirm remove key
                        </button>
                        <button
                          className="secondary-action"
                          disabled={isSaving}
                          onClick={() => setRemovalCandidate(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-danger-action"
                        disabled={isSaving}
                        onClick={() => setRemovalCandidate(provider.id)}
                        type="button"
                      >
                        Remove saved key
                      </button>
                    )
                  ) : null}
                  <button className="primary-action" disabled={isSaving} type="submit">
                    {isSaving ? "Saving..." : "Save configuration"}
                  </button>
                </div>
              </form>
            );
          })}
        </div>
      </section>
    </main>
  );
}
