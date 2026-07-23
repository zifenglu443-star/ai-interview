"use client";

import { useCallback, useEffect, useState } from "react";

import type { DirectorSession } from "../interviewSession";
import { callBackend } from "../interviewRoomUtils";
import {
  clearActiveInterviewPointer,
  loadActiveInterviewPointer,
  saveActiveInterviewPointer,
} from "../sessionRecovery";

export function useInterviewRecovery(
  currentSession: DirectorSession | null,
  isInterviewActive: boolean,
) {
  const [recoverableSession, setRecoverableSession] =
    useState<DirectorSession | null>(null);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(true);

  useEffect(() => {
    const sessionId = loadActiveInterviewPointer();
    if (!sessionId) {
      setIsCheckingRecovery(false);
      return;
    }
    let active = true;
    callBackend<DirectorSession>(`/interview/session/${sessionId}`)
      .then((storedSession) => {
        if (!active) return;
        if (
          storedSession.state === "completed" ||
          storedSession.state === "ended"
        ) {
          clearActiveInterviewPointer();
          return;
        }
        setRecoverableSession(storedSession);
      })
      .catch(() => clearActiveInterviewPointer())
      .finally(() => {
        if (active) setIsCheckingRecovery(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentSession) return;
    if (!isInterviewActive) {
      clearActiveInterviewPointer();
      return;
    }
    saveActiveInterviewPointer(currentSession.session_id);
    const timer = window.setInterval(
      () => saveActiveInterviewPointer(currentSession.session_id),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, [currentSession, isInterviewActive]);

  const takeRecoverableSession = useCallback(() => {
    const storedSession = recoverableSession;
    setRecoverableSession(null);
    return storedSession;
  }, [recoverableSession]);

  const discardRecoverableSession = useCallback(async () => {
    const staleSession = recoverableSession;
    if (!staleSession) return;
    setRecoverableSession(null);
    clearActiveInterviewPointer();
    try {
      await callBackend<DirectorSession>("/interview/end", {
        session_id: staleSession.session_id,
      });
    } catch {
      // An expired backend session needs no further cleanup.
    }
  }, [recoverableSession]);

  return {
    clearRecovery: clearActiveInterviewPointer,
    discardRecoverableSession,
    isCheckingRecovery,
    recoverableSession,
    takeRecoverableSession,
  };
}
