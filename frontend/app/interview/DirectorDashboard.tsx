import type {
  DirectorTelemetry,
  InterviewEvent,
} from "../../lib/telemetry/eventLogger";
import type { DirectorSession } from "./interviewSession";

type DirectorDashboardProps = {
  telemetry: DirectorTelemetry;
  attitude: string;
  pressure: string;
  config: DirectorSession["director_config"];
  candidateSpeakingMs: number;
  interviewerSpeakingMs: number;
  estimatedLatencyMs: number | null;
  latencyBreakdown: {
    vadCommitMs: number | null;
    turnToToolMs: number | null;
    directorRoundTripMs: number | null;
    toolToAudioMs: number | null;
  };
  questionCompletionPercentage: number;
  missingRequirements: string[];
  events: InterviewEvent[];
  canExport: boolean;
  onExport: () => void;
};

const primaryStates = ["ready", "asking", "follow_up", "completed"] as const;

export default function DirectorDashboard({
  telemetry,
  attitude,
  pressure,
  config,
  candidateSpeakingMs,
  interviewerSpeakingMs,
  estimatedLatencyMs,
  latencyBreakdown,
  questionCompletionPercentage,
  missingRequirements,
  events,
  canExport,
  onExport,
}: DirectorDashboardProps) {
  const activeState = telemetry.state.toLowerCase();
  const recentEvents = events.slice(-12).reverse();

  return (
    <section className="director-dashboard" aria-label="Visual Director Engine">
      <header className="director-dashboard-header">
        <div>
          <span>Director Engine</span>
          <strong>Live control room</strong>
        </div>
        <span className={`director-state-badge director-state-${activeState}`}>
          {formatLabel(activeState)}
        </span>
      </header>

      <div
        aria-label={`Director state is ${formatLabel(activeState)}`}
        className="director-state-map"
        role="img"
      >
        <div className="director-primary-path">
          {primaryStates.map((state, index) => (
            <div className="director-state-step" key={state}>
              <span
                aria-current={activeState === state ? "step" : undefined}
                className={activeState === state ? "is-active" : ""}
              >
                {formatLabel(state)}
              </span>
              {index < primaryStates.length - 1 ? (
                <i aria-hidden="true">→</i>
              ) : null}
            </div>
          ))}
        </div>
        <div className="director-ended-branch">
          <span aria-hidden="true">↘</span>
          <strong className={activeState === "ended" ? "is-active" : ""}>
            Ended
          </strong>
        </div>
      </div>

      <div className="director-locked-profile">
        <span>Locked session profile</span>
        <strong>
          {formatLabel(config.interviewer_style)} · {formatLabel(config.initial_pressure)}
          {" pressure · "}
          {formatReasoningDepth(config.follow_up_depth)} reasoning depth
        </strong>
        <small>
          {formatLabel(config.interruption_frequency)} interruption frequency · provider VAD with staged latency tracing
        </small>
      </div>

      <div className="director-signal-flow" aria-label="Current Director signal flow">
        <article>
          <span>Observe</span>
          <strong>{formatDuration(candidateSpeakingMs)} candidate</strong>
        </article>
        <article>
          <span>Interpret</span>
          <strong>{formatLabel(telemetry.emotion)}</strong>
        </article>
        <article>
          <span>Decide</span>
          <strong>{formatLabel(activeState)}</strong>
        </article>
        <article>
          <span>Act</span>
          <strong>{formatLabel(telemetry.gesture)}</strong>
        </article>
      </div>

      <dl className="director-live-values">
        <div>
          <dt>Question</dt>
          <dd>
            {telemetry.questionIndex < 0 ? "Not started" : telemetry.questionIndex + 1}
          </dd>
        </div>
        <div>
          <dt>Follow-ups</dt>
          <dd>{telemetry.followUpCount}</dd>
        </div>
        <div>
          <dt>Pressure</dt>
          <dd>{formatLabel(pressure)}</dd>
        </div>
        <div>
          <dt>Attitude</dt>
          <dd>{formatLabel(attitude)}</dd>
        </div>
        <div>
          <dt>Interviewer</dt>
          <dd>{formatDuration(interviewerSpeakingMs)}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{estimatedLatencyMs === null ? "Pending" : `${estimatedLatencyMs}ms`}</dd>
        </div>
        <div>
          <dt>VAD silence</dt>
          <dd>{formatLatency(latencyBreakdown.vadCommitMs)}</dd>
        </div>
        <div>
          <dt>Tool wait</dt>
          <dd>{formatLatency(latencyBreakdown.turnToToolMs)}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{formatLatency(latencyBreakdown.directorRoundTripMs)}</dd>
        </div>
        <div>
          <dt>Resume</dt>
          <dd>{formatLatency(latencyBreakdown.toolToAudioMs)}</dd>
        </div>
        <div>
          <dt>Completion</dt>
          <dd>{questionCompletionPercentage}%</dd>
        </div>
      </dl>

      <div className="director-current-question">
        <span>Current question</span>
        <p>{telemetry.currentQuestion ?? "Waiting for the interview to start."}</p>
        {missingRequirements.length ? (
          <small>Missing: {missingRequirements.join(" · ")}</small>
        ) : null}
      </div>

      {telemetry.whiteboardAction ? (
        <div className="director-active-cues">
          {telemetry.whiteboardAction ? (
            <p>
              <span>Whiteboard</span>
              {formatLabel(telemetry.whiteboardAction)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="director-timeline-heading">
        <strong>Decision timeline</strong>
        <button disabled={!canExport} onClick={onExport} type="button">
          Export JSON
        </button>
      </div>
      <ol className="director-timeline">
        {recentEvents.length ? (
          recentEvents.map((event) => (
            <li data-source={event.source} key={event.id}>
              <time>{formatDuration(event.elapsedMs)}</time>
              <span>{formatLabel(event.type)}</span>
              <em>{event.source}</em>
            </li>
          ))
        ) : (
          <li className="director-timeline-empty">No decisions recorded yet.</li>
        )}
      </ol>
    </section>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatLatency(latencyMs: number | null): string {
  return latencyMs === null ? "—" : `${latencyMs}ms`;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function formatReasoningDepth(value: string): string {
  return { light: "low", standard: "medium", deep: "high" }[value] ?? value;
}
