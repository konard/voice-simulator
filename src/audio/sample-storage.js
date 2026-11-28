/** Reuse bounded waveform storage between synchronous consumers. Unlicense. */
const MAX_RETAINED_SAMPLES = 1024 * 1024;

export function sampleStorage() {
  let samples = new Float32Array(0);
  return (length) => {
    if (length > MAX_RETAINED_SAMPLES) {
      return new Float32Array(length);
    }
    if (length > samples.length) {
      samples = new Float32Array(
        Math.min(MAX_RETAINED_SAMPLES, Math.max(length, 2 * samples.length))
      );
    }
    return samples.subarray(0, length);
  };
}
