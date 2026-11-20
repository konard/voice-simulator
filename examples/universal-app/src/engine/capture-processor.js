class CaptureProcessor extends globalThis.AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) {
      const samples = channel.slice();
      this.port.postMessage(samples, [samples.buffer]);
    }
    // The output remains silent to keep the microphone out of the speakers.
    return true;
  }
}

globalThis.registerProcessor('recognition-capture', CaptureProcessor);
