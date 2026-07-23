"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type {
  DirectorTelemetry,
  InterviewEvent,
} from "../../lib/telemetry/eventLogger";
import DirectorDashboard from "./DirectorDashboard";
import InterviewerAvatarVideo from "./InterviewerAvatarVideo";
import type {
  DirectorSession,
  RealtimeTranscriptItem,
  VoiceProvider,
} from "./interviewSession";
import { formatLiveControlStatus } from "./interviewRoomUtils";
import {
  practiceFocusLabels,
  type PracticePlan,
  voiceProviderLabels,
} from "./practicePlan";
import AppNav from "../components/AppNav";
import { canStartFromWaitingRoom } from "../setup/setupFlow";

type LiveControlStatus =
  | "offline"
  | "ready"
  | "evaluating"
  | "active"
  | "error";

type InterviewRoomViewProps = {
  practicePlan: PracticePlan;
  session: DirectorSession | null;
  recoverableSession: DirectorSession | null;
  isCheckingRecovery: boolean;
  isOnline: boolean;
  isInterviewActive: boolean;
  progressText: string;
  countdownText: string | null;
  isToolsOpen: boolean;
  onToolsOpenChange: (open: boolean) => void;
  liveControlStatus: LiveControlStatus;
  effectiveControl: DirectorSession["control"] | null | undefined;
  interviewerIsSpeaking: boolean;
  liveControlSignalId: number;
  displayedAttitude: string;
  displayedPressure: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  isCameraOn: boolean;
  cameraStatus: string;
  draftAnswer: string;
  onDraftAnswerChange: (answer: string) => void;
  canEditNotes: boolean;
  error: string | null;
  typedAnswerStatus: string;
  onSubmitAnswer: () => void;
  isVoiceConnected: boolean;
  participants: Array<{
    name: string;
    role: string;
    state: string;
  }>;
  selectedVoiceProviderReady: boolean;
  selectedVoiceProvider?: VoiceProvider;
  onStartVoice: () => void;
  onReconnectVoice: () => void;
  onStopVoice: () => void;
  voiceStatus: string;
  realtimeTranscript: RealtimeTranscriptItem[];
  transcript: DirectorSession["answers"];
  whiteboardSyncStatus: string;
  candidateSpeakingMs: number;
  isComplete: boolean;
  eventTimeline: InterviewEvent[];
  interviewerSpeakingMs: number;
  estimatedLatencyMs: number | null;
  latencyBreakdown: {
    vadCommitMs: number | null;
    turnToToolMs: number | null;
    directorRoundTripMs: number | null;
    toolToAudioMs: number | null;
  };
  questionCompletion: {
    percentage: number;
    missingRequirements: string[];
  };
  directorTelemetry: DirectorTelemetry;
  onExportEventTimeline: () => void;
  isMicMuted: boolean;
  isMicrophoneReady: boolean;
  microphoneLevel: number;
  onMicrophoneMutedChange: (muted: boolean) => void;
  onTestMicrophone: () => void;
  isCameraStarting: boolean;
  onToggleCamera: () => void;
  showStartButton: boolean;
  isStarting: boolean;
  onStartInterview: () => void;
  onResumeInterview: () => void;
  onDiscardRecoveredInterview: () => void;
  showEndButton: boolean;
  isEnding: boolean;
  onEndInterview: () => void;
  hasPendingArchive: boolean;
  onRetryArchive: () => void;
};

export default function InterviewRoomView(props: InterviewRoomViewProps) {
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const confirmEndButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (showEndConfirmation) confirmEndButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showEndConfirmation) setShowEndConfirmation(false);
      else if (isWhiteboardOpen) setIsWhiteboardOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isWhiteboardOpen, showEndConfirmation]);

  if (props.showStartButton) {
    return <WaitingRoom {...props} />;
  }

  return (
    <main className="interview-shell immersive-shell">
      <RoomHeader {...props} />
      <section className="meeting-content">
        <ParticipantStage {...props} />
        <RoomTools {...props} />
      </section>
      <MeetingControls
        {...props}
        onEndInterview={() => setShowEndConfirmation(true)}
        onOpenWhiteboard={() => setIsWhiteboardOpen(true)}
      />
      {props.isEnding ? (
        <div className="saving-banner" role="status">
          Saving the interview and creating its permanent archive...
        </div>
      ) : null}
      {showEndConfirmation ? (
        <div
          aria-labelledby="end-interview-title"
          aria-modal="true"
          className="confirmation-backdrop"
          role="dialog"
        >
          <section className="confirmation-dialog">
            <p className="eyebrow">End interview</p>
            <h2 id="end-interview-title">Finish and save this interview?</h2>
            <p>
              You have completed {new Set(
                props.session?.answers
                  .filter((answer) => answer.answer.trim())
                  .map((answer) => answer.question_id) ?? [],
              ).size} of {props.session?.question_plan.length ?? 0} planned questions.
              Ending now creates the report from the answers captured so far.
            </p>
            <div className="confirmation-actions">
              <button
                className="secondary-action"
                onClick={() => setShowEndConfirmation(false)}
                type="button"
              >
                Continue interview
              </button>
              <button
                className="danger-action"
                onClick={() => {
                  setShowEndConfirmation(false);
                  props.onEndInterview();
                }}
                ref={confirmEndButtonRef}
                type="button"
              >
                End and save report
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isWhiteboardOpen ? (
        <section className="embedded-whiteboard" aria-label="Interview whiteboard">
          <header>
            <div>
              <strong>Interview whiteboard</strong>
              <span>{props.whiteboardSyncStatus}</span>
            </div>
            <div>
              <Link href="/whiteboard" rel="noreferrer" target="_blank">
                Open in new tab
              </Link>
              <button
                aria-label="Close whiteboard"
                onClick={() => setIsWhiteboardOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
          </header>
          <iframe src="/whiteboard" title="Shared interview whiteboard" />
        </section>
      ) : null}
    </main>
  );
}

function WaitingRoom({
  practicePlan,
  isOnline,
  isMicrophoneReady,
  onTestMicrophone,
  voiceStatus,
  isCameraOn,
  isCameraStarting,
  cameraStatus,
  onToggleCamera,
  videoRef,
  selectedVoiceProvider,
  selectedVoiceProviderReady,
  error,
  isStarting,
  onStartInterview,
  recoverableSession,
  isCheckingRecovery,
  onResumeInterview,
  onDiscardRecoveredInterview,
}: InterviewRoomViewProps) {
  const canStart = canStartFromWaitingRoom({
    isMicrophoneReady,
    isOnline,
    isProviderReady: selectedVoiceProviderReady,
    isStarting,
  }) && !recoverableSession && !isCheckingRecovery;

  return (
    <main className="page-shell waiting-room-shell">
      <AppNav />
      <section className="waiting-room-layout">
        <div className="waiting-room-copy">
          <p className="eyebrow">Waiting room</p>
          <h1>Check the room before the interview starts.</h1>
          <p>
            Your microphone is required. Camera is optional and stays as a local
            preview until you turn it on.
          </p>
          <section className="waiting-summary" aria-label="Interview summary">
            <div>
              <span>Role</span>
              <strong>{practicePlan.targetRole}</strong>
            </div>
            <div>
              <span>Focus</span>
              <strong>{practiceFocusLabels[practicePlan.focus]}</strong>
            </div>
            <div>
              <span>Duration</span>
              <strong>{practicePlan.directorSettings.totalDurationMinutes} min</strong>
            </div>
            <div>
              <span>Questions</span>
              <strong>{practicePlan.plannedQuestions.length}</strong>
            </div>
          </section>
        </div>

        <section className="device-check-panel" aria-label="Device checks">
          <div className="setup-form-heading">
            <span>Preflight checks</span>
            <h2>Ready to join?</h2>
          </div>
          {isCheckingRecovery ? (
            <p className="recovery-status" role="status">
              Checking for an unfinished interview...
            </p>
          ) : null}
          {recoverableSession ? (
            <section className="resume-interview-panel">
              <div>
                <strong>Unfinished interview found</strong>
                <p>
                  Question {recoverableSession.question_index + 1} of{" "}
                  {recoverableSession.question_plan.length}. Restore the Director
                  progress, then reconnect voice.
                </p>
              </div>
              <div>
                <button
                  className="primary-action"
                  onClick={onResumeInterview}
                  type="button"
                >
                  Resume interview
                </button>
                <button
                  className="secondary-action"
                  onClick={onDiscardRecoveredInterview}
                  type="button"
                >
                  Start a new interview
                </button>
              </div>
            </section>
          ) : null}
          <DeviceCheck
            actionLabel={isMicrophoneReady ? "Test again" : "Test microphone"}
            detail={isMicrophoneReady ? "Audio input is available." : voiceStatus}
            label="Microphone"
            onAction={onTestMicrophone}
            status={isMicrophoneReady ? "ready" : "required"}
          />
          <div className="camera-device-check">
            <div className="waiting-camera-preview">
              <video
                aria-label="Camera preview"
                autoPlay
                className={isCameraOn ? "candidate-video" : "camera-preview-hidden"}
                muted
                playsInline
                ref={videoRef}
              />
              {!isCameraOn ? <span>Camera preview</span> : null}
            </div>
            <DeviceCheck
              actionLabel={
                isCameraStarting
                  ? "Opening..."
                  : isCameraOn
                    ? "Turn off"
                    : "Test camera"
              }
              detail={cameraStatus}
              disabled={isCameraStarting}
              label="Camera"
              onAction={onToggleCamera}
              status={isCameraOn ? "ready" : "optional"}
            />
          </div>
          <DeviceCheck
            detail={isOnline ? "Local services can use the network." : "Reconnect before starting."}
            label="Network"
            status={isOnline ? "ready" : "blocked"}
          />
          <DeviceCheck
            detail={
              selectedVoiceProviderReady
                ? `${selectedVoiceProvider?.label ?? "Selected provider"} is configured.`
                : "Open API settings and finish the selected provider setup."
            }
            label="Live interviewer"
            status={selectedVoiceProviderReady ? "ready" : "blocked"}
          />
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <div className="waiting-room-actions">
            <Link className="secondary-action" href="/setup">
              Back to setup
            </Link>
            <button
              className="primary-action"
              disabled={!canStart}
              onClick={onStartInterview}
              type="button"
            >
              {isStarting ? "Starting interview..." : "Start interview"}
            </button>
          </div>
          {!canStart && !isStarting && !recoverableSession && !isCheckingRecovery ? (
            <p className="input-hint waiting-requirement">
              Complete the microphone, network, and live interviewer checks to continue.
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function DeviceCheck({
  actionLabel,
  detail,
  disabled = false,
  label,
  onAction,
  status,
}: {
  actionLabel?: string;
  detail: string;
  disabled?: boolean;
  label: string;
  onAction?: () => void;
  status: "ready" | "required" | "optional" | "blocked";
}) {
  return (
    <article className="device-check">
      <span aria-hidden="true" className={`device-status device-status-${status}`} />
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
      {actionLabel && onAction ? (
        <button
          className="secondary-action"
          disabled={disabled}
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : (
        <span className="device-check-label">{status}</span>
      )}
    </article>
  );
}

function RoomHeader({
  practicePlan,
  isOnline,
  isInterviewActive,
  session,
  progressText,
  countdownText,
  isToolsOpen,
  onToolsOpenChange,
}: InterviewRoomViewProps) {
  return (
    <header className="meeting-topbar">
      <div>
        <Link className="meeting-brand" href="/">
          AI Interview Simulator
        </Link>
        <span>{practiceFocusLabels[practicePlan.focus]} · Voice + transcript</span>
        {!isOnline ? <span className="error-message"> · Offline</span> : null}
      </div>
      <div className="meeting-meta">
        <span className="recording-pill">
          <span
            className={`recording-dot ${isInterviewActive ? "" : "recording-dot-idle"}`}
          />
          State {session?.state ?? "ready"} · Question {progressText}
          {countdownText ? ` · ${countdownText}` : ""}
        </span>
        <button
          aria-controls="meeting-tools"
          aria-expanded={isToolsOpen}
          className="meeting-tools-trigger"
          onClick={() => onToolsOpenChange(!isToolsOpen)}
          type="button"
        >
          {isToolsOpen ? "Close tools" : "Room tools"}
        </button>
        <Link href="/setup">Setup</Link>
      </div>
    </header>
  );
}

function ParticipantStage({
  liveControlStatus,
  effectiveControl,
  interviewerIsSpeaking,
  liveControlSignalId,
  displayedAttitude,
  displayedPressure,
  videoRef,
  isCameraOn,
  cameraStatus,
  draftAnswer,
  isInterviewActive,
  progressText,
  session,
  canEditNotes,
  onDraftAnswerChange,
  error,
  typedAnswerStatus,
  onSubmitAnswer,
  isVoiceConnected,
  isOnline,
  voiceStatus,
  onReconnectVoice,
  realtimeTranscript,
}: InterviewRoomViewProps) {
  const signalLabel = formatLiveControlStatus(liveControlStatus);
  const interviewerStatus = interviewerIsSpeaking
    ? "Interviewer speaking"
    : liveControlStatus === "evaluating"
      ? "Interviewer thinking"
      : isInterviewActive
        ? "Listening for your answer"
        : "Ready";
  const showConnectionBanner =
    !isOnline ||
    (!isVoiceConnected && isInterviewActive) ||
    ["reconnect", "interrupted", "failed", "error"].some((marker) =>
      voiceStatus.toLowerCase().includes(marker),
    );
  const currentCaption = realtimeTranscript[0];

  return (
    <section className="meeting-stage" aria-label="Interview video stage">
      {showConnectionBanner ? (
        <div
          className={`connection-banner ${!isOnline ? "connection-banner-error" : ""}`}
          role="status"
        >
          <div>
            <strong>{!isOnline ? "Network connection lost" : "Voice connection interrupted"}</strong>
            <span>{voiceStatus}</span>
          </div>
          {isOnline ? (
            <button onClick={onReconnectVoice} type="button">
              Reconnect voice
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="meeting-main-grid">
        <section className="interviewer-tile">
          <div
            aria-label={signalLabel}
            className={`interviewer-signal interviewer-signal-${liveControlStatus}`}
            role="status"
            title={signalLabel}
          >
            <span aria-hidden="true" />
          </div>
          <div className="interviewer-video-area">
            <InterviewerAvatarVideo
              emotion={effectiveControl?.emotion ?? "neutral"}
              gesture={effectiveControl?.gesture ?? "idle"}
              isSpeaking={interviewerIsSpeaking}
              signalId={liveControlSignalId}
            />
          </div>
          <div className="nameplate">
            <strong>AI Interviewer</strong>
            <span>{interviewerStatus}</span>
          </div>
        </section>

        <section className="candidate-tile">
          <video
            aria-label="Your local camera preview"
            autoPlay
            className={isCameraOn ? "candidate-video" : "camera-preview-hidden"}
            controls={false}
            controlsList="nodownload nofullscreen noplaybackrate noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            muted
            playsInline
            ref={videoRef}
          />
          {!isCameraOn ? <div className="candidate-empty">You</div> : null}
          <div className="candidate-nameplate">
            <strong>You</strong>
            <span>
              {!isCameraOn
                ? cameraStatus
                : draftAnswer.trim()
                  ? "Answer drafted"
                  : isInterviewActive
                    ? "Camera on"
                    : "Local preview"}
            </span>
          </div>
        </section>

        <section className="stage-answer-panel" aria-label="Answer notes">
          <div className="panel-heading">
            <h2>Typed backup answer</h2>
            <span>{progressText}</span>
          </div>
          <p className="current-question-prompt">
            {session?.current_prompt ??
              "Start the interview to receive the first question."}
          </p>
          <textarea
            aria-label="Answer the current interview question"
            disabled={!canEditNotes}
            onChange={(event) => onDraftAnswerChange(event.target.value)}
            placeholder="Use this if voice recognition is unclear or you prefer to type."
            value={draftAnswer}
          />
          {error ? <p className="director-error">{error}</p> : null}
          {typedAnswerStatus ? <p>{typedAnswerStatus}</p> : null}
          <button
            className="answer-submit"
            disabled={!canEditNotes || !draftAnswer.trim()}
            onClick={onSubmitAnswer}
            type="button"
          >
            {isVoiceConnected ? "Send typed answer" : "Save as transcript note"}
          </button>
        </section>

        <section className="interview-status-panel" aria-label="Interview status">
          <span className="status-panel-label">Interviewer signals</span>
          <div className="status-cards">
            <article>
              <span>Session</span>
              <strong>{isInterviewActive ? "Live" : "Ready"}</strong>
            </article>
            <article>
              <span>Reaction</span>
              <strong>{effectiveControl?.emotion ?? "Neutral"}</strong>
            </article>
            <article>
              <span>Pressure</span>
              <strong>{displayedPressure}</strong>
            </article>
          </div>
        </section>
      </div>
      {currentCaption ? (
        <div
          aria-live="polite"
          className={`live-caption live-caption-${currentCaption.speaker}`}
        >
          <strong>
            {currentCaption.speaker === "interviewer" ? "Interviewer" : "You"}
          </strong>
          <span>{currentCaption.text}</span>
        </div>
      ) : null}
    </section>
  );
}

function RoomTools(props: InterviewRoomViewProps) {
  const {
    isToolsOpen,
    onToolsOpenChange,
    participants,
    practicePlan,
    selectedVoiceProviderReady,
    selectedVoiceProvider,
    isInterviewActive,
    isVoiceConnected,
    onStartVoice,
    onStopVoice,
    voiceStatus,
    realtimeTranscript,
    transcript,
    whiteboardSyncStatus,
    displayedAttitude,
    candidateSpeakingMs,
    isComplete,
    session,
    estimatedLatencyMs,
    eventTimeline,
    interviewerSpeakingMs,
    latencyBreakdown,
    questionCompletion,
    onExportEventTimeline,
    displayedPressure,
    directorTelemetry,
  } = props;
  return (
    <aside
      aria-hidden={!isToolsOpen}
      aria-label="Meeting tools"
      className={`meeting-side-panel ${isToolsOpen ? "meeting-side-panel-open" : ""}`}
      id="meeting-tools"
    >
      <div className="meeting-tools-header">
        <strong>Interview tools</strong>
        <button
          aria-label="Close interview tools"
          onClick={() => onToolsOpenChange(false)}
          type="button"
        >
          ×
        </button>
      </div>
      <section>
        <div className="panel-heading">
          <h2>Participants</h2>
          <span>2</span>
        </div>
        <div className="participant-list">
          {participants.map((participant) => (
            <div className="participant-row" key={participant.name}>
              <div className="mini-avatar">{participant.name.slice(0, 2)}</div>
              <div>
                <strong>{participant.name}</strong>
                <span>{participant.role}</span>
              </div>
              <em>{participant.state}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="practice-plan-panel">
        <div className="panel-heading">
          <h2>Today&apos;s focus</h2>
          <Link href="/setup">Edit</Link>
        </div>
        <strong>{practiceFocusLabels[practicePlan.focus]}</strong>
        <p>{practicePlan.targetRole}</p>
        {practicePlan.topics ? <p>{practicePlan.topics}</p> : null}
      </section>

      <section className="voice-panel">
        <div className="panel-heading">
          <h2>Interview voice</h2>
          <span>{selectedVoiceProviderReady ? "ready" : "setup"}</span>
        </div>
        <strong className="locked-provider-name">
          {selectedVoiceProvider?.label ??
            voiceProviderLabels[practicePlan.voiceProvider]}
        </strong>
        <p>
          Chosen before the interview. End this session before changing the
          voice model.
        </p>
        <div className="voice-actions">
          <button
            className="answer-submit"
            disabled={!isInterviewActive || isVoiceConnected}
            onClick={onStartVoice}
            type="button"
          >
            Start voice
          </button>
          <button
            className="voice-stop"
            disabled={!isVoiceConnected}
            onClick={onStopVoice}
            type="button"
          >
            Stop
          </button>
        </div>
        <p className="voice-status">{voiceStatus}</p>
      </section>

      <section className="meeting-notes">
        <div className="panel-heading">
          <h2>Realtime transcript</h2>
          <span>{realtimeTranscript.length}</span>
        </div>
        {realtimeTranscript.length ? (
          <div className="transcript-list">
            {realtimeTranscript.map((item) => (
              <article key={item.id}>
                <strong>{item.speaker}</strong>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        ) : transcript.length ? (
          <div className="transcript-list">
            {transcript.map((answer) => (
              <article key={`${answer.question_id}-${answer.kind}`}>
                <strong>{answer.question}</strong>
                <p>{answer.answer || "Skipped"}</p>
              </article>
            ))}
          </div>
        ) : (
          <p>No answers submitted yet.</p>
        )}
      </section>
      <section className="whiteboard-live-status">
        <span className="live-dot" />
        {whiteboardSyncStatus}
      </section>
      <DirectorDashboard
        attitude={displayedAttitude}
        candidateSpeakingMs={candidateSpeakingMs}
        canExport={Boolean(
          isComplete ||
            session?.state === "completed" ||
            session?.state === "ended"
        )}
        config={
          session?.director_config ?? {
            interviewer_style:
              practicePlan.directorSettings.interviewerStyle,
            initial_pressure: practicePlan.directorSettings.initialPressure,
            follow_up_depth: practicePlan.directorSettings.followUpDepth,
            interruption_frequency:
              practicePlan.directorSettings.interruptionFrequency,
            total_duration_seconds:
              practicePlan.directorSettings.totalDurationMinutes * 60,
          }
        }
        estimatedLatencyMs={estimatedLatencyMs}
        events={eventTimeline}
        interviewerSpeakingMs={interviewerSpeakingMs}
        latencyBreakdown={latencyBreakdown}
        missingRequirements={questionCompletion.missingRequirements}
        onExport={onExportEventTimeline}
        pressure={displayedPressure}
        questionCompletionPercentage={questionCompletion.percentage}
        telemetry={directorTelemetry}
      />
    </aside>
  );
}

function MeetingControls({
  isVoiceConnected,
  isMicMuted,
  microphoneLevel,
  isInterviewActive,
  onMicrophoneMutedChange,
  onStartVoice,
  isCameraOn,
  isCameraStarting,
  onToggleCamera,
  progressText,
  showStartButton,
  isStarting,
  onStartInterview,
  showEndButton,
  isEnding,
  onEndInterview,
  isComplete,
  hasPendingArchive,
  onRetryArchive,
  onOpenWhiteboard,
}: InterviewRoomViewProps & { onOpenWhiteboard: () => void }) {
  return (
    <footer className="meeting-controls" aria-label="Meeting controls">
      <div className="control-group">
        <button
          aria-pressed={isVoiceConnected && isMicMuted}
          className={isVoiceConnected && !isMicMuted ? "control-active" : ""}
          disabled={!isInterviewActive}
          onClick={() => {
            if (isVoiceConnected) onMicrophoneMutedChange(!isMicMuted);
            else onStartVoice();
          }}
          type="button"
        >
          <span className="control-icon">Mic</span>
          <span>{isVoiceConnected ? (isMicMuted ? "Unmute" : "Mute") : "Start voice"}</span>
          <span
            aria-label={`Microphone input ${microphoneLevel}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={isMicMuted ? 0 : microphoneLevel}
            className="microphone-meter"
            role="meter"
          >
            <span style={{ width: `${isMicMuted ? 0 : microphoneLevel}%` }} />
          </span>
        </button>
        <button
          className={isCameraOn ? "control-active" : ""}
          disabled={isCameraStarting}
          onClick={onToggleCamera}
          type="button"
        >
          <span className="control-icon">Cam</span>
          {isCameraStarting
            ? "Opening camera"
            : isCameraOn
              ? "Camera on"
              : "Camera off"}
        </button>
      </div>
      <div className="control-group primary-controls">
        <button type="button">
          <span className="control-icon">Q</span>
          {progressText}
        </button>
        <button type="button">
          <span className="control-icon">Chat</span>
          Notes
        </button>
        <button onClick={onOpenWhiteboard} type="button">
          <span className="control-icon">Board</span>
          Whiteboard
        </button>
      </div>
      <div className="session-actions">
        {showStartButton ? (
          <button
            className="start-interview"
            disabled={isStarting}
            onClick={onStartInterview}
            type="button"
          >
            {isStarting ? "Starting..." : "Start interview"}
          </button>
        ) : null}
        {showEndButton ? (
          <button
            className="end-interview"
            disabled={isEnding}
            onClick={onEndInterview}
            type="button"
          >
            {isEnding ? "Ending..." : "End interview"}
          </button>
        ) : null}
        {isComplete ? (
          <>
            {hasPendingArchive ? (
              <button
                className="end-interview"
                disabled={isEnding}
                onClick={onRetryArchive}
                type="button"
              >
                {isEnding ? "Retrying archive..." : "Retry permanent archive"}
              </button>
            ) : null}
            <Link className="view-report" href="/report">
              View report
            </Link>
          </>
        ) : null}
      </div>
    </footer>
  );
}
