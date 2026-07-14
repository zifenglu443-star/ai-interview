import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INTERVIEWER_VIDEO_PATHS,
  selectInterviewerPresentation,
} from "./interviewerVideoState.ts";

test("speaking is driven by audio and uses a loopable short clip", () => {
  assert.deepEqual(
    selectInterviewerPresentation({ emotion: "curious", gesture: "nod_once", isSpeaking: true }),
    {
      kind: "speech",
      key: "speaking-question",
      sources: [...INTERVIEWER_VIDEO_PATHS.speakingQuestion],
    },
  );
});

test("maps Director actions to one-shot video states", () => {
  assert.equal(
    selectInterviewerPresentation({ emotion: "neutral", gesture: "nod_once", isSpeaking: false }).key,
    "nod-once",
  );
  assert.equal(
    selectInterviewerPresentation({ emotion: "neutral", gesture: "look_whiteboard", isSpeaking: false }).key,
    "look-screen",
  );
  assert.equal(
    selectInterviewerPresentation({ emotion: "neutral", gesture: "take_note", isSpeaking: false }).key,
    "take-note",
  );
});

test("returns to a still idle base when no action is requested", () => {
  assert.deepEqual(
    selectInterviewerPresentation({ emotion: "attentive", gesture: "idle", isSpeaking: false }),
    { kind: "idle", key: "idle" },
  );
});

test("makes meaningful idle gestures visible even when the model omits an explicit motion", () => {
  assert.equal(
    selectInterviewerPresentation({ emotion: "skeptical", gesture: "idle", isSpeaking: false }).key,
    "think",
  );
  assert.equal(
    selectInterviewerPresentation({ emotion: "satisfied", gesture: "idle", isSpeaking: false }).key,
    "nod-once",
  );
});

test("ships every visual asset selected by the presenter", () => {
  const publicDirectory = fileURLToPath(new URL("../../public/", import.meta.url));
  const assets = [
    INTERVIEWER_VIDEO_PATHS.idle,
    ...INTERVIEWER_VIDEO_PATHS.blink,
    ...INTERVIEWER_VIDEO_PATHS.nod,
    ...INTERVIEWER_VIDEO_PATHS.speakingPrimary,
    ...INTERVIEWER_VIDEO_PATHS.speakingQuestion,
    ...INTERVIEWER_VIDEO_PATHS.thinking,
    ...INTERVIEWER_VIDEO_PATHS.leanIn,
    ...INTERVIEWER_VIDEO_PATHS.lookingAtScreen,
    ...INTERVIEWER_VIDEO_PATHS.takingNotes,
  ];
  for (const asset of assets) {
    assert.equal(existsSync(`${publicDirectory}${asset}`), true, `${asset} is missing`);
  }
});
