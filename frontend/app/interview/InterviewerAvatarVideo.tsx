"use client";

import { useEffect, useRef, useState } from "react";

import {
  INTERVIEWER_VIDEO_PATHS,
  selectInterviewerPresentation,
  type InterviewerVideoSignals,
} from "./interviewerVideoState";

type ActiveClip = {
  category: "action" | "ambient" | "blink" | "speech";
  id: string;
  loop: boolean;
  presentationKey?: string;
  source: string;
};

function pickSource(sources: readonly string[]) {
  return sources[Math.floor(Math.random() * sources.length)];
}

function pickAmbientClip(): Pick<ActiveClip, "source" | "presentationKey"> {
  const choices = [
    { presentationKey: "nod-once", sources: INTERVIEWER_VIDEO_PATHS.nod },
    { presentationKey: "think", sources: INTERVIEWER_VIDEO_PATHS.thinking },
    { presentationKey: "take-note", sources: INTERVIEWER_VIDEO_PATHS.takingNotes },
  ] as const;
  const choice = choices[Math.floor(Math.random() * choices.length)];
  return { presentationKey: choice.presentationKey, source: pickSource(choice.sources) };
}

export default function InterviewerAvatarVideo(props: InterviewerVideoSignals) {
  const presentation = selectInterviewerPresentation(props);
  const previousPresentationKeyRef = useRef<string | null>(null);
  const handledActionKeyRef = useRef<string | null>(null);
  const blinkTimerRef = useRef<number | null>(null);
  const clipVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeClip, setActiveClip] = useState<ActiveClip | null>(null);
  const [settledActionKey, setSettledActionKey] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setActiveClip(null);
      return;
    }
    if (presentation.kind === "idle") {
      if (previousPresentationKeyRef.current === "idle") return;
      previousPresentationKeyRef.current = "idle";
      handledActionKeyRef.current = null;
      setSettledActionKey(null);
      setActiveClip(null);
      return;
    }
    const actionIdentity = `${presentation.key}:${props.signalId ?? 0}`;
    if (
      presentation.kind === "action" &&
      handledActionKeyRef.current === actionIdentity
    ) {
      previousPresentationKeyRef.current = presentation.key;
      setSettledActionKey(presentation.key);
      setActiveClip((current) =>
        current?.category === "speech" ? null : current,
      );
      return;
    }
    if (presentation.key === previousPresentationKeyRef.current) return;
    previousPresentationKeyRef.current = presentation.key;
    if (presentation.kind === "action") {
      handledActionKeyRef.current = actionIdentity;
      setSettledActionKey(null);
    }
    if (presentation.sources.length === 0) {
      setActiveClip(null);
      return;
    }
    setActiveClip({
      category: presentation.kind,
      id: `${presentation.key}-${Date.now()}`,
      loop: presentation.kind === "speech",
      presentationKey: presentation.key,
      source: pickSource(presentation.sources),
    });
  }, [prefersReducedMotion, presentation.key, presentation.kind, props.signalId]);

  useEffect(() => {
    const canBlink =
      presentation.kind === "idle" ||
      (presentation.kind === "action" && settledActionKey === presentation.key);
    if (prefersReducedMotion || !canBlink || activeClip) return;
    const delay = 2_500 + Math.floor(Math.random() * 2_500);
    blinkTimerRef.current = window.setTimeout(() => {
      // Occasional ambient movement keeps the interviewer present without
      // implying a Director decision or interrupting the candidate.
      if (presentation.kind === "idle" && Math.random() < 0.22) {
        setActiveClip({
          category: "ambient",
          id: `ambient-${Date.now()}`,
          loop: false,
          ...pickAmbientClip(),
        });
        return;
      }
      setActiveClip({
        category: "blink",
        id: `blink-${Date.now()}`,
        loop: false,
        source: pickSource(INTERVIEWER_VIDEO_PATHS.blink),
      });
    }, delay);
    return () => {
      if (blinkTimerRef.current !== null) window.clearTimeout(blinkTimerRef.current);
      blinkTimerRef.current = null;
    };
  }, [activeClip, prefersReducedMotion, presentation.key, presentation.kind, settledActionKey]);

  useEffect(() => {
    const video = clipVideoRef.current;
    const canvas = canvasRef.current;
    if (!activeClip || !video || !canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    let frameId = 0;

    const drawFrame = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        context.drawImage(video, 0, 0, width, height);
      }
      frameId = window.requestAnimationFrame(drawFrame);
    };

    frameId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [activeClip]);

  function handleClipEnded() {
    if (!activeClip || activeClip.loop) return;
    if (activeClip.category === "action") {
      setSettledActionKey(activeClip.presentationKey ?? null);
    }
    setActiveClip(null);
  }

  return (
    <div aria-label="AI interviewer video" className="interviewer-avatar-video" role="img">
      <img alt="" className="interviewer-avatar-still" src={INTERVIEWER_VIDEO_PATHS.idle} />
      {activeClip && !prefersReducedMotion ? (
        <>
          <canvas
            aria-hidden="true"
            className="interviewer-avatar-video-layer is-visible"
            ref={canvasRef}
          />
          <video
            aria-hidden="true"
            autoPlay
            className="interviewer-avatar-video-source"
            controls={false}
            disablePictureInPicture
            disableRemotePlayback
            key={activeClip.id}
            loop={activeClip.loop}
            muted
            onEnded={handleClipEnded}
            playsInline
            preload="auto"
            ref={clipVideoRef}
            src={activeClip.source}
            tabIndex={-1}
          />
        </>
      ) : null}
    </div>
  );
}
