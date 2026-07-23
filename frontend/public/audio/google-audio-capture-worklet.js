class GoogleAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(1024);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const count = Math.min(
        channel.length - sourceOffset,
        this.pending.length - this.offset,
      );
      this.pending.set(
        channel.subarray(sourceOffset, sourceOffset + count),
        this.offset,
      );
      sourceOffset += count;
      this.offset += count;

      if (this.offset === this.pending.length) {
        const samples = this.pending;
        this.port.postMessage(samples, [samples.buffer]);
        this.pending = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("google-audio-capture", GoogleAudioCaptureProcessor);
