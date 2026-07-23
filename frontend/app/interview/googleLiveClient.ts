import type { LiveInterviewerStateProposal } from "./interviewSession";

export type GoogleLiveMessage = {
  setupComplete?: object;
  error?: {
    message?: string;
  };
  toolCall?: {
    functionCalls?: GoogleFunctionCall[];
  };
  sessionResumptionUpdate?: {
    resumable?: boolean;
    newHandle?: string;
  };
  goAway?: {
    timeLeft?: string;
  };
  serverContent?: {
    interrupted?: boolean;
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

export type GoogleFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type GoogleFunctionResponse = {
  id: string;
  name: string;
  response: {
    result: {
      approved: boolean;
      approvedDecision: string;
      answerStatus?: LiveInterviewerStateProposal["answer_status"];
      completionPercentage?: number;
      coveredRequirements?: string[];
      missingRequirements?: string[];
      reasonCode: string;
      verificationGuidance?: string | null;
      currentQuestion?: string | null;
      questionIndex?: number;
      totalQuestions?: number;
      state?: string;
      previousQuestion?: string | null;
      instruction?: string;
    };
  };
};

export function getGoogleLiveSocketUrl(): string {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/google/live";
  return url.toString();
}

export function parseGoogleLiveMessage(
  rawMessage: string,
): GoogleLiveMessage | null {
  try {
    return JSON.parse(rawMessage) as GoogleLiveMessage;
  } catch {
    return null;
  }
}

export async function readGoogleLiveSocketData(
  data: unknown,
): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return null;
}

export async function getUserMediaWithTimeout(
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

export function downsampleAudio(
  samples: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return samples;

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

export function pcm16ToBase64(samples: Float32Array): string {
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

export function playGoogleAudio(
  audioContext: AudioContext,
  encodedAudio: string,
  mimeType: string,
  playbackCursor: number,
  activeSources: Set<AudioBufferSourceNode>,
  onQueueEnded: () => void,
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
    if (activeSources.size === 0) onQueueEnded();
  };
  const startAt = Math.max(audioContext.currentTime + 0.02, playbackCursor);
  source.start(startAt);
  return startAt + audioBuffer.duration;
}
