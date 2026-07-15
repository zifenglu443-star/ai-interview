"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createInterviewReport,
  deriveInterviewUiState,
  interviewTotalQuestions,
  interviewStorageKey,
  mapDirectorAnswers,
  type DirectorSession,
  type LiveControlReview,
  type LiveInterviewerStateProposal,
  type RealtimeClientSecret,
  type RealtimeTranscriptItem,
  type VoiceProvider,
} from "./interviewSession";
import {
  whiteboardChannelName,
  whiteboardCurrentQuestionStorageKey,
  whiteboardPersistenceKey,
  whiteboardSnapshotStorageKey,
  type AiWhiteboardOperation,
  type WhiteboardCurrentQuestion,
  type WhiteboardFrame,
  type WhiteboardSyncMessage,
} from "../whiteboard/whiteboardSync";
import {
  deriveDirectorTelemetry,
  InterviewEventLogger,
  SpeakingDurationTracker,
  type InterviewEvent,
  type InterviewEventData,
  type InterviewEventSource,
  type InterviewEventType,
  type Speaker,
} from "../../lib/telemetry/eventLogger";
import DirectorDashboard from "./DirectorDashboard";
import InterviewerAvatarVideo from "./InterviewerAvatarVideo";
import {
  defaultPracticePlan,
  loadPracticePlan,
  practiceFocusLabels,
  savePracticePlan,
  type PracticePlan,
  voiceProviderLabels,
} from "./practicePlan";

type LiveControlStatus = "offline" | "ready" | "evaluating" | "active" | "error";

const maximumTranscriptItems = 200;

export default function InterviewPage() {
  const router = useRouter();
  const [session, setSession] = useState<DirectorSession | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [pendingArchiveSession, setPendingArchiveSession] = useState<DirectorSession | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Camera off");
  const [error, setError] = useState<string | null>(null);
  const [voiceProviders, setVoiceProviders] = useState<VoiceProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(
    defaultPracticePlan.voiceProvider,
  );
  const [voiceStatus, setVoiceStatus] = useState("Voice idle");
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [whiteboardSyncStatus, setWhiteboardSyncStatus] = useState(
    "Whiteboard waiting",
  );
  const [eventTimeline, setEventTimeline] = useState<InterviewEvent[]>([]);
  const [candidateSpeakingMs, setCandidateSpeakingMs] = useState(0);
  const [interviewerSpeakingMs, setInterviewerSpeakingMs] = useState(0);
  const [estimatedLatencyMs, setEstimatedLatencyMs] = useState<number | null>(
    null,
  );
  const [liveControlStatus, setLiveControlStatus] =
    useState<LiveControlStatus>("offline");
  const [liveInterviewerControl, setLiveInterviewerControl] = useState<
    DirectorSession["control"] | null
  >(null);
  const [realtimeTranscript, setRealtimeTranscript] = useState<
    RealtimeTranscriptItem[]
  >([]);
  const realtimeTranscriptRef = useRef<RealtimeTranscriptItem[]>([]);
  const [practicePlan, setPracticePlan] = useState<PracticePlan>(
    defaultPracticePlan,
  );
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const realtimeDataChannelRef = useRef<RTCDataChannel | null>(null);
  const googleSocketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<DirectorSession | null>(null);
  const practicePlanRef = useRef<PracticePlan>(defaultPracticePlan);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const cameraRequestInFlightRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioMuteGainRef = useRef<GainNode | null>(null);
  const activePlaybackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const playbackCursorRef = useRef(0);
  const candidateInputResumeAtRef = useRef(0);
  const whiteboardChannelRef = useRef<BroadcastChannel | null>(null);
  const latestWhiteboardFrameRef = useRef<WhiteboardFrame | null>(null);
  const whiteboardSendTimerRef = useRef<number | null>(null);
  const whiteboardResetWaitersRef = useRef(new Map<string, () => void>());
  const lastWhiteboardSentAtRef = useRef(0);
  const isGoogleReadyRef = useRef(false);
  const openingPromptSentRef = useRef(false);
  const liveControlResetTimerRef = useRef<number | null>(null);
  const eventLoggerRef = useRef(new InterviewEventLogger());
  const speakingDurationRef = useRef(new SpeakingDurationTracker());
  const pendingResponseStartedAtRef = useRef<number | null>(null);
  const connectedVoiceProviderRef = useRef<string | null>(null);
  const voiceConnectionAttemptRef = useRef(0);
  const voiceStartInFlightRef = useRef(false);
  const finalizationInFlightRef = useRef(false);
  const sessionStartedAtRef = useRef<number | null>(null);
  const paceStageRef = useRef<0 | 1 | 2>(0);
  const endingPromptSentRef = useRef(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const candidateAudioActivityRef = useRef({
    lastVoiceAtMs: 0,
    speaking: false,
  });
  const {
    canEditNotes,
    isInterviewActive,
    showEndButton,
    showStartButton,
  } = deriveInterviewUiState(session, isComplete, isEnding);
  const interviewerIsSpeaking = speakingDurationRef.current.isActive("interviewer");
  const participants = [
    {
      name: "AI Interviewer",
      role: "Host",
      state: interviewerIsSpeaking
        ? "Speaking"
        : isInterviewActive
          ? "Listening"
          : "Ready",
    },
    {
      name: "You",
      role: "Candidate",
      state: isCameraOn ? "Camera on" : "Camera off",
    },
  ];

  const progressText = session
    ? `${Math.min(session.question_index + 1, session.question_plan.length || 5)} / ${session.question_plan.length || 5}`
    : "- / -";
  const countdownText =
    remainingSeconds === null
      ? null
      : `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(
          remainingSeconds % 60,
        ).padStart(2, "0")}`;

  const transcript = useMemo(
    () => session?.answers.slice(-3).reverse() ?? [],
    [session],
  );
  const directorTelemetry = deriveDirectorTelemetry(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session || !isInterviewActive || sessionStartedAtRef.current === null) return;
    const totalSeconds = session.director_config.total_duration_seconds;
    paceStageRef.current = 0;
    const questionCount = Math.max(session.question_plan.length, 1);
    const questionBudget = session.question_plan[session.question_index]?.allocated_seconds
      || Math.floor(totalSeconds / questionCount);
    const questionStartedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - (sessionStartedAtRef.current ?? Date.now())) / 1000);
      const remaining = Math.max(totalSeconds - elapsed, 0);
      setRemainingSeconds(remaining);
      const questionElapsed = Math.floor((Date.now() - questionStartedAt) / 1000);
      if (questionElapsed >= Math.floor(questionBudget * 0.8) && paceStageRef.current === 0) {
        paceStageRef.current = 1;
        sendPaceInstruction("Time is tightening. Ask the candidate to state their approach, key assumption, and strongest evidence concisely. Do not give them an answer.");
      }
      if (questionElapsed >= questionBudget && paceStageRef.current === 1) {
        paceStageRef.current = 2;
        sendPaceInstruction("Close this question efficiently. If the candidate is stuck, ask for their next validation step or most important tradeoff, then transition without giving the solution.");
      }
      if (remaining <= Math.min(60, Math.floor(totalSeconds * 0.1)) && !endingPromptSentRef.current) {
        endingPromptSentRef.current = true;
        sendPaceInstruction("The interview is nearly over. Guide the candidate to conclude with their independent approach, key tradeoff, and next step. Do not introduce a new deep question or provide an answer.");
      }
      if (remaining === 0) void handleEndInterview();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isInterviewActive, session?.question_index, session?.turn_index]);

  useEffect(() => {
    const plan = loadPracticePlan();
    practicePlanRef.current = plan;
    setPracticePlan(plan);
    setSelectedProvider(plan.voiceProvider);
  }, []);

  function recordInterviewEvent(
    type: InterviewEventType,
    source: InterviewEventSource,
    data: InterviewEventData = {},
    atMs = Date.now(),
  ) {
    eventLoggerRef.current.record(type, source, data, atMs);
    setEventTimeline(eventLoggerRef.current.snapshot());
  }

  function updateSpeakingDurations(atMs = Date.now()) {
    setCandidateSpeakingMs(
      speakingDurationRef.current.duration("candidate", atMs),
    );
    setInterviewerSpeakingMs(
      speakingDurationRef.current.duration("interviewer", atMs),
    );
  }

  function startSpeaking(speaker: Speaker, atMs = Date.now()) {
    if (!speakingDurationRef.current.start(speaker, atMs)) {
      return;
    }

    recordInterviewEvent(
      speaker === "candidate"
        ? "candidate_speaking_started"
        : "interviewer_speaking_started",
      "voice",
      { provider: selectedProvider },
      atMs,
    );

    if (speaker === "interviewer" && pendingResponseStartedAtRef.current !== null) {
      measureResponseLatency(
        pendingResponseStartedAtRef.current,
        "voice_turn",
        atMs,
      );
      pendingResponseStartedAtRef.current = null;
    }
    updateSpeakingDurations(atMs);
  }

  function stopSpeaking(speaker: Speaker, atMs = Date.now()) {
    if (!speakingDurationRef.current.stop(speaker, atMs)) {
      return;
    }

    recordInterviewEvent(
      speaker === "candidate"
        ? "candidate_speaking_stopped"
        : "interviewer_speaking_stopped",
      "voice",
      {
        durationMs: speakingDurationRef.current.duration(speaker, atMs),
        provider: selectedProvider,
      },
      atMs,
    );
    if (speaker === "candidate") {
      // This timestamp is only telemetry for response latency. Gemini Live owns
      // turn detection, so a brief pause while the candidate thinks never closes
      // the audio stream or forces the model to respond.
      pendingResponseStartedAtRef.current = atMs;
    }
    updateSpeakingDurations(atMs);
  }

  function measureResponseLatency(
    startedAtMs: number,
    kind: string,
    finishedAtMs = Date.now(),
  ) {
    const latencyMs = Math.max(0, finishedAtMs - startedAtMs);
    if (kind === "voice_turn") {
      setEstimatedLatencyMs(latencyMs);
    }
    recordInterviewEvent(
      "response_latency_measured",
      kind === "voice_turn" ? "voice" : "director",
      {
        kind,
        latencyMs,
      },
      finishedAtMs,
    );
  }

  function recordDirectorTransition(
    previousSession: DirectorSession | null,
    nextSession: DirectorSession,
  ) {
    recordInterviewEvent("director_transition", "director", {
      fromState: previousSession?.state ?? "ready",
      toState: nextSession.state,
      questionIndex: nextSession.question_index,
      currentQuestion: nextSession.current_prompt,
      followUpCount: nextSession.follow_up_used.length,
    });
    recordInterviewEvent("control_signal", "director", {
      emotion: nextSession.control.emotion,
      gesture: nextSession.control.gesture,
      whiteboardAction: nextSession.control.whiteboard_action,
    });
    if (nextSession.current_prompt && nextSession.current_prompt !== previousSession?.current_prompt) {
      window.localStorage.setItem(
        whiteboardCurrentQuestionStorageKey,
        JSON.stringify({
          type: "whiteboard-current-question",
          questionIndex: nextSession.question_index,
          prompt: nextSession.current_prompt,
        } satisfies WhiteboardCurrentQuestion),
      );
      whiteboardChannelRef.current?.postMessage({
        type: "apply-ai-whiteboard-ops",
        operations: [{ kind: "question", text: `Question ${nextSession.question_index + 1}: ${nextSession.current_prompt}` }],
      } satisfies WhiteboardSyncMessage);
    } else if (!nextSession.current_prompt) {
      window.localStorage.removeItem(whiteboardCurrentQuestionStorageKey);
    }
  }

  function observeCandidateAudio(samples: Float32Array, atMs = Date.now()) {
    let squareSum = 0;
    for (const sample of samples) {
      squareSum += sample * sample;
    }
    const rms = Math.sqrt(squareSum / Math.max(1, samples.length));
    const activity = candidateAudioActivityRef.current;

    if (rms >= 0.025) {
      activity.lastVoiceAtMs = atMs;
      if (!activity.speaking) {
        activity.speaking = true;
        startSpeaking("candidate", atMs);
      }
      return;
    }

    if (activity.speaking && atMs - activity.lastVoiceAtMs >= 650) {
      activity.speaking = false;
      stopSpeaking("candidate", atMs);
    }
  }

  function markVoiceConnected(provider: string) {
    connectedVoiceProviderRef.current = provider;
    recordInterviewEvent("voice_connected", "voice", { provider });
  }

  function markVoiceDisconnected(reason: string) {
    const provider = connectedVoiceProviderRef.current;
    if (!provider) {
      return;
    }
    connectedVoiceProviderRef.current = null;
    stopSpeaking("candidate");
    stopSpeaking("interviewer");
    pendingResponseStartedAtRef.current = null;
    recordInterviewEvent("voice_disconnected", "voice", {
      provider,
      reason,
    });
  }

  function addRealtimeTranscript(
    speaker: RealtimeTranscriptItem["speaker"],
    text: string,
    id = crypto.randomUUID(),
  ) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }
    setRealtimeTranscript((items) => {
      const latest = items[0];
      if (latest?.speaker === speaker) {
        const merged = latest.text.endsWith(normalizedText)
          ? latest.text
          : `${latest.text} ${normalizedText}`.replace(/\s+/g, " ");
        const nextItems = [{ ...latest, text: merged }, ...items.slice(1)];
        realtimeTranscriptRef.current = nextItems;
        return nextItems;
      }
      const nextItems = [
        { id, speaker, text: normalizedText },
        ...items.filter((item) => item.id !== id),
      ].slice(0, maximumTranscriptItems);
      realtimeTranscriptRef.current = nextItems;
      return nextItems;
    });
  }

  useEffect(() => {
    async function loadVoiceProviders() {
      try {
        const providers = await callBackend<VoiceProvider[]>("/voice/providers");
        setVoiceProviders(providers);
      } catch {
        setVoiceProviders([
          {
            id: "openai",
            label: "OpenAI Realtime",
            ready: false,
            primary: true,
            detail: "Voice provider metadata unavailable.",
          },
        ]);
      }
    }

    loadVoiceProviders();
  }, []);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) {
      setWhiteboardSyncStatus("Whiteboard sync unavailable");
      return;
    }

    const channel = new BroadcastChannel(whiteboardChannelName);
    whiteboardChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<WhiteboardSyncMessage>) => {
      if (event.data.type === "whiteboard-frame") {
        latestWhiteboardFrameRef.current = event.data;
        setWhiteboardSyncStatus("Whiteboard updated");
        recordInterviewEvent("whiteboard_updated", "whiteboard", {
          height: event.data.height,
          width: event.data.width,
          updatedAt: event.data.updatedAt,
        });
        scheduleWhiteboardForGemini(event.data);
      }

      if (event.data.type === "whiteboard-cleared") {
        latestWhiteboardFrameRef.current = null;
        setWhiteboardSyncStatus("Whiteboard cleared");
      }

      if (event.data.type === "whiteboard-reset-complete") {
        whiteboardResetWaitersRef.current.get(event.data.requestId)?.();
      }
    };
    setWhiteboardSyncStatus("Whiteboard sync ready");

    return () => {
      if (whiteboardSendTimerRef.current !== null) {
        window.clearTimeout(whiteboardSendTimerRef.current);
      }
      channel.close();
      whiteboardChannelRef.current = null;
      whiteboardResetWaitersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      stopRealtimeVoice();
      stopCamera();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => updateSpeakingDurations(), 250);
    return () => window.clearInterval(timer);
  }, []);

  async function handleStartInterview() {
    if (session || isStarting) {
      return;
    }

    setIsStarting(true);
    setError(null);
    const startedAtMs = Date.now();
    sessionStartedAtRef.current = startedAtMs;
    paceStageRef.current = 0;
    endingPromptSentRef.current = false;
    setRemainingSeconds(null);
    eventLoggerRef.current.startSession(crypto.randomUUID(), startedAtMs);
    speakingDurationRef.current.reset();
    pendingResponseStartedAtRef.current = null;
    candidateAudioActivityRef.current = {
      lastVoiceAtMs: 0,
      speaking: false,
    };
    setEventTimeline([]);
    setCandidateSpeakingMs(0);
    setInterviewerSpeakingMs(0);
    setEstimatedLatencyMs(null);
    setLiveInterviewerControl(null);
    openingPromptSentRef.current = false;
    let currentPracticePlan = loadPracticePlan();
    practicePlanRef.current = currentPracticePlan;
    setPracticePlan(currentPracticePlan);
    const configuredProvider = currentPracticePlan.voiceProvider;
    setSelectedProvider(configuredProvider);
    setVoiceStatus(
      configuredProvider === "google"
        ? "Connecting Gemini Live..."
        : "OpenAI Realtime selected. Connect voice when the interview begins.",
    );
    await resetWhiteboardWorkspace();
    const cameraPromise = startCamera();

    try {
      if (!currentPracticePlan.plannedQuestions.length) {
        const generated = await callBackend<{ questions: PracticePlan["plannedQuestions"] }>(
          "/interview/plan",
          {
            target_role: currentPracticePlan.targetRole,
            practice_focus: currentPracticePlan.focus,
            practice_topics: currentPracticePlan.topics,
            question_bank: currentPracticePlan.questionBank,
            total_duration_seconds: currentPracticePlan.directorSettings.totalDurationMinutes * 60,
            planner: {
              api_key: currentPracticePlan.plannerApi.apiKey,
              endpoint: currentPracticePlan.plannerApi.endpoint,
              model: currentPracticePlan.plannerApi.model,
            },
          },
        );
        currentPracticePlan = { ...currentPracticePlan, plannedQuestions: generated.questions };
        practicePlanRef.current = currentPracticePlan;
        setPracticePlan(currentPracticePlan);
        savePracticePlan(currentPracticePlan);
      }
      const nextSession = await callBackend<DirectorSession>(
        "/interview/start",
        {
          practice_focus: currentPracticePlan.focus,
          practice_topics: currentPracticePlan.topics,
          question_bank: currentPracticePlan.questionBank,
          planned_questions: currentPracticePlan.plannedQuestions,
          target_role: currentPracticePlan.targetRole,
          director_config: {
            interviewer_style:
              currentPracticePlan.directorSettings.interviewerStyle,
            initial_pressure:
              currentPracticePlan.directorSettings.initialPressure,
            follow_up_depth:
              currentPracticePlan.directorSettings.followUpDepth,
            interruption_frequency:
              currentPracticePlan.directorSettings.interruptionFrequency,
            total_duration_seconds:
              currentPracticePlan.directorSettings.totalDurationMinutes * 60,
          },
        },
      );
      setSession(nextSession);
      sessionRef.current = nextSession;
      setIsComplete(false);
      recordInterviewEvent("session_started", "session", {
        state: nextSession.state,
      });
      recordDirectorTransition(null, nextSession);
      if (configuredProvider === "google") {
        void handleStartGoogleVoice(nextSession);
      }
      await cameraPromise;
    } catch (error) {
      stopCamera();
      setError(error instanceof Error ? error.message : "Could not start the interview.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEndInterview() {
    if (!session || isEnding || finalizationInFlightRef.current) {
      return;
    }

    finalizationInFlightRef.current = true;
    setIsEnding(true);
    sessionStartedAtRef.current = null;
    setRemainingSeconds(null);
    let finalSession = session;

    try {
      finalSession = await callBackend<DirectorSession>("/interview/end", {
        session_id: session.session_id,
      });
      setSession(finalSession);
      sessionRef.current = finalSession;
      recordDirectorTransition(session, finalSession);
      setError(null);
    } catch {
      setError("The interview ended locally, but the Director could not be reached.");
    } finally {
      const recordId = await saveInterviewReport(finalSession);
      stopRealtimeVoice();
      stopCamera();
      recordInterviewEvent("session_ended", "session", {
        answerCount: finalSession.answers.length,
        state: finalSession.state,
      });
      setIsComplete(true);
      setIsEnding(false);
      finalizationInFlightRef.current = false;
      if (recordId) {
        setPendingArchiveSession(null);
        router.push("/report");
      } else {
        setPendingArchiveSession(finalSession);
      }
    }
  }

  async function startCamera() {
    if (cameraStreamRef.current || cameraRequestInFlightRef.current) {
      return;
    }

    const requestId = cameraRequestIdRef.current + 1;
    cameraRequestIdRef.current = requestId;
    cameraRequestInFlightRef.current = true;
    setIsCameraStarting(true);
    setCameraStatus("Opening camera...");
    let timedOut = false;
    let timeoutId: number | null = null;
    const mediaPromise = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        height: { ideal: 720 },
        width: { ideal: 1280 },
      },
    });
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          reject(new Error("Camera permission timed out."));
        }, 15_000);
      });
      const stream = await Promise.race([mediaPromise, timeoutPromise]);

      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraOn(true);
      setCameraStatus("Camera on");
    } catch {
      if (requestId === cameraRequestIdRef.current) {
        setIsCameraOn(false);
        setCameraStatus(timedOut ? "Camera request timed out" : "Camera permission unavailable");
      }
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (requestId === cameraRequestIdRef.current) {
        cameraRequestInFlightRef.current = false;
        setIsCameraStarting(false);
      }
    }
    if (timedOut) {
      void mediaPromise.then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      }).catch(() => undefined);
    }
  }

  function stopCamera() {
    cameraRequestIdRef.current += 1;
    cameraRequestInFlightRef.current = false;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraOn(false);
    setIsCameraStarting(false);
    setCameraStatus("Camera off");
  }

  async function handleToggleCamera() {
    if (isCameraOn) {
      stopCamera();
      return;
    }

    await startCamera();
  }

  async function saveInterviewReport(finalSession: DirectorSession): Promise<string | null> {
    const report = createInterviewReport(
      mapDirectorAnswers(finalSession.answers),
      realtimeTranscript,
      finalSession.question_plan.length || interviewTotalQuestions,
      finalSession.question_plan,
    );
    window.localStorage.setItem(interviewStorageKey, JSON.stringify(report));

    try {
      const whiteboard = await requestFinalWhiteboardFrame();
      const archive = await callBackend<{ record_id: string }>("/interview/archive", {
        session_id: finalSession.session_id,
        report: {
          completed_at: report.completedAt,
          total_questions: report.totalQuestions,
          answered_questions: report.answeredQuestions,
          answers: report.answers.map((answer) => ({
            question_id: answer.questionId,
            question: answer.question,
            answer: answer.answer,
            kind: answer.kind ?? "primary",
          })),
          realtime_transcript: report.realtimeTranscript?.map((item) => ({
            id: item.id,
            speaker: item.speaker,
            text: item.text,
          })),
        },
        target_role: practicePlanRef.current.targetRole,
        practice_focus: practicePlanRef.current.focus,
        practice_topics: practicePlanRef.current.topics,
        whiteboard: whiteboard
          ? {
              data: whiteboard.data,
              mime_type: whiteboard.mimeType,
              width: whiteboard.width,
              height: whiteboard.height,
            }
          : undefined,
      });
      await clearCompletedInterviewWorkspace();
      return archive.record_id;
    } catch {
      setError("Report saved in this browser, but the permanent archive could not be created.");
      return null;
    }
  }

  async function clearCompletedInterviewWorkspace() {
    await resetWhiteboardWorkspace();
    setRealtimeTranscript([]);
    realtimeTranscriptRef.current = [];
    setDraftAnswer("");
    setEventTimeline([]);
    eventLoggerRef.current.startSession("not-started");
    speakingDurationRef.current.reset();

  }

  async function resetWhiteboardWorkspace() {
    window.localStorage.removeItem(whiteboardSnapshotStorageKey);
    window.localStorage.removeItem(whiteboardCurrentQuestionStorageKey);
    latestWhiteboardFrameRef.current = null;

    const channel = whiteboardChannelRef.current;
    if (!channel) {
      clearStoredWhiteboardDatabase();
      return;
    }

    const requestId = crypto.randomUUID();
    const resetFinished = new Promise<boolean>((resolve) => {
      whiteboardResetWaitersRef.current.set(requestId, () => resolve(true));
      window.setTimeout(() => resolve(false), 600);
    });
    channel.postMessage({ type: "reset-whiteboard", requestId } satisfies WhiteboardSyncMessage);
    const clearedByOpenCanvas = await resetFinished;
    whiteboardResetWaitersRef.current.delete(requestId);
    if (!clearedByOpenCanvas) {
      clearStoredWhiteboardDatabase();
    }
  }

  async function requestFinalWhiteboardFrame(): Promise<WhiteboardFrame | null> {
    const channel = whiteboardChannelRef.current;
    if (!channel) {
      return loadStoredWhiteboardFrame();
    }

    channel.postMessage({ type: "request-whiteboard-frame" } satisfies WhiteboardSyncMessage);
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    return latestWhiteboardFrameRef.current ?? loadStoredWhiteboardFrame();
  }

  function exportEventTimeline() {
    const timeline = eventLoggerRef.current.export();
    const blob = new Blob([JSON.stringify(timeline, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `interview-events-${timeline.sessionId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function handleSubmitAnswer() {
    if (!session) {
      return;
    }

    const requestStartedAtMs = Date.now();
    recordInterviewEvent("answer_submitted", "session", {
      answerLength: draftAnswer.trim().length,
      questionIndex: session.question_index,
    });

    try {
      const nextSession = await callBackend<DirectorSession>(
        "/interview/answer",
        {
          session_id: session.session_id,
          answer: draftAnswer,
        },
      );

      setSession(nextSession);
      sessionRef.current = nextSession;
      measureResponseLatency(
        requestStartedAtMs,
        "director_round_trip",
        Date.now(),
      );
      recordDirectorTransition(session, nextSession);
      announcePlannedQuestion(nextSession);
      setDraftAnswer("");
      setError(null);

      if (nextSession.state === "completed") {
        await completeFinishedInterview(nextSession);
      }
    } catch {
      setError("Director Engine rejected this transition.");
    }
  }

  async function completeFinishedInterview(finalSession: DirectorSession) {
    if (finalizationInFlightRef.current) return;
    finalizationInFlightRef.current = true;
    sessionStartedAtRef.current = null;
    setRemainingSeconds(null);
    const recordId = await saveInterviewReport(finalSession);
    stopRealtimeVoice();
    stopCamera();
    recordInterviewEvent("session_ended", "session", {
      answerCount: finalSession.answers.length,
      state: finalSession.state,
    });
    setIsComplete(true);
    finalizationInFlightRef.current = false;
    if (recordId) {
      setPendingArchiveSession(null);
      router.push("/report");
    } else {
      setPendingArchiveSession(finalSession);
    }
  }

  async function retryArchive() {
    if (!pendingArchiveSession || isEnding || finalizationInFlightRef.current) return;
    finalizationInFlightRef.current = true;
    setIsEnding(true);
    let finalSession = pendingArchiveSession;
    if (finalSession.state !== "completed" && finalSession.state !== "ended") {
      try {
        finalSession = await callBackend<DirectorSession>("/interview/end", {
          session_id: finalSession.session_id,
        });
        setPendingArchiveSession(finalSession);
        setSession(finalSession);
        sessionRef.current = finalSession;
      } catch {
        setError("The Director is still unavailable. The browser report remains saved; try the permanent archive again when the backend returns.");
        setIsEnding(false);
        finalizationInFlightRef.current = false;
        return;
      }
    }
    const recordId = await saveInterviewReport(finalSession);
    setIsEnding(false);
    finalizationInFlightRef.current = false;
    if (recordId) {
      setPendingArchiveSession(null);
      setError(null);
      router.push("/report");
    }
  }

  async function handleStartVoice() {
    if (!isInterviewActive) {
      setVoiceStatus("Start the interview before connecting voice.");
      return;
    }

    if (selectedProvider === "google") {
      await handleStartGoogleVoice();
      return;
    }

    if (selectedProvider !== "openai") {
      setVoiceStatus("This voice provider is not implemented yet.");
      return;
    }

    if (
      voiceStartInFlightRef.current ||
      peerConnectionRef.current ||
      mediaStreamRef.current
    ) {
      return;
    }

    const attemptId = voiceConnectionAttemptRef.current + 1;
    voiceConnectionAttemptRef.current = attemptId;
    voiceStartInFlightRef.current = true;
    try {
      setVoiceStatus("Requesting realtime session...");
      const secret = await callBackend<RealtimeClientSecret>(
        "/realtime/client-secret",
        {
          provider: selectedProvider,
          api_key: practicePlanRef.current.liveApis.openai.apiKey,
          model: practicePlanRef.current.liveApis.openai.model,
        },
      );
      if (attemptId !== voiceConnectionAttemptRef.current) {
        return;
      }

      setVoiceStatus("Opening microphone...");
      const mediaStream = await getUserMediaWithTimeout(
        { audio: true },
        15_000,
        "Microphone request timed out. Use Start voice to retry.",
      );
      if (attemptId !== voiceConnectionAttemptRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = mediaStream;

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const audioElement = new Audio();
      audioElement.autoplay = true;
      audioElementRef.current = audioElement;
      peerConnection.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
      };

      for (const track of mediaStream.getTracks()) {
        peerConnection.addTrack(track, mediaStream);
      }

      const dataChannel = peerConnection.createDataChannel("oai-events");
      realtimeDataChannelRef.current = dataChannel;
      dataChannel.onopen = () => announcePlannedQuestion(sessionRef.current, true);
      dataChannel.onmessage = (event) => {
        handleRealtimeEvent(event.data);
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const realtimeResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${secret.model}`,
        {
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${secret.value}`,
            "Content-Type": "application/sdp",
          },
          method: "POST",
        },
      );

      if (!realtimeResponse.ok) {
        throw new Error("Realtime WebRTC negotiation failed.");
      }

      if (attemptId !== voiceConnectionAttemptRef.current) {
        return;
      }

      await peerConnection.setRemoteDescription({
        sdp: await realtimeResponse.text(),
        type: "answer",
      });

      setIsVoiceConnected(true);
      markVoiceConnected(secret.provider);
      setVoiceStatus(`Connected to ${secret.provider} voice · ${secret.voice}`);
    } catch (error) {
      stopRealtimeVoice();
      setVoiceStatus(
        error instanceof Error
          ? error.message
          : "Voice unavailable. Check API key and microphone access.",
      );
    } finally {
      if (attemptId === voiceConnectionAttemptRef.current) {
        voiceStartInFlightRef.current = false;
      }
    }
  }

  async function handleStartGoogleVoice(initialSession?: DirectorSession) {
    if (
      voiceStartInFlightRef.current ||
      googleSocketRef.current ||
      mediaStreamRef.current
    ) {
      return;
    }

    const attemptId = voiceConnectionAttemptRef.current + 1;
    voiceConnectionAttemptRef.current = attemptId;
    voiceStartInFlightRef.current = true;
    try {
      setVoiceStatus("Opening microphone for Gemini Live...");
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const mediaStream = await getUserMediaWithTimeout(
        {
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        },
        15_000,
        "Microphone request timed out. Use Start voice to retry.",
      );
      if (attemptId !== voiceConnectionAttemptRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        void audioContext.close();
        return;
      }
      mediaStreamRef.current = mediaStream;
      playbackCursorRef.current = audioContext.currentTime;

      const googleApi = practicePlanRef.current.liveApis.google;
      const socket = new WebSocket(
        getGoogleLiveSocketUrl(googleApi.model),
      );
      googleSocketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ clientConfig: { apiKey: googleApi.apiKey } }));
        setVoiceStatus("Connected to proxy. Configuring Gemini Live...");
      };
      socket.onmessage = async (event) => {
        const rawMessage = await readGoogleLiveSocketData(event.data);
        if (!rawMessage || googleSocketRef.current !== socket) {
          return;
        }

        const message = parseGoogleLiveMessage(rawMessage);
        if (!message) {
          return;
        }

        if (message.setupComplete) {
          isGoogleReadyRef.current = true;
          setLiveControlStatus("ready");
          startGoogleAudioCapture(socket, mediaStream, audioContext);
          setIsVoiceConnected(true);
          markVoiceConnected("google");
          setVoiceStatus("Interviewer joining...");
          sendGoogleOpening(initialSession ?? sessionRef.current);
          const latestFrame = latestWhiteboardFrameRef.current;
          if (latestFrame) {
            scheduleWhiteboardForGemini(latestFrame);
          } else {
            whiteboardChannelRef.current?.postMessage({
              type: "request-whiteboard-frame",
            } satisfies WhiteboardSyncMessage);
          }
          return;
        }

        if (message.toolCall) {
          void handleGoogleLiveToolCall(message.toolCall, socket);
        }
        handleGoogleLiveMessage(message, audioContext);
      };
      socket.onerror = () => {
        if (googleSocketRef.current !== socket) return;
        setLiveControlStatus("error");
        setVoiceStatus("Gemini Live connection failed.");
      };
      socket.onclose = () => {
        if (googleSocketRef.current === socket) {
          googleSocketRef.current = null;
          isGoogleReadyRef.current = false;
          setLiveControlStatus("offline");
          markVoiceDisconnected("socket_closed");
          stopLocalAudio();
          setIsVoiceConnected(false);
          setVoiceStatus("Gemini Live disconnected");
        }
      };
      voiceStartInFlightRef.current = false;
    } catch (error) {
      stopRealtimeVoice();
      setVoiceStatus(
        error instanceof Error
          ? error.message
          : "Gemini Live unavailable. Check the key and microphone access.",
      );
    } finally {
      if (attemptId === voiceConnectionAttemptRef.current) {
        voiceStartInFlightRef.current = false;
      }
    }
  }

  async function handleGoogleLiveToolCall(
    toolCall: NonNullable<GoogleLiveMessage["toolCall"]>,
    socket: WebSocket,
  ) {
    const functionResponses: GoogleFunctionResponse[] = [];
    let completedSession: DirectorSession | null = null;

    for (const functionCall of toolCall.functionCalls ?? []) {
      if (functionCall.name !== "report_interviewer_state") {
        functionResponses.push({
          id: functionCall.id,
          name: functionCall.name,
          response: {
            result: {
              approved: false,
              approvedDecision: "continue",
              reasonCode: "unknown_tool",
            },
          },
        });
        continue;
      }

      const currentSession = sessionRef.current;
      if (!currentSession) {
        functionResponses.push({
          id: functionCall.id,
          name: functionCall.name,
          response: {
            result: {
              approved: false,
              approvedDecision: "continue",
              reasonCode: "session_unavailable",
            },
          },
        });
        continue;
      }

      setLiveControlStatus("evaluating");
      const rawProposal = functionCall.args as LiveInterviewerStateProposal;
      const latestCandidateAnswer = realtimeTranscriptRef.current.find(
        (item) => item.speaker === "candidate",
      )?.text;
      const proposal: LiveInterviewerStateProposal = {
        ...rawProposal,
        candidate_answer: (latestCandidateAnswer || rawProposal.candidate_answer || "").slice(0, 20_000),
      };
      recordInterviewEvent("live_control_requested", "director", {
        confidence: Number(proposal.confidence ?? 0),
        decision: String(proposal.decision ?? "unknown"),
        provider: "google",
      });

      try {
        const review = await callBackend<LiveControlReview>(
          "/interview/live-control",
          {
            proposal,
            session_id: currentSession.session_id,
          },
        );

        if (review.approved) {
          if (
            review.session.state !== currentSession.state ||
            review.session.current_prompt !== currentSession.current_prompt ||
            review.session.question_index !== currentSession.question_index
          ) {
            recordDirectorTransition(currentSession, review.session);
          }
          setSession(review.session);
          sessionRef.current = review.session;
          setLiveInterviewerControl(review.control);
          setLiveControlStatus("active");
          const operations = practicePlanRef.current.allowAiWhiteboardAnnotations
            ? sanitizeAiWhiteboardActions(review.whiteboard_actions)
            : [];
          if (operations.length) {
            whiteboardChannelRef.current?.postMessage({
              type: "apply-ai-whiteboard-ops",
              operations,
            } satisfies WhiteboardSyncMessage);
            recordInterviewEvent("whiteboard_updated", "whiteboard", { count: operations.length, source: "ai" });
          }
          recordInterviewEvent("live_control_applied", "director", {
            decision: review.approved_decision,
            emotion: review.control.emotion,
            gesture: review.control.gesture,
            reasonCode: review.reason_code,
          });
          scheduleLiveControlReady();
          if (review.session.state === "completed") completedSession = review.session;
        } else {
          setLiveControlStatus("ready");
          recordInterviewEvent("live_control_rejected", "director", {
            decision: review.approved_decision,
            reasonCode: review.reason_code,
          });
        }

        functionResponses.push({
          id: functionCall.id,
          name: functionCall.name,
          response: {
            result: {
              approved: review.approved,
              approvedDecision: review.approved_decision,
              reasonCode: review.reason_code,
              currentQuestion: review.session.current_prompt,
              questionIndex: review.session.question_index,
              totalQuestions: review.session.question_plan.length,
              state: review.session.state,
            },
          },
        });
      } catch {
        setLiveControlStatus("error");
        functionResponses.push({
          id: functionCall.id,
          name: functionCall.name,
          response: {
            result: {
              approved: false,
              approvedDecision: "continue",
              reasonCode: "director_unavailable",
            },
          },
        });
      }
    }

    if (functionResponses.length && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          toolResponse: {
            functionResponses,
          },
        }),
      );
    }
    if (completedSession) await completeFinishedInterview(completedSession);
  }

  function scheduleLiveControlReady() {
    if (liveControlResetTimerRef.current !== null) {
      window.clearTimeout(liveControlResetTimerRef.current);
    }
    liveControlResetTimerRef.current = window.setTimeout(() => {
      liveControlResetTimerRef.current = null;
      if (googleSocketRef.current?.readyState === WebSocket.OPEN) {
        setLiveControlStatus("ready");
      }
    }, 1400);
  }

  function startGoogleAudioCapture(
    socket: WebSocket,
    mediaStream: MediaStream,
    audioContext: AudioContext,
  ) {
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      // Do not let speaker audio re-enter the microphone stream and make Gemini
      // interrupt its own response. The interview intentionally uses turn-taking.
      if (audioContext.currentTime < candidateInputResumeAtRef.current) {
        return;
      }

      const samples = event.inputBuffer.getChannelData(0);
      observeCandidateAudio(samples);
      const downsampled = downsampleAudio(
        samples,
        audioContext.sampleRate,
        16000,
      );
      socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: pcm16ToBase64(downsampled),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        }),
      );
    };

    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(audioContext.destination);
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    audioMuteGainRef.current = muteGain;
  }

  function sendGoogleLiveText(socket: WebSocket, text: string) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        realtimeInput: {
          text,
        },
      }),
    );
  }

  function sendPaceInstruction(text: string) {
    const googleSocket = googleSocketRef.current;
    if (googleSocket?.readyState === WebSocket.OPEN) {
      sendGoogleLiveText(googleSocket, text);
      return;
    }
    const channel = realtimeDataChannelRef.current;
    if (channel?.readyState !== "open") return;
    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }

  function announcePlannedQuestion(
    plannedSession: DirectorSession | null,
    includeIntroduction = false,
  ) {
    if (!plannedSession?.current_prompt) return;
    const plan = practicePlanRef.current;
    const orderedQuestions = plannedSession.question_plan
      .map((question, index) => `${index + 1}. (${question.allocated_seconds || "planned"} seconds; ${question.focus}) ${question.prompt}`)
      .join(" ");
    const message = [
      "This is a timed interview. You are the interviewer, not a tutor.",
      `Target role: ${plan.targetRole}.`,
      `The locked question plan is: ${orderedQuestions}.`,
      `The current planned question is: ${plannedSession.current_prompt}`,
      "Ask only the current question. Keep the candidate focused; if time is short, ask them to conclude with one concrete result before moving on.",
      includeIntroduction
        ? "Briefly introduce yourself, then begin now."
        : "A written answer has been recorded. Briefly transition and ask this question now.",
    ].join(" ");
    sendPaceInstruction(message);
  }

  function sendGoogleOpening(openingSession: DirectorSession | null) {
    const socket = googleSocketRef.current;
    if (
      openingPromptSentRef.current ||
      !isGoogleReadyRef.current ||
      socket?.readyState !== WebSocket.OPEN ||
      !openingSession?.current_prompt
    ) {
      return;
    }

    openingPromptSentRef.current = true;
    const plan = practicePlanRef.current;
    sendGoogleLiveText(
      socket,
      [
        "This is a focused practice interview.",
        `Target role: ${plan.targetRole}.`,
        `Practice focus: ${practiceFocusLabels[plan.focus]}.`,
        plan.topics ? `Candidate-requested topics: ${plan.topics}.` : "",
        "Begin the interview now.",
        "Briefly introduce yourself as the interviewer, then ask this exact opening question:",
        openingSession.current_prompt,
        "Do not answer the question for the candidate.",
      ].join(" "),
    );
  }

  function handleGoogleLiveMessage(
    message: GoogleLiveMessage,
    audioContext: AudioContext,
  ) {
    if (message.error?.message) {
      setVoiceStatus(message.error.message);
      return;
    }

    const serverContent = message.serverContent;
    const inputText = serverContent?.inputTranscription?.text?.trim();
    const outputText = serverContent?.outputTranscription?.text?.trim();

    if (inputText) {
      addRealtimeTranscript("candidate", inputText);
    }
    if (outputText) {
      addRealtimeTranscript("interviewer", outputText);
    }

    let receivedAudio = false;
    for (const part of serverContent?.modelTurn?.parts ?? []) {
      const audio = part.inlineData;
      if (audio?.data && audio.mimeType?.startsWith("audio/pcm")) {
        receivedAudio = true;
        playbackCursorRef.current = playGoogleAudio(
          audioContext,
          audio.data,
          audio.mimeType,
          playbackCursorRef.current,
          activePlaybackSourcesRef.current,
        );
        candidateInputResumeAtRef.current = playbackCursorRef.current + 0.35;
      }
    }

    if (receivedAudio) {
      startSpeaking("interviewer");
    }
    if (serverContent?.turnComplete) {
      stopSpeaking("interviewer");
    }
  }

  function scheduleWhiteboardForGemini(frame: WhiteboardFrame) {
    const socket = googleSocketRef.current;
    if (!isGoogleReadyRef.current || socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const minimumFrameIntervalMs = 1100;
    const waitMs = Math.max(
      0,
      minimumFrameIntervalMs - (Date.now() - lastWhiteboardSentAtRef.current),
    );
    if (whiteboardSendTimerRef.current !== null) {
      window.clearTimeout(whiteboardSendTimerRef.current);
    }
    whiteboardSendTimerRef.current = window.setTimeout(() => {
      whiteboardSendTimerRef.current = null;
      const activeSocket = googleSocketRef.current;
      if (
        !isGoogleReadyRef.current ||
        activeSocket?.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      activeSocket.send(
        JSON.stringify({
          realtimeInput: {
            video: {
              data: frame.data,
              mimeType: frame.mimeType,
            },
          },
        }),
      );
      lastWhiteboardSentAtRef.current = Date.now();
      setWhiteboardSyncStatus("Whiteboard sent to Gemini");
      recordInterviewEvent("whiteboard_sent", "whiteboard", {
        height: frame.height,
        provider: "google",
        width: frame.width,
      });
    }, waitMs);
  }

  function stopRealtimeVoice() {
    voiceConnectionAttemptRef.current += 1;
    voiceStartInFlightRef.current = false;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    realtimeDataChannelRef.current = null;

    const googleSocket = googleSocketRef.current;
    googleSocketRef.current = null;
    isGoogleReadyRef.current = false;
    if (liveControlResetTimerRef.current !== null) {
      window.clearTimeout(liveControlResetTimerRef.current);
      liveControlResetTimerRef.current = null;
    }
    if (whiteboardSendTimerRef.current !== null) {
      window.clearTimeout(whiteboardSendTimerRef.current);
      whiteboardSendTimerRef.current = null;
    }
    googleSocket?.close(1000, "Voice stopped");
    markVoiceDisconnected("stopped");

    stopLocalAudio();

    setIsVoiceConnected(false);
    setLiveControlStatus("offline");
    setLiveInterviewerControl(null);
  }

  function stopLocalAudio() {
    for (const source of activePlaybackSourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that already ended is safe to disconnect.
      }
      source.disconnect();
    }
    activePlaybackSourcesRef.current.clear();

    audioProcessorRef.current?.disconnect();
    audioProcessorRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    audioMuteGainRef.current?.disconnect();
    audioMuteGainRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }

    void audioContextRef.current?.close();
    audioContextRef.current = null;
    playbackCursorRef.current = 0;
    candidateInputResumeAtRef.current = 0;
  }

  function handleStopVoice() {
    stopRealtimeVoice();
    setVoiceStatus("Voice stopped");
  }

  function handleRealtimeEvent(rawEvent: string) {
    let event: {
      type?: string;
      transcript?: string;
      item_id?: string;
    };

    try {
      event = JSON.parse(rawEvent) as typeof event;
    } catch {
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      startSpeaking("candidate");
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      stopSpeaking("candidate");
    }
    if (
      event.type === "output_audio_buffer.started" ||
      event.type === "response.audio.delta"
    ) {
      startSpeaking("interviewer");
    }
    if (
      event.type === "output_audio_buffer.stopped" ||
      event.type === "response.audio.done"
    ) {
      stopSpeaking("interviewer");
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.transcript
    ) {
      addRealtimeTranscript(
        "candidate",
        event.transcript,
        event.item_id ?? crypto.randomUUID(),
      );
    }

    if (event.type === "response.audio_transcript.done" && event.transcript) {
      addRealtimeTranscript(
        "interviewer",
        event.transcript,
        event.item_id ?? crypto.randomUUID(),
      );
    }
  }

  const selectedVoiceProvider = voiceProviders.find(
    (provider) => provider.id === selectedProvider,
  );
  const selectedVoiceProviderReady = Boolean(
    selectedVoiceProvider?.ready || practicePlan.liveApis[selectedProvider].apiKey,
  );
  const control = session?.control;
  const effectiveControl = liveInterviewerControl ?? control;

  const configuredAttitude = {
    friendly: "supportive",
    professional: "professional",
    strict: "firm",
  }[practicePlan.directorSettings.interviewerStyle];
  const displayedAttitude = session?.attitude ?? configuredAttitude;
  const displayedPressure =
    session?.pressure ?? practicePlan.directorSettings.initialPressure;

  return (
    <main className="interview-shell immersive-shell">
      <header className="meeting-topbar">
        <div>
          <Link className="meeting-brand" href="/">
            AI Interview Simulator
          </Link>
          <span>{practiceFocusLabels[practicePlan.focus]} · Voice + transcript</span>
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
            aria-expanded={isToolsOpen}
            aria-controls="meeting-tools"
            className="meeting-tools-trigger"
            onClick={() => setIsToolsOpen((open) => !open)}
            type="button"
          >
            {isToolsOpen ? "Close tools" : "Room tools"}
          </button>
          <Link href="/setup">Setup</Link>
        </div>
      </header>

      <section className="meeting-content">
        <section className="meeting-stage" aria-label="Interview video stage">
          <div className="meeting-main-grid">
            <section className="interviewer-tile">
              <div
                aria-label={formatLiveControlStatus(liveControlStatus)}
                className={`interviewer-signal interviewer-signal-${liveControlStatus}`}
                role="status"
                title={formatLiveControlStatus(liveControlStatus)}
              >
                <span aria-hidden="true" />
              </div>
              <div className="interviewer-video-area">
                <InterviewerAvatarVideo
                  emotion={effectiveControl?.emotion ?? "neutral"}
                  gesture={effectiveControl?.gesture ?? "idle"}
                  isSpeaking={interviewerIsSpeaking}
                />
              </div>
              <div className="nameplate">
                <strong>AI Interviewer</strong>
                <span>
                  Host · {displayedAttitude} · pressure {displayedPressure}
                </span>
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
                <h2>Answer notes</h2>
                <span>
                  {progressText}
                </span>
              </div>
              <p className="current-question-prompt">
                {session?.current_prompt ?? "Start the interview to receive the first question."}
              </p>
              <textarea
                aria-label="Answer the current interview question"
                disabled={!canEditNotes}
                onChange={(event) => setDraftAnswer(event.target.value)}
                placeholder="Type the answer you would give in the meeting."
                value={draftAnswer}
              />
              {error ? <p className="director-error">{error}</p> : null}
              <button
                className="answer-submit"
                disabled={!canEditNotes || !draftAnswer.trim()}
                onClick={handleSubmitAnswer}
                type="button"
              >
                {session?.state === "follow_up"
                  ? "Answer follow-up"
                  : "Continue with notes"}
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
        </section>

        <aside
          aria-label="Meeting tools"
          aria-hidden={!isToolsOpen}
          className={`meeting-side-panel ${isToolsOpen ? "meeting-side-panel-open" : ""}`}
          id="meeting-tools"
        >
          <div className="meeting-tools-header">
            <strong>Interview tools</strong>
            <button
              aria-label="Close interview tools"
              onClick={() => setIsToolsOpen(false)}
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
                onClick={handleStartVoice}
                type="button"
              >
                Start voice
              </button>
              <button
                className="voice-stop"
                disabled={!isVoiceConnected}
                onClick={handleStopVoice}
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
                session?.state === "ended",
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
            onExport={exportEventTimeline}
            pressure={displayedPressure}
            telemetry={directorTelemetry}
          />
        </aside>
      </section>

      <footer className="meeting-controls" aria-label="Meeting controls">
        <div className="control-group">
          <button
            className={isVoiceConnected ? "control-active" : ""}
            disabled={!isInterviewActive}
            onClick={() => {
              if (isVoiceConnected) {
                handleStopVoice();
              } else {
                void handleStartVoice();
              }
            }}
            type="button"
          >
            <span className="control-icon">Mic</span>
            {isVoiceConnected ? "Live — stop" : "Start voice"}
          </button>
          <button
            className={isCameraOn ? "control-active" : ""}
            disabled={isCameraStarting}
            onClick={handleToggleCamera}
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
          <Link href="/whiteboard" rel="noreferrer" target="_blank">
            <span className="control-icon">Board</span>
            Whiteboard
          </Link>
        </div>
        <div className="session-actions">
          {showStartButton ? (
            <button
              className="start-interview"
              disabled={isStarting}
              onClick={handleStartInterview}
              type="button"
            >
              {isStarting ? "Starting..." : "Start interview"}
            </button>
          ) : null}
          {showEndButton ? (
            <button
              className="end-interview"
              disabled={isEnding}
              onClick={handleEndInterview}
              type="button"
            >
              {isEnding ? "Ending..." : "End interview"}
            </button>
          ) : null}
          {isComplete ? (
            <>
              {pendingArchiveSession ? (
                <button
                  className="end-interview"
                  disabled={isEnding}
                  onClick={() => void retryArchive()}
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
    </main>
  );
}

async function callBackend<T>(path: string, body?: object): Promise<T> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const method = body ? "POST" : "GET";
  const response = await fetch(`${baseUrl}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
    },
    method,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `Director request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function loadStoredWhiteboardFrame(): WhiteboardFrame | null {
  try {
    const stored = window.localStorage.getItem(whiteboardSnapshotStorageKey);
    if (!stored) {
      return null;
    }
    const frame = JSON.parse(stored) as WhiteboardFrame;
    if (
      frame.type !== "whiteboard-frame" ||
      frame.mimeType !== "image/jpeg" ||
      !frame.data ||
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height)
    ) {
      return null;
    }
    return frame;
  } catch {
    return null;
  }
}

function clearStoredWhiteboardDatabase() {
  window.indexedDB.deleteDatabase(`TLDRAW_DOCUMENT_v2${whiteboardPersistenceKey}`);
}

function sanitizeAiWhiteboardActions(
  actions: LiveInterviewerStateProposal["whiteboard_actions"],
): AiWhiteboardOperation[] {
  if (!Array.isArray(actions)) return [];
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const sanitized: AiWhiteboardOperation[] = [];
  for (const action of actions.slice(0, 4)) {
    if (!action || typeof action !== "object") continue;
    const kind = action.kind;
    const x = number(action.x);
    const y = number(action.y);
    if (kind === "note" || kind === "summary") {
      const text = typeof action.text === "string" ? action.text.trim().slice(0, 500) : "";
      if (text) sanitized.push({ kind, text: text.slice(0, 240), x, y });
      continue;
    }
    if (kind === "arrow" || kind === "line") {
      sanitized.push({ kind, x, y, toX: number(action.toX), toY: number(action.toY) });
      continue;
    }
    if (kind === "circle" || kind === "highlight") {
      const w = number(action.w);
      const h = number(action.h);
      if (w > 0.01 && h > 0.01) sanitized.push({ kind, x, y, w, h });
    }
  }
  return sanitized;
}

type GoogleLiveMessage = {
  setupComplete?: object;
  error?: {
    message?: string;
  };
  toolCall?: {
    functionCalls?: GoogleFunctionCall[];
  };
  serverContent?: {
    turnComplete?: boolean;
    inputTranscription?: {
      text?: string;
    };
    outputTranscription?: {
      text?: string;
    };
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
      }>;
    };
  };
};

type GoogleFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type GoogleFunctionResponse = {
  id: string;
  name: string;
  response: {
    result: {
      approved: boolean;
      approvedDecision: string;
      reasonCode: string;
      currentQuestion?: string | null;
      questionIndex?: number;
      totalQuestions?: number;
      state?: string;
    };
  };
};

function formatLiveControlStatus(status: LiveControlStatus): string {
  const labels: Record<LiveControlStatus, string> = {
    offline: "Interviewer signal channel offline",
    ready: "Interviewer signal channel ready",
    evaluating: "Interviewer is evaluating the current turn",
    active: "Interviewer signal applied",
    error: "Interviewer signal channel error",
  };
  return labels[status];
}

function getGoogleLiveSocketUrl(model = ""): string {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/google/live";
  if (model) url.searchParams.set("model", model);
  return url.toString();
}

function parseGoogleLiveMessage(rawMessage: string): GoogleLiveMessage | null {
  try {
    return JSON.parse(rawMessage) as GoogleLiveMessage;
  } catch {
    return null;
  }
}

async function readGoogleLiveSocketData(data: unknown): Promise<string | null> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  return null;
}

async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<MediaStream> {
  let timedOut = false;
  let timeoutId: number | null = null;
  const mediaPromise = navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await Promise.race([
      mediaPromise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (timedOut) {
      void mediaPromise.then(
        (stream) => stream.getTracks().forEach((track) => track.stop()),
        () => undefined,
      );
    }
  }
}

function downsampleAudio(
  samples: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) {
    return samples;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.round(samples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(Math.floor((outputIndex + 1) * ratio), samples.length);
    let total = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      total += samples[inputIndex];
    }
    output[outputIndex] = total / Math.max(1, end - start);
  }

  return output;
}

function pcm16ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(index * 2, value, true);
  });

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function playGoogleAudio(
  audioContext: AudioContext,
  encodedAudio: string,
  mimeType: string,
  playbackCursor: number,
  activeSources: Set<AudioBufferSourceNode>,
): number {
  const binary = window.atob(encodedAudio);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const sampleRateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = Number(sampleRateMatch?.[1] ?? 24000);
  const view = new DataView(bytes.buffer);
  const audioBuffer = audioContext.createBuffer(1, bytes.length / 2, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  activeSources.add(source);
  source.onended = () => {
    source.disconnect();
    activeSources.delete(source);
  };
  const startAt = Math.max(audioContext.currentTime + 0.02, playbackCursor);
  source.start(startAt);
  return startAt + audioBuffer.duration;
}
