import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { downsampleAudio } from "./googleLiveClient.ts";

test("Google audio capture downsamples worklet chunks to 16 kHz", () => {
  const input = Float32Array.from({ length: 480 }, (_, index) =>
    Math.sin(index / 10),
  );

  const output = downsampleAudio(input, 48_000, 16_000);

  assert.equal(output.length, 160);
  assert.equal(output.every(Number.isFinite), true);
});

test("Google microphone capture uses AudioWorklet instead of ScriptProcessor", async () => {
  const [page, worklet] = await Promise.all([
    readFile(new URL("./page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../public/audio/google-audio-capture-worklet.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(page.includes("createScriptProcessor"), false);
  assert.equal(page.includes("ScriptProcessorNode"), false);
  assert.match(page, /audioProcessingFailureRef/);
  assert.match(page, /audioContext\.state === "suspended"/);
  assert.match(worklet, /registerProcessor\("google-audio-capture"/);
});
