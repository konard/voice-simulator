/** Analysis-by-synthesis rescoring of timed n-best IPA readings. Unlicense. */
import {
  joinSegments,
  syllablesOf,
  syllablesWithWhisper,
  normalizeReadingConfidence,
} from './decode-pipeline.js';
import { planReading } from './rescoring-plan.js';
import { findRescoringRegions, pieceKey } from './rescoring-regions.js';
import {
  recordingBias,
  renderCepstra,
  scoringWindow,
  timedCepstra,
  scoreJob,
} from './rescoring-score.js';
import { RESCORING_WEIGHT } from './rescoring-weights.js';
import { whisperModeSpans, wrapWhisperIpa } from './whisper-result.js';

export { planReading, warpPlan } from './rescoring-plan.js';
export { scoreJob } from './rescoring-score.js';

function recordingAnalysis(decoded) {
  const { frames, whisperSpans } = decoded;
  const track = timedCepstra(
    frames.samples.subarray(0, frames.sampleCount),
    frames.rate,
    frames.startTime,
    whisperSpans
  );
  const referencePlan = planReading(decoded, decoded.nbest[0].segments);
  const reference = renderCepstra(referencePlan, frames.rate, whisperSpans);
  const { start, step } = track;
  return {
    track,
    reference,
    grid: { start, step },
    bias: recordingBias(track, reference, frames),
    renderSeconds: renderedDuration(referencePlan, frames.rate),
  };
}

function renderedDuration(plan, rate) {
  return Math.ceil(plan.duration * rate) / rate;
}

function regionJobs(decoded, region, analysis) {
  const { start, end, before, after, alternatives, keys } = region;
  const { grid, track, reference, bias } = analysis;
  const from = before[0]?.start ?? start;
  const to = after[0]?.end ?? end;
  const recording = scoringWindow(track, grid, from, to, start, end);
  const recordedReference = scoringWindow(
    reference,
    grid,
    from,
    to,
    start,
    end
  ).rows;
  return alternatives.map(({ key, segments }) => ({
    start,
    end,
    from,
    to,
    recording,
    grid,
    bias,
    rate: decoded.frames.rate,
    ...(decoded.whisperSpans?.length && {
      whisperSpans: decoded.whisperSpans,
    }),
    ...(key === keys[0]
      ? { reference: recordedReference }
      : { plan: planReading(decoded, [...before, ...segments, ...after]) }),
  }));
}

function optionsFor(decoded, options) {
  const {
    maxAlternatives = 5,
    margin = 3,
    maxRenderSeconds = (2 * decoded.frames.sampleCount) / decoded.frames.rate,
  } = options;
  if (
    !Number.isSafeInteger(maxAlternatives) ||
    maxAlternatives < 1 ||
    !(margin >= 0) ||
    !(maxRenderSeconds >= 0)
  ) {
    throw new RangeError(
      'Expected a positive maxAlternatives and non-negative margin and maxRenderSeconds'
    );
  }
  return { maxAlternatives, margin, maxRenderSeconds };
}

/** Prepare cloneable, independent scoring jobs in priority order. */
export function planRescoring(decoded, options = {}) {
  const { maxAlternatives, margin, maxRenderSeconds } = optionsFor(
    decoded,
    options
  );
  const preserveTiming = options.preserveTiming === true;
  const regions = findRescoringRegions(
    decoded.nbest,
    maxAlternatives,
    margin,
    preserveTiming
  );
  const preparation = {
    preserveTiming,
    regions: regions.length,
    scheduled: [],
    jobs: [],
    renders: 0,
    renderSeconds: 0,
  };
  if (regions.length === 0 || decoded.frames.sampleCount === 0) {
    return preparation;
  }
  const analysis = recordingAnalysis(decoded);
  let seconds = 0;
  let renders = 1;
  for (const region of regions) {
    if (seconds > maxRenderSeconds) {
      break;
    }
    const jobs = regionJobs(decoded, region, analysis);
    for (const job of jobs) {
      if (job.plan) {
        seconds += renderedDuration(job.plan, job.rate);
        renders++;
      }
    }
    preparation.scheduled.push({
      start: region.start,
      end: region.end,
      phones: region.phones,
      keys: region.keys,
      alternatives: region.alternatives,
    });
    preparation.jobs.push(...jobs);
  }
  return {
    ...preparation,
    renders,
    renderSeconds: seconds + analysis.renderSeconds,
  };
}

function evaluateRegion(region, scores, weight, readings) {
  const scale = weight * region.phones;
  const baseKey = region.keys[0];
  const baseCost = readings[0].cost;
  const decoderCosts = new Map();
  // A piece excludes the transition into the following phone. Use the
  // cheapest complete path through each piece when weighing a revision.
  for (const [index, key] of region.keys.entries()) {
    const cost = readings[index].cost - baseCost;
    decoderCosts.set(key, Math.min(decoderCosts.get(key) ?? Infinity, cost));
  }
  const penalties = new Map();
  let winner;
  let best = Infinity;
  for (const [index, alternative] of region.alternatives.entries()) {
    const penalty = scale * scores[index];
    penalties.set(alternative.key, penalty);
    const cost = decoderCosts.get(alternative.key) + penalty;
    if (cost < best || (cost === best && alternative.key === baseKey)) {
      best = cost;
      winner = alternative;
    }
  }
  const confidence =
    1 /
    region.alternatives.reduce(
      (sum, { key }) =>
        sum + Math.exp(best - decoderCosts.get(key) - penalties.get(key)),
      0
    );
  const fallback = scale * Math.max(...scores);
  return {
    ...region,
    winner,
    confidence,
    winnerPenalty: penalties.get(winner.key),
    penalties: region.keys.map((key) => penalties.get(key) ?? fallback),
    changed: winner.key !== baseKey,
  };
}

function spliceAnswer(base, scored) {
  const segments = [];
  let first = 0;
  let delta = 0;
  for (const region of [...scored].sort((a, b) => a.start - b.start)) {
    while (base.segments[first]?.end <= region.start) {
      segments.push(base.segments[first++]);
    }
    while (base.segments[first]?.end <= region.end) {
      const segment = base.segments[first++];
      if (region.changed) {
        delta -= segment.cost;
      } else {
        segments.push(segment);
      }
    }
    if (region.changed) {
      delta += region.winner.cost;
      segments.push(
        ...region.winner.segments.map((segment) => ({
          ...segment,
          revised: true,
          confidence: region.confidence,
        }))
      );
    }
  }
  return { segments: segments.concat(base.segments.slice(first)), delta };
}

function revisePublishedIpa(published, revised) {
  return revised === published.ipa
    ? published
    : { ...published, ipa: revised, revised: true };
}

function revisePublishedPhone(published, reading) {
  if (published.ipa === reading.ipa) {
    return published;
  }
  const { whispered, voicing, tones, ...timed } = published;
  if (!whispered && voicing === undefined && !reading.whispered) {
    return revisePublishedIpa(published, reading.ipa);
  }
  const vowelTones = reading.kind === 'vowel' && (reading.tones ?? tones);
  return {
    ...timed,
    ipa: reading.ipa,
    kind: reading.kind,
    revised: true,
    ...((reading.whispered || vowelTones) && { whispered: true }),
    ...(reading.voicing !== undefined && { voicing: reading.voicing }),
    ...(vowelTones && { tones: vowelTones }),
  };
}

/** Combine regional distances with decoder costs. */
export function applyRescoring(decoded, preparation, scores, weight) {
  let first = 0;
  const scored = preparation.scheduled.map((region) => {
    const last = first + region.alternatives.length;
    const result = evaluateRegion(
      region,
      scores.slice(first, last),
      weight,
      decoded.nbest
    );
    first = last;
    return result;
  });
  const rescoring = {
    regions: preparation.regions,
    scored: scored.length,
    renders: preparation.renders,
    changed: scored.filter(({ changed }) => changed).length,
    renderSeconds: preparation.renderSeconds,
  };
  if (scored.length === 0) {
    return { ...decoded, rescoring };
  }
  const base = decoded.nbest[0];
  const reading = spliceAnswer(base, scored);
  const segments = preparation.preserveTiming
    ? decoded.segments.map((segment, index) =>
        revisePublishedPhone(segment, reading.segments[index])
      )
    : reading.segments;
  const spans = decoded.whisperSpans ?? [];
  const modes = whisperModeSpans(segments, spans);
  const ipa = wrapWhisperIpa(segments, modes);
  const answer = {
    ...base,
    ipa,
    segments,
    cost:
      base.cost +
      reading.delta +
      scored.reduce((sum, { winnerPenalty }) => sum + winnerPenalty, 0),
  };
  const key = pieceKey(segments);
  const readings = decoded.nbest
    .map((reading, index) => ({
      ...reading,
      cost:
        reading.cost +
        scored.reduce((sum, { penalties }) => sum + penalties[index], 0),
    }))
    .sort((a, b) => a.cost - b.cost);
  const match = readings.findIndex(
    (reading) => pieceKey(reading.segments) === key
  );
  if (match !== -1) {
    answer.cost = readings[match].cost;
    readings.splice(match, 1);
  }
  const nbest = [answer, ...readings];
  normalizeReadingConfidence(nbest);
  const syllables = preparation.preserveTiming
    ? decoded.syllables.map((syllable) =>
        revisePublishedIpa(
          syllable,
          joinSegments(segments.slice(...syllable.segments))
        )
      )
    : spans.length
      ? syllablesWithWhisper(segments, decoded.language, spans, decoded.frames)
      : syllablesOf(segments, decoded.language);
  return {
    ...decoded,
    ipa,
    segments,
    syllables,
    nbest,
    ...(spans.length && { modes }),
    rescoring,
  };
}

/** Rescore uncertain spans with the waveguide using the decoder's fitted voice. */
export function rescoreHypotheses(decoded, options = {}) {
  const started = globalThis.performance.now();
  const weight = options.weight ?? RESCORING_WEIGHT;
  if (!Number.isFinite(weight) || weight < 0) {
    throw new RangeError('Expected a finite, non-negative rescoring weight');
  }
  const preparation = planRescoring(decoded, options);
  const result = applyRescoring(
    decoded,
    preparation,
    preparation.jobs.map(scoreJob),
    weight
  );
  result.rescoring.seconds = (globalThis.performance.now() - started) / 1000;
  return result;
}
