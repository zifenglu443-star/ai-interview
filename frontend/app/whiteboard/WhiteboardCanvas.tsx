"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createShapeId, downsizeImage, toRichText, type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import {
  whiteboardChannelName,
  whiteboardCurrentQuestionStorageKey,
  whiteboardPersistenceKey,
  whiteboardPendingOperationsStorageKey,
  whiteboardSnapshotStorageKey,
  parsePendingWhiteboardOperations,
  removePendingWhiteboardOperation,
  type WhiteboardFrame,
  type AiWhiteboardOperation,
  type WhiteboardSyncMessage,
  type WhiteboardBounds,
} from "./whiteboardSync";

const whiteboardExportDelayMs = 900;
const whiteboardMaximumDimension = 768;
const whiteboardJpegQuality = 0.65;
const whiteboardFingerprintSize = 48;

function getQuestionPlacement(editor: Editor) {
  const viewport = editor.getViewportScreenBounds();
  const zoom = Math.max(editor.getZoomLevel(), 0.01);
  const screenX = viewport.x + 56;
  const screenY = viewport.y + 76;
  const pagePoint = editor.screenToPage({ x: screenX, y: screenY });
  return {
    x: pagePoint.x,
    y: pagePoint.y,
    width: Math.max(220, Math.min(900, (viewport.w - 176) / zoom)),
  };
}

function positionCurrentQuestion(editor: Editor) {
  const placement = getQuestionPlacement(editor);
  const questionIds = editor
    .getPages()
    .flatMap((page) => [...editor.getPageShapeIds(page)])
    .filter((shapeId) => editor.getShape(shapeId)?.meta.aiRole === "current-question");
  for (const shapeId of questionIds) {
    editor.updateShape({
      id: shapeId,
      type: "text",
      x: placement.x,
      y: placement.y,
      props: { w: placement.width },
    });
  }
}

function applyAiOperations(
  editor: Editor,
  operations: AiWhiteboardOperation[],
  sourceBounds?: WhiteboardBounds,
) {
  const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
  for (const operation of operations) {
    if (operation.kind === "question" || operation.kind === "note" || operation.kind === "summary") {
      if (operation.kind === "question") {
        const previousQuestionIds = editor
          .getPages()
          .flatMap((page) => [...editor.getPageShapeIds(page)])
          .filter((shapeId) => editor.getShape(shapeId)?.meta.aiRole === "current-question");
        if (previousQuestionIds.length) editor.deleteShapes(previousQuestionIds);
        const placement = getQuestionPlacement(editor);
        editor.createShape({ id: createShapeId(), type: "text", x: placement.x, y: placement.y, meta: { aiRole: "current-question" }, props: { color: "blue", size: "m", font: "sans", textAlign: "start", w: placement.width, richText: toRichText(operation.text.slice(0, 500)), autoSize: true, scale: 1 } });
        continue;
      }
      const pageBounds = editor.getCurrentPageBounds();
      const bounds = sourceBounds ?? (pageBounds
        ? { x: pageBounds.x - 40, y: pageBounds.y - 40, w: pageBounds.w + 80, h: pageBounds.h + 80 }
        : { x: -40, y: -40, w: 1280, h: 880 });
      const x = bounds.x + clampUnit(operation.x) * bounds.w;
      const y = bounds.y + clampUnit(operation.y) * bounds.h;
      editor.createShape({ id: createShapeId(), type: "text", x, y, meta: { aiRole: "annotation" }, props: { color: operation.kind === "summary" ? "green" : "red", size: "m", font: "sans", textAlign: "start", w: 360, richText: toRichText(operation.text.slice(0, 240)), autoSize: true, scale: 1 } });
      continue;
    }
    const pageBounds = editor.getCurrentPageBounds();
    const bounds = sourceBounds ?? (pageBounds
      ? { x: pageBounds.x - 40, y: pageBounds.y - 40, w: pageBounds.w + 80, h: pageBounds.h + 80 }
      : { x: -40, y: -40, w: 1280, h: 880 });
    const mapX = (value: number) => bounds.x + clampUnit(value) * bounds.w;
    const mapY = (value: number) => bounds.y + clampUnit(value) * bounds.h;
    const x = mapX(operation.x);
    const y = mapY(operation.y);
    if (operation.kind === "arrow" || operation.kind === "line") {
      editor.createShape({ id: createShapeId(), type: "arrow", x, y, meta: { aiRole: "annotation" }, props: { kind: "arc", color: "red", fill: "none", dash: "solid", size: "m", arrowheadStart: "none", arrowheadEnd: operation.kind === "arrow" ? "arrow" : "none", font: "sans", start: { x: 0, y: 0 }, end: { x: mapX(operation.toX) - x, y: mapY(operation.toY) - y }, bend: 0, richText: toRichText(""), labelPosition: 0.5, scale: 1, elbowMidPoint: 0.5 } });
      continue;
    }
    if (operation.kind === "circle" || operation.kind === "highlight") {
      editor.createShape({ id: createShapeId(), type: "geo", x, y, meta: { aiRole: "annotation" }, props: { geo: "ellipse", w: Math.max(24, clampUnit(operation.w) * bounds.w), h: Math.max(24, clampUnit(operation.h) * bounds.h), labelColor: "black", color: operation.kind === "circle" ? "red" : "yellow", fill: operation.kind === "highlight" ? "semi" : "none", dash: "solid", size: "m", font: "sans", richText: toRichText(""), align: "middle", verticalAlign: "middle", growY: 0, scale: 1, url: "" } });
    }
  }
}

export default function WhiteboardCanvas() {
  const editorRef = useRef<Editor | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const exportTimerRef = useRef<number | null>(null);
  const initialExportTimerRef = useRef<number | null>(null);
  const storeCleanupRef = useRef<(() => void) | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const exportInFlightRef = useRef(false);
  const exportAgainRef = useRef(false);
  const exportAgainForceRef = useRef(false);
  const lastPublishedImageRef = useRef("");
  const [syncStatus, setSyncStatus] = useState("Waiting for canvas");

  const publishWhiteboard = useCallback(async (force = false) => {
    const editor = editorRef.current;
    const channel = channelRef.current;
    if (!editor || !channel) {
      return;
    }
    if (exportInFlightRef.current) {
      exportAgainRef.current = true;
      exportAgainForceRef.current ||= force;
      return;
    }
    exportInFlightRef.current = true;

    try {
      const shapes = editor.getCurrentPageShapes();
      if (!shapes.length) {
        window.localStorage.removeItem(whiteboardSnapshotStorageKey);
        channel.postMessage({
          type: "whiteboard-cleared",
          updatedAt: Date.now(),
        } satisfies WhiteboardSyncMessage);
        setSyncStatus("Blank-board snapshot sent to interview room");
        return;
      }

      const image = await editor.toImage(shapes, {
        background: true,
        format: "jpeg",
        padding: 40,
        pixelRatio: 1,
        quality: whiteboardJpegQuality,
      });
      const scale = Math.min(
        1,
        whiteboardMaximumDimension / Math.max(image.width, image.height),
      );
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const blob =
        scale < 1
          ? await downsizeImage(image.blob, width, height, {
              quality: whiteboardJpegQuality,
              type: "image/jpeg",
            })
          : image.blob;
      const encodedImage = await blobToBase64(blob);
      const visualFingerprint = await createVisualFingerprint(blob);
      if (channelRef.current !== channel) return;
      if (!force && encodedImage === lastPublishedImageRef.current) {
        setSyncStatus("Drawing unchanged · no new snapshot needed");
        return;
      }

      const pageBounds = editor.getCurrentPageBounds();
      const frame: WhiteboardFrame = {
        type: "whiteboard-frame",
        data: encodedImage,
        mimeType: "image/jpeg",
        updatedAt: Date.now(),
        width,
        height,
        visualFingerprint,
        bounds: pageBounds
          ? { x: pageBounds.x - 40, y: pageBounds.y - 40, w: pageBounds.w + 80, h: pageBounds.h + 80 }
          : undefined,
      };
      window.localStorage.setItem(
        whiteboardSnapshotStorageKey,
        JSON.stringify(frame),
      );
      lastPublishedImageRef.current = encodedImage;
      channel.postMessage(frame satisfies WhiteboardSyncMessage);
      setSyncStatus("Latest drawing snapshot sent to interview room");
    } catch {
      if (channelRef.current === channel) setSyncStatus("Could not share drawing");
    } finally {
      exportInFlightRef.current = false;
      if (exportAgainRef.current && channelRef.current === channel) {
        exportAgainRef.current = false;
        const forceNextExport = exportAgainForceRef.current;
        exportAgainForceRef.current = false;
        if (exportTimerRef.current !== null) {
          window.clearTimeout(exportTimerRef.current);
        }
        exportTimerRef.current = window.setTimeout(() => {
          exportTimerRef.current = null;
          void publishWhiteboard(forceNextExport);
        }, 0);
      }
    }
  }, []);

  const scheduleWhiteboardExport = useCallback(() => {
    if (exportTimerRef.current !== null) {
      window.clearTimeout(exportTimerRef.current);
    }
    exportTimerRef.current = window.setTimeout(() => {
      exportTimerRef.current = null;
      void publishWhiteboard();
    }, whiteboardExportDelayMs);
  }, [publishWhiteboard]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) {
      setSyncStatus("Live sync unavailable");
      return;
    }

    const channel = new BroadcastChannel(whiteboardChannelName);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<WhiteboardSyncMessage>) => {
      if (event.data.type === "request-whiteboard-frame") {
        void publishWhiteboard(true);
      }
      if (event.data.type === "apply-ai-whiteboard-ops") {
        const editor = editorRef.current;
        if (editor) {
          applyAiOperations(editor, event.data.operations, event.data.bounds);
          window.localStorage.setItem(
            whiteboardPendingOperationsStorageKey,
            removePendingWhiteboardOperation(
              window.localStorage.getItem(whiteboardPendingOperationsStorageKey),
              event.data.id,
            ),
          );
          setSyncStatus("AI annotation added");
          scheduleWhiteboardExport();
        }
      }
      if (event.data.type === "reset-whiteboard") {
        const editor = editorRef.current;
        if (editor) {
          const shapeIds = editor
            .getPages()
            .flatMap((page) => [...editor.getPageShapeIds(page)]);
          if (shapeIds.length) {
            editor.deleteShapes(shapeIds);
          }
        }
        window.localStorage.removeItem(whiteboardSnapshotStorageKey);
        window.localStorage.removeItem(whiteboardCurrentQuestionStorageKey);
        window.localStorage.removeItem(whiteboardPendingOperationsStorageKey);
        lastPublishedImageRef.current = "";
        channel.postMessage({
          type: "whiteboard-cleared",
          updatedAt: Date.now(),
        } satisfies WhiteboardSyncMessage);
        channel.postMessage({
          type: "whiteboard-reset-complete",
          requestId: event.data.requestId,
        } satisfies WhiteboardSyncMessage);
        setSyncStatus("Whiteboard cleared for next interview");
      }
    };
    setSyncStatus("Live sync ready");

    return () => {
      if (exportTimerRef.current !== null) {
        window.clearTimeout(exportTimerRef.current);
      }
      if (initialExportTimerRef.current !== null) {
        window.clearTimeout(initialExportTimerRef.current);
      }
      storeCleanupRef.current?.();
      resizeCleanupRef.current?.();
      exportAgainRef.current = false;
      exportAgainForceRef.current = false;
      editorRef.current = null;
      channel.close();
      channelRef.current = null;
    };
  }, [publishWhiteboard]);

  function handleMount(editor: Editor) {
    editorRef.current = editor;
    storeCleanupRef.current?.();
    storeCleanupRef.current = editor.store.listen(scheduleWhiteboardExport, {
      source: "user",
      scope: "document",
    });
    const handleResize = () => positionCurrentQuestion(editor);
    window.addEventListener("resize", handleResize);
    const canvasElement = document.querySelector(".whiteboard-canvas");
    const resizeObserver = canvasElement && "ResizeObserver" in window
      ? new ResizeObserver(handleResize)
      : null;
    if (canvasElement && resizeObserver) resizeObserver.observe(canvasElement);
    resizeCleanupRef.current = () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    };
    const currentQuestion = loadCurrentQuestion();
    if (currentQuestion) {
      applyAiOperations(editor, [{ kind: "question", text: `Question ${currentQuestion.questionIndex + 1}: ${currentQuestion.prompt}` }]);
    }
    const pendingOperations = parsePendingWhiteboardOperations(
      window.localStorage.getItem(whiteboardPendingOperationsStorageKey),
    );
    for (const batch of pendingOperations) {
      applyAiOperations(editor, batch.operations, batch.bounds);
    }
    if (pendingOperations.length) {
      window.localStorage.removeItem(whiteboardPendingOperationsStorageKey);
      setSyncStatus("Pending AI annotations added");
    }
    if (initialExportTimerRef.current !== null) {
      window.clearTimeout(initialExportTimerRef.current);
    }
    initialExportTimerRef.current = window.setTimeout(() => {
      initialExportTimerRef.current = null;
      void publishWhiteboard(true);
    }, 500);
  }

  return (
    <div className="whiteboard-canvas-shell">
      <div className="whiteboard-sync-status" role="status">
        <span className="live-dot" />
        {syncStatus}
      </div>
      <div className="whiteboard-canvas">
        <Tldraw
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
          locale="en"
          onMount={handleMount}
          persistenceKey={whiteboardPersistenceKey}
        />
      </div>
    </div>
  );
}

function loadCurrentQuestion(): { questionIndex: number; prompt: string } | null {
  try {
    const stored = window.localStorage.getItem(whiteboardCurrentQuestionStorageKey);
    if (!stored) return null;
    const value = JSON.parse(stored) as { type?: string; questionIndex?: number; prompt?: string };
    if (
      value.type !== "whiteboard-current-question" ||
      !Number.isInteger(value.questionIndex) ||
      typeof value.prompt !== "string" ||
      !value.prompt.trim()
    ) return null;
    return { questionIndex: value.questionIndex as number, prompt: value.prompt.trim() };
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const encodedImage = result.split(",", 2)[1];
      if (!encodedImage) {
        reject(new Error("Whiteboard export did not contain image data."));
        return;
      }
      resolve(encodedImage);
    };
    reader.readAsDataURL(blob);
  });
}

async function createVisualFingerprint(blob: Blob): Promise<number[] | undefined> {
  try {
    const bitmap = await window.createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = whiteboardFingerprintSize;
    canvas.height = whiteboardFingerprintSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return undefined;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const fingerprint: number[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
      fingerprint.push(Math.round(
        pixels[index] * 0.2126 +
        pixels[index + 1] * 0.7152 +
        pixels[index + 2] * 0.0722,
      ));
    }
    return fingerprint;
  } catch {
    return undefined;
  }
}
