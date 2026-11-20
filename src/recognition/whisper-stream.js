/** Commit mode decisions before any phone in the undecided speech. Unlicense. */
import { findWhisper, whisperSpeechRuns } from './whisper.js';

function reconcile(previous, candidates, fixedThrough) {
  const kept = previous
    .filter(({ start }) => start < fixedThrough)
    .map((span) => ({
      ...span,
      end: Math.min(span.end, fixedThrough),
    }));
  for (const span of candidates) {
    if (span.end <= fixedThrough) {
      continue;
    }
    const latest = kept.at(-1);
    const start = Math.max(span.start, fixedThrough);
    if (latest && Math.abs(start - latest.end) < 1e-9) {
      latest.end = span.end;
    } else {
      kept.push({ ...span, start });
    }
  }
  return kept;
}

function decisionDue(
  run,
  { final, paused, newRun, clock, through, nextCheck, pitchReady }
) {
  return (
    run &&
    (final ||
      (paused && through < run.end) ||
      (pitchReady && (newRun || clock >= nextCheck)))
  );
}

function hasDecidablePitch(run, frames, pitch) {
  const halfSecond = Math.ceil(0.5 / frames.hop - 1e-9);
  const to = run.from + halfSecond;
  if (run.to < to) {
    return false;
  }
  if (pitch.committed >= to) {
    return true;
  }
  // A fully observed window can be ruled out while its most recent pitch
  // frames are still provisional, if the confirmed f0 already exceeds 5%.
  let voiced = 0;
  for (let i = run.from; i < pitch.committed; i++) {
    voiced += Number(pitch.f0[i] > 0);
  }
  return voiced >= 0.05 * halfSecond;
}

export function createWhisperDecisions(frames, pitch, option) {
  const decided = [];
  let nextCheck = 0;
  let through = frames.startTime;
  let currentStart;
  let current = [];
  return {
    advance(final, fixedThrough = frames.startTime) {
      const end = frames.startTime + frames.sampleCount / frames.rate;
      if (option !== 'auto') {
        return { through: end, spans: option || [] };
      }
      const runs = whisperSpeechRuns(frames);
      const last = runs.at(-1);
      const clock = frames.startTime + frames.count * frames.hop;
      const paused = last && clock - last.end >= 0.2 - 1e-9;
      const newRun = last && last.start !== currentStart;
      const pitchReady = last && hasDecidablePitch(last, frames, pitch);
      if (
        decisionDue(last, {
          final,
          paused,
          newRun,
          clock,
          through,
          nextCheck,
          pitchReady,
        })
      ) {
        if (newRun) {
          if (current.length) {
            decided.push(...current);
          }
          currentStart = last.start;
        }
        const committedFrames = { ...frames, count: pitch.committed };
        const samples = frames.samples.subarray(0, frames.sampleCount);
        const candidates = findWhisper(
          samples,
          frames.rate,
          committedFrames,
          pitch
        ).filter((span) => span.end >= last.start);
        current = reconcile(current, candidates, fixedThrough);
        nextCheck = clock + 0.5;
        through = clock;
      }
      const active = current.map((span) =>
        !final &&
        !paused &&
        span.end >= frames.startTime + pitch.committed * frames.hop - 1e-9
          ? { ...span, end }
          : span
      );
      const cutoff = last && last.start !== currentStart ? last.start : end;
      return {
        through: final ? end : Math.max(through, cutoff),
        spans: decided.concat(active),
      };
    },
  };
}
