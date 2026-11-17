/** Acoustic-only evaluation alignment for RESD, which has no transcripts.
 * These are vowel-like voiced intervals, not recognized words. Unlicense. */
import { analyzeFrames, trackPitch, planUtterance } from '../../src/index.js';
export function acousticIntervals(samples, sampleRate) {
  const frames = analyzeFrames(samples, sampleRate, { maxSeconds: 30 });
  const pitch = trackPitch(frames);
  const phones = [];
  let start = null;
  for (let t = 0; t <= frames.count; t++) {
    const active =
      t < frames.count && pitch.f0[t] > 0 && pitch.strength[t] >= 0.7;
    if (active && start === null) {
      start = t * frames.hop;
    }
    const time = t * frames.hop;
    if (start !== null && (!active || time - start >= 0.25)) {
      if (time - start >= 0.04) {
        phones.push({
          start,
          end: Math.min(samples.length / sampleRate, time),
          ipa: 'ə',
        });
      }
      start = active ? time : null;
    }
  }
  return {
    words: [
      {
        start: 0,
        end: samples.length / sampleRate,
        ipa: phones.map(() => 'ə').join(''),
      },
    ],
    phonemes: phones,
  };
}
/** Golden IPA is known, but no phone alignment is annotated. */
export function goldenWords(item) {
  const plan = planUtterance(item.ipa, { language: item.lang });
  const grouped = new Map();
  for (const segment of plan.segments) {
    if (segment.kind !== 'pause' && Number.isInteger(segment.token.word)) {
      const word = segment.token.word;
      if (!grouped.has(word)) {
        grouped.set(word, { start: segment.start, end: segment.end, ipa: '' });
      }
      const row = grouped.get(word);
      row.end = segment.end;
      row.ipa += segment.token.symbol;
    }
  }
  const duration = item.samples.length / item.sampleRate;
  const scale = duration / plan.duration;
  return [...grouped.values()].map((w) => ({
    ...w,
    start: w.start * scale,
    end: w.end * scale,
  }));
}
