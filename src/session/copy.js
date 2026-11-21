/** Reproduce the timing, pitch and prosody of speech with simulated audio. Unlicense. */
import { DEFAULT_HEAD } from '../head-config.js';
import { compareRecordings } from '../metrics/compare.js';
import { alignEdits, tokenize } from '../metrics/text.js';
import {
  recognize,
  RecognitionError,
  validateRate,
  validateSamples,
} from '../recognition/recognizer.js';
import { loadVoice, saveVoice } from '../voice-file.js';
import { applyPitch, matchLoudness } from './copy-prosody.js';
import { refineCopy } from './copy-refinement.js';
import {
  planRecording,
  renderScore,
  toScore,
  REFINED_CHANNELS,
} from './score.js';
import { copyVoice } from './voice-session.js';
import { warpPlan } from './warp.js';

const syllables = (result) => result.words.flatMap((word) => word.syllables);
const readings = (syllables) =>
  syllables.map(({ ipa }) => tokenize(ipa, 'phone').join(' '));

function timingError(score, copy) {
  const before = syllables(score);
  const after = syllables(copy);
  const { pairs } = alignEdits(readings(before), readings(after));
  return pairs.length
    ? (1000 *
        pairs.reduce(
          (sum, [i, j]) => sum + Math.abs(before[i].start - after[j].start),
          0
        )) /
        pairs.length
    : null;
}

export function measureCopyMetrics(
  samples,
  sampleRate,
  output,
  score,
  options,
  warnings
) {
  let timing = null;
  const diagnostics = [...warnings];
  try {
    const copy = recognizeWithVoice(
      output.samples,
      output.sampleRate,
      score.voice,
      options
    );
    timing = timingError(score, copy);
  } catch (error) {
    if (!(error instanceof RecognitionError)) {
      throw error;
    }
    diagnostics.push({
      message: `Copy timing could not be measured: ${error.message}`,
    });
  }
  return {
    ...compareRecordings({ samples, sampleRate }, output),
    timingError: timing,
    warnings: diagnostics,
  };
}

function recognizeWithVoice(samples, sampleRate, voice, options) {
  const { head, articulationOffsets } = loadVoice(voice);
  return recognize(samples, sampleRate, {
    languages: options.languages,
    voice: head,
    articulationOffsets,
    deterministic: true,
    segments: true,
  });
}

function analyze(samples, sampleRate, options) {
  if (options.voice) {
    const voice = saveVoice(loadVoice(options.voice));
    return {
      voice,
      recognition: recognizeWithVoice(samples, sampleRate, voice, options),
      warnings: [],
    };
  }
  const copied = copyVoice(samples, sampleRate, {
    languages: options.languages,
  });
  return {
    voice: copied.voice ?? saveVoice(DEFAULT_HEAD),
    recognition: copied.recognition,
    warnings: copied.voice
      ? []
      : [{ message: 'No voice fit was available; using the default voice.' }],
  };
}

export function copyRecording(samples, sampleRate, options = {}) {
  validateRate(sampleRate);
  if (!samples?.length) {
    throw new RangeError('copyRecording needs a nonempty recording');
  }
  validateSamples(samples);
  const { seed = 1, refine = false, refineBudget = 200 } = options;
  if (!Number.isSafeInteger(refineBudget) || refineBudget < 0) {
    throw new RangeError('refineBudget must be a nonnegative integer');
  }
  const analyzed = analyze(samples, sampleRate, options);
  const score = makeScore(analyzed, samples, sampleRate, options, seed);
  if (refine && refineBudget) {
    const refined = refineCopy(score, samples, sampleRate, {
      seed,
      budget: refineBudget,
    });
    score.articulation = Object.fromEntries(
      REFINED_CHANNELS.map((key) => [
        key,
        { rate: refined.frameRate, values: Array.from(refined.channels[key]) },
      ])
    );
  }
  const output = renderScore(score, options);
  const { voice, recognition, warnings } = analyzed;
  const metrics = measureCopyMetrics(
    samples,
    sampleRate,
    output,
    score,
    options,
    warnings
  );
  return { ...output, score, voice, recognition, metrics };
}

function makeScore(
  { voice, recognition, warnings },
  samples,
  sampleRate,
  options,
  seed
) {
  const impose = {
    durations: true,
    pitch: true,
    loudness: true,
    modes: true,
    ...options.impose,
  };
  const modes = impose.modes ? recognition.modes : [];
  let plan = planRecording(
    recognition.ipa,
    recognition.languages[0]?.language,
    voice,
    modes
  );
  const duration = samples.length / sampleRate;
  if (impose.durations) {
    plan = warpPlan(plan, recognition.segments ?? [], { duration });
    warnings.push(...plan.warnings);
  }
  if (impose.pitch) {
    applyPitch(plan, samples, sampleRate, modes);
  }
  if (impose.loudness) {
    matchLoudness(plan, samples, sampleRate, seed);
  }
  const score = toScore(plan, recognition, voice);
  score.planDuration = plan.duration;
  score.duration = duration;
  score.render = { tier: options.tier, seed, sampleRate: options.sampleRate };
  return score;
}
