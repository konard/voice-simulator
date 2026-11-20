/** Trace evidence and decision times for a continuous voiced-to-whisper change. Unlicense. */
import { createFrameAnalyzer } from '../src/index.js';
import { energyRatio } from '../src/analysis/mode-features.js';
import { createPitchTracker } from '../src/recognition/pitch.js';
import { findWhisper, whisperSpeechRuns } from '../src/recognition/whisper.js';
import { createWhisperDecisions } from '../src/recognition/whisper-stream.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const { samples, sampleRate, timeline } = renderWhisper(
  'one two three [whisper] four five six'
);
const input = createFrameAnalyzer(sampleRate);
const { frames } = input;
const pitch = createPitchTracker(frames);
const classifier = createWhisperDecisions(frames, pitch.track, 'auto');
const quantum = Math.floor(sampleRate * 0.02);
console.log('four starts', timeline.words[3].start);
for (let start = 0; start < samples.length; start += quantum) {
  input.push(samples.subarray(start, start + quantum));
  pitch.advance();
  const time = frames.sampleCount / frames.rate;
  const runs = whisperSpeechRuns(frames);
  const decision = classifier.advance(false);
  if (start % (quantum * 5) === 0) {
    const lastVoiced = pitch.track.f0
      .subarray(0, pitch.track.committed)
      .findLastIndex((f0) => f0 > 0);
    const tail = Array.from(
      { length: Math.min(frames.count, 12) },
      (_, index) => {
        const row = Math.max(0, frames.count - 12) + index;
        return [
          Math.round(frames.energy[row]),
          Math.round(100 * frames.periodicity[row]),
        ];
      }
    );
    const edgeStart = (lastVoiced + 1) * frames.hop;
    const edgeEnd = pitch.track.committed * frames.hop;
    const ratio = (from, to) =>
      energyRatio(
        frames.samples,
        frames.rate,
        from * frames.rate,
        to * frames.rate
      );
    const windows = [];
    for (let from = edgeStart; from + 0.3 <= edgeEnd; from += 0.05) {
      windows.push(ratio(from, from + 0.3));
    }
    console.log(
      JSON.stringify({
        time,
        pitchThrough: pitch.track.committed * frames.hop,
        runs: runs.map(({ start, end }) => [start, end]),
        through: decision.through,
        lastVoiced: lastVoiced * frames.hop,
        tailRatio: ratio(edgeStart, edgeEnd),
        bestRatio: Math.max(...windows),
        tail,
        spans: decision.spans,
        batch: findWhisper(
          frames.samples,
          frames.rate,
          { ...frames, count: pitch.track.committed },
          pitch.track
        ),
      })
    );
  }
}
