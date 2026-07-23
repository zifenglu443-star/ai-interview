"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const cameraRequestTimeoutMs = 15_000;

export function useCameraPreview() {
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Camera off");
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const cameraRequestInFlightRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopCamera = useCallback(() => {
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
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraStreamRef.current || cameraRequestInFlightRef.current) {
      return;
    }

    const requestId = cameraRequestIdRef.current + 1;
    cameraRequestIdRef.current = requestId;
    cameraRequestInFlightRef.current = true;
    setIsCameraStarting(true);
    setCameraStatus("Allow camera access in the browser prompt...");
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
        }, cameraRequestTimeoutMs);
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
    } catch (error) {
      if (requestId === cameraRequestIdRef.current) {
        setIsCameraOn(false);
        setCameraStatus(
          timedOut
            ? "Camera request timed out"
            : error instanceof DOMException && error.name === "NotAllowedError"
              ? "Camera blocked; allow it in browser site settings"
              : "Camera unavailable",
        );
      }
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (requestId === cameraRequestIdRef.current) {
        cameraRequestInFlightRef.current = false;
        setIsCameraStarting(false);
      }
    }

    if (timedOut) {
      void mediaPromise
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
        })
        .catch(() => undefined);
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      stopCamera();
      return;
    }
    await startCamera();
  }, [isCameraOn, startCamera, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  return {
    cameraStatus,
    isCameraOn,
    isCameraStarting,
    startCamera,
    stopCamera,
    toggleCamera,
    videoRef,
  };
}
