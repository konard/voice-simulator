/** Locate cuts inside complete quiet runs of at least 300 ms. Unlicense. */
export function pauseCuts(samples, sampleRate) {
  if (samples.length <= 10 * sampleRate) {
    return [];
  }
  const hop = Math.round(0.01 * sampleRate);
  const levels = new Float64Array(Math.ceil(samples.length / hop));
  let maximum = 0;
  for (let i = 0; i < levels.length; i++) {
    const start = i * hop;
    const end = Math.min(samples.length, start + hop);
    let energy = 0;
    for (let j = start; j < end; j++) {
      energy += samples[j] * samples[j];
    }
    levels[i] = energy / (end - start);
    maximum = Math.max(maximum, levels[i]);
  }
  const threshold = maximum * 0.0001;
  const pause = Math.ceil((0.3 * sampleRate) / hop);
  const cuts = [0];
  let firstQuiet = null;
  let seenSpeech = false;
  for (const [i, energy] of levels.entries()) {
    if (energy <= threshold) {
      firstQuiet ??= i;
    } else {
      if (seenSpeech && firstQuiet !== null && i - firstQuiet >= pause) {
        cuts.push(Math.floor(((firstQuiet + i) * hop) / 2));
      }
      firstQuiet = null;
      seenSpeech = true;
    }
  }
  return cuts.length > 1 ? [...cuts, samples.length] : [];
}
