/** Check a waveform or the occupied prefix of a reusable sample buffer. */
export function samplesAreFinite(samples, length = samples.length) {
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(samples[i])) {
      return false;
    }
  }
  return true;
}
