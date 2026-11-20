/** Commit mode decisions before any phone in the undecided speech. Unlicense. */
import {
  clipWhisperSpans,
  findWhisper,
  loudFrameLimit,
  whisperSpeechRuns,
  whisperVoiceEdges,
} from './whisper.js';

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
  { final, paused, pausedAt, newRun, clock, nextCheck, frames, pitch }
) {
  return (
    run &&
    (final ||
      (paused && run.end !== pausedAt) ||
      (!paused &&
        (newRun || clock >= nextCheck) &&
        hasDecidablePitch(run, frames, pitch)))
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

function pendingEdge(run, frames, pitch, current, fixedThrough) {
  if (!run) {
    return null;
  }
  const edge = whisperVoiceEdges(run, frames, pitch, pitch.committed).find(
    ({ edge }) => edge === 'trailing'
  );
  if (
    !edge ||
    edge.start < fixedThrough - 1e-9 ||
    current.some((span) => span.start <= edge.start && edge.start < span.end)
  ) {
    return null;
  }
  return edge;
}

function extendOpenSpan(current, run, frames, pitch, through) {
  const latest = current.at(-1);
  if (!latest || !run || latest.end < run.start) {
    return current;
  }
  const { startTime, hop } = frames;
  const first = Math.ceil((latest.end - startTime) / hop - 1e-9);
  const nextVoice = pitch.f0
    .subarray(first, pitch.committed)
    .findIndex((f0) => f0 > 0);
  const voicedAt =
    nextVoice < 0 ? Infinity : startTime + (first + nextVoice) * hop;
  const end = Math.max(latest.end, Math.min(through, run.end, voicedAt));
  return [...current.slice(0, -1), { ...latest, end }];
}

function scoredThrough(
  pending,
  current,
  run,
  { clock, paused, end, frames, pitch }
) {
  if (paused || !run) {
    return end;
  }
  // Keep the edge available for classification until its half-second deadline.
  if (
    pending &&
    clock < pending.start + 0.5 &&
    !current.some(
      (span) => span.start <= pending.start && pending.start < span.end
    )
  ) {
    return pending.start;
  }
  // A quiet tail may become a whisper span. Strong frames can already feed
  // the formant tracker while their pitch is still being confirmed.
  const observed =
    current.at(-1)?.end >= run.start
      ? pitch.committed
      : loudFrameLimit(frames.energy, run.from, run.to, pitch.committed);
  return frames.startTime + observed * frames.hop;
}

export function createWhisperDecisions(frames, pitch, option) {
  const decided = [];
  let nextCheck = 0;
  let currentStart;
  let pausedAt;
  let current = [];
  let edgeCheck = 0;
  function classify(last, fixedThrough, clock, paused) {
    if (last.start !== currentStart) {
      decided.push(...current);
      current = [];
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
    if (paused) {
      pausedAt = last.end;
    }
    nextCheck = clock + 0.5;
    edgeCheck = clock + 0.05;
  }
  return {
    advance(final, fixedThrough = frames.startTime) {
      const end = frames.startTime + frames.sampleCount / frames.rate;
      if (option !== 'auto') {
        return { through: end, spans: clipWhisperSpans(option || [], end) };
      }
      const last = whisperSpeechRuns(frames).at(-1);
      const clock = frames.startTime + frames.count * frames.hop;
      const confirmed = frames.startTime + pitch.committed * frames.hop;
      const paused = last && clock - last.end >= 0.2 - 1e-9;
      const newRun = last && last.start !== currentStart;
      const pending =
        !newRun && pendingEdge(last, frames, pitch, current, fixedThrough);
      const edgeDue =
        pending &&
        confirmed >= pending.start + 0.3 - 1e-9 &&
        clock >= edgeCheck;
      if (
        edgeDue ||
        decisionDue(last, {
          final,
          paused,
          pausedAt,
          newRun,
          clock,
          nextCheck,
          frames,
          pitch,
        })
      ) {
        classify(last, fixedThrough, clock, paused);
      }
      if (final) {
        return { through: end, spans: decided.concat(current) };
      }
      if (!paused) {
        current = extendOpenSpan(current, last, frames, pitch, confirmed);
      }
      const cutoff = last && last.start !== currentStart ? last.start : end;
      const through = scoredThrough(pending, current, last, {
        clock,
        paused,
        end,
        frames,
        pitch,
      });
      return {
        through: Math.max(fixedThrough, Math.min(cutoff, through)),
        spans: decided.concat(current),
      };
    },
  };
}
