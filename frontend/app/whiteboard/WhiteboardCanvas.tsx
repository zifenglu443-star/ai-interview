"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createShapeId, downsizeImage, toRichText, type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import {
  whiteboardChannelName,
  whiteboardCurrentQuestionStorageKey,
  whiteboardPersistenceKey,
  whiteboardSnapshotStorageKey,
  type WhiteboardFrame,
  type AiWhiteboardOperation,
  type WhiteboardSyncMessage,
} from "./whiteboardSync";

const whiteboardExportDelayMs = 1200;

function applyAiOperations(editor: Editor, operations: AiWhiteboardOperation[]) {
  const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
  for (const operation of operations) {
    if (operation.kind === "question" || operation.kind === "note" || operation.kind === "summary") {
      if (operation.kind === "question") {
        const previousQuestionIds = editor
          .getCurrentPageShapes()
          .filter((shape) => shape.meta.aiRole === "current-question")
          .map((shape) => shape.id);
        if (previousQuestionIds.length) editor.deleteShapes(previousQuestionIds);
        editor.createShape({ id: createShapeId(), type: "text", x: 40, y: 24, meta: { aiRole: "current-question" }, props: { color: "blue", size: "m", font: "sans", textAlign: "start", w: 900, richText: toRichText(operation.text.slice(0, 500)), autoSize: true, scale: 1 } });
        continue;
      }
      const bounds = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1200, h: 800 };
      const x = bounds.x - 40 + clampUnit(operation.x) * (bounds.w + 80);
      const y = bounds.y - 40 + clampUnit(operation.y) * (bounds.h + 80);
      editor.createShape({ id: createShapeId(), type: "text", x, y, meta: { aiRole: "annotation" }, props: { color: operation.kind === "summary" ? "green" : "red", size: "m", font: "sans", textAlign: "start", w: 360, richText: toRichText(operation.text.slice(0, 240)), autoSize: true, scale: 1 } });
      continue;
    }
    const bounds = editor.getCurrentPageBounds() ?? { x: 0, y: 0, w: 1200, h: 800 };
    const mapX = (value: number) => bounds.x - 40 + clampUnit(value) * (bounds.w + 80);
    const mapY = (value: number) => bounds.y - 40 + clampUnit(value) * (bounds.h + 80);
    const x = mapX(operation.x);
    const y = mapY(operation.y);
    if (operation.kind === "arrow" || operation.kind === "line") {
      editor.createShape({ id: createShapeId(), type: "arrow", x, y, meta: { aiRole: "annotation" }, props: { kind: "arc", color: "red", fill: "none", dash: "solid", size: "m", arrowheadStart: "none", arrowheadEnd: operation.kind === "arrow" ? "arrow" : "none", font: "sans", start: { x: 0, y: 0 }, end: { x: mapX(operation.toX) - x, y: mapY(operation.toY) - y }, bend: 0, richText: toRichText(""), labelPosition: 0.5, scale: 1, elbowMidPoint: 0.5 } });
      continue;
    }
    if (operation.kind === "circle" || operation.kind === "highlight") {
      editor.createShape({ id: createShapeId(), type: "geo", x, y, meta: { aiRole: "annotation" }, props: { geo: "ellipse", w: Math.max(24, clampUnit(operation.w) * (bounds.w + 80)), h: Math.max(24, clampUnit(operation.h) * (bounds.h + 80)), labelColor: "black", color: operation.kind === "circle" ? "red" : "yellow", fill: operation.kind === "highlight" ? "semi" : "none", dash: "solid", size: "m", font: "sans", richText: toRichText(""), align: "middle", verticalAlign: "middle", growY: 0, scale: 1, url: "" } });
    }
  }
}

export default function WhiteboardCanvas() {
  const editorRef = useRef<Editor | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const exportTimerRef = useRef<number | null>(null);
  const initialExportTimerRef = useRef<number | null>(null);
  const storeCleanupRef = useRef<(() => void) | null>(null);
  const exportInFlightRef = useRef(false);
  const exportAgainRef = useRef(false);
  const [syncStatus, setSyncStatus] = useState("Waiting for canvas");

  const publishWhiteboard = useCallback(async () => {
    const editor = editorRef.current;
    const channel = channelRef.current;
    if (!editor || !channel) {
      return;
    }
    if (exportInFlightRef.current) {
      exportAgainRef.current = true;
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
        setSyncStatus("Blank board shared");
        return;
      }

      const image = await editor.toImage(shapes, {
        background: true,
        format: "jpeg",
        padding: 40,
        pixelRatio: 1,
        quality: 0.8,
      });
      const maximumDimension = 1280;
      const scale = Math.min(1, maximumDimension / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const blob =
        scale < 1
          ? await downsizeImage(image.blob, width, height, {
              quality: 0.8,
              type: "image/jpeg",
            })
          : image.blob;
      const encodedImage = await blobToBase64(blob);
      if (channelRef.current !== channel) return;

      const frame: WhiteboardFrame = {
        type: "whiteboard-frame",
        data: encodedImage,
        mimeType: "image/jpeg",
        updatedAt: Date.now(),
        width,
        height,
      };
      window.localStorage.setItem(
        whiteboardSnapshotStorageKey,
        JSON.stringify(frame),
      );
      channel.postMessage(frame satisfies WhiteboardSyncMessage);
      setSyncStatus("Latest drawing shared");
    } catch {
      if (channelRef.current === channel) setSyncStatus("Could not share drawing");
    } finally {
      exportInFlightRef.current = false;
      if (exportAgainRef.current && channelRef.current === channel) {
        exportAgainRef.current = false;
        if (exportTimerRef.current !== null) {
          window.clearTimeout(exportTimerRef.current);
        }
        exportTimerRef.current = window.setTimeout(() => {
          exportTimerRef.current = null;
          void publishWhiteboard();
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
        void publishWhiteboard();
      }
      if (event.data.type === "apply-ai-whiteboard-ops") {
        const editor = editorRef.current;
        if (editor) {
          applyAiOperations(editor, event.data.operations);
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
      exportAgainRef.current = false;
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
    const currentQuestion = loadCurrentQuestion();
    if (currentQuestion) {
      applyAiOperations(editor, [{ kind: "question", text: `Question ${currentQuestion.questionIndex + 1}: ${currentQuestion.prompt}` }]);
    }
    if (initialExportTimerRef.current !== null) {
      window.clearTimeout(initialExportTimerRef.current);
    }
    initialExportTimerRef.current = window.setTimeout(() => {
      initialExportTimerRef.current = null;
      void publishWhiteboard();
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
