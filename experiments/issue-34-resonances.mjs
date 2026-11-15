/**
 * Resonances of an impulse response (issue 34): the peaks of its magnitude
 * spectrum (a DFT on a 5 Hz grid from 100 to 4000 Hz) and their -3 dB
 * bandwidths. Where a neighbouring peak keeps one side above -3 dB, the
 * bandwidth is twice the half width of the other side.
 * @param {ArrayLike<number>} response
 * @param {number} rate Sample rate (Hz).
 * @param {number} count Number of peaks (lowest first).
 */
export function resonances(response, rate, count, from = 100, to = 4000) {
  const frequencies = [];
  const magnitudes = [];
  for (let frequency = from; frequency <= to; frequency += 5) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * frequency) / rate;
    for (let index = 0; index < response.length; index++) {
      re += response[index] * Math.cos(w * index);
      im -= response[index] * Math.sin(w * index);
    }
    frequencies.push(frequency);
    magnitudes.push(Math.hypot(re, im));
  }
  const peaks = [];
  for (let index = 1; index < magnitudes.length - 1; index++) {
    if (
      magnitudes[index] > magnitudes[index - 1] &&
      magnitudes[index] >= magnitudes[index + 1]
    ) {
      peaks.push(index);
    }
  }
  return peaks.slice(0, count).map((index) => {
    const half = magnitudes[index] / Math.SQRT2;
    const edge = (direction) => {
      let position = index;
      for (;;) {
        const next = position + direction;
        if (next < 0 || next >= magnitudes.length) {
          return Number.NaN;
        }
        if (magnitudes[next] > magnitudes[position]) {
          return Number.NaN; // the next peak comes first
        }
        if (magnitudes[next] <= half) {
          const t =
            (magnitudes[position] - half) /
            (magnitudes[position] - magnitudes[next]);
          return frequencies[position] + direction * 5 * t;
        }
        position = next;
      }
    };
    const low = edge(-1);
    const high = edge(1);
    const center = frequencies[index];
    let bandwidth = high - low;
    if (Number.isNaN(low)) {
      bandwidth = 2 * (high - center);
    } else if (Number.isNaN(high)) {
      bandwidth = 2 * (center - low);
    }
    return { frequency: center, bandwidth, magnitude: magnitudes[index] };
  });
}
