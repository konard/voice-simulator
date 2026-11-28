/**
 * The rows of the lowest-settings matrix (issue 81). Every row works on
 * 8000 Hz audio, runs on the calling thread (no workers, no GPU) and times
 * only the operation under test with process.cpuUsage(). Unlicense.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import {
  copyRecording,
  createRecognizer,
  createVoiceSession,
  errorRate,
  fitVoice,
  loadVoice,
  prepareUtterance,
  presetHeadConfig,
  recognize,
  synthesize,
} from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { createEngine } from '../src/engine/index.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';
import { loadGolden } from '../tests/helpers/golden.js';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';
import { LABELS, HEAD, LANGUAGES } from '../tests/helpers/recognition-modes.js';
import { BASELINE_TEXT } from '../src/recognition/mode-baseline.js';
import {
  BENCHMARK,
  loadBenchmark,
  prepareReference,
  scoreUtterance,
} from '../tests/heavy/helpers/benchmark.js';

export const RATE = 8000;
export const TIER = 'telephone';
export const LEVEL = 'low';
const PRESETS = ['male', 'female', 'child'];
const TEXT =
  'A little bird sings in the morning. We heard it again across the green field. ' +
  'The road climbed slowly through the forest toward a house beside the river. ' +
  'She turned around and saw the lights come on in every room. ' +
  'They brought some tea and set the table before walking home together. ' +
  'The wind blew through the trees while we looked for a place to rest.';

/** CPU seconds (user plus system) spent in fn, with its value. */
export function cpuTime(fn) {
  const start = process.cpuUsage();
  const value = fn();
  const { user, system } = process.cpuUsage(start);
  return [value, (user + system) / 1e6];
}

async function cpuTimeAsync(fn) {
  const start = process.cpuUsage();
  const value = await fn();
  const { user, system } = process.cpuUsage(start);
  return [value, (user + system) / 1e6];
}

const round = (value, digits = 4) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : (value ?? null);

/** Pooled edit rate of {distance, referenceLength} or {errors, length}. */
function pooled(rates) {
  let errors = 0;
  let length = 0;
  for (const rate of rates) {
    errors += rate.distance ?? rate.errors;
    length += rate.referenceLength ?? rate.length;
  }
  return length ? errors / length : null;
}

const relative = (value, truth) => Math.abs(value - truth) / truth;

/**
 * Load the recognition models of `options` before the timed section: the
 * one-time model load is not part of the speed of a row.
 */
function warmUp(options) {
  const { samples } = telephone(
    'Hello world.',
    { lang: 'en', head: 'random', preset: 'male' },
    'js'
  );
  recognize(samples, RATE, { level: LEVEL, ...options });
}

/**
 * Load the engine under test: 'js', or Rust with one thread and no SIMD.
 * Returns {unavailable} when the Rust synthesis or recognition kernels are
 * missing.
 */
export async function loadEngine(name) {
  if (name === 'js') {
    return { name, render: 'js', recognition: 'js' };
  }
  if (name !== 'rust') {
    throw new RangeError(`Unknown engine ${name}`);
  }
  let render;
  try {
    render = await createEngine({ engine: 'rust', threads: 1, simd: false });
  } catch (error) {
    return { unavailable: `Rust engine failed to load: ${error.message}` };
  }
  if (render.name !== 'rust') {
    return {
      unavailable: `Rust engine unavailable: ${render.reason ?? 'fell back to js'}`,
    };
  }
  if (render.simd || render.threads > 1) {
    return { unavailable: 'Rust engine without SIMD and threads is missing' };
  }
  try {
    await createRecognitionEngine({ engine: 'rust' });
  } catch (error) {
    return { unavailable: `Rust recognition kernels: ${error.message}` };
  }
  return { name, render, recognition: 'rust' };
}

function telephone(text, options, engine) {
  return synthesize(text, { tier: TIER, seed: 1, ...options, engine });
}

/** Long English speech from one voice, cut to `seconds`. */
function speech(head, seconds) {
  const { samples, sampleRate } = telephone(TEXT, { head, lang: 'en' }, 'js');
  if (samples.length < seconds * sampleRate) {
    throw new Error('The voice text is too short for the window');
  }
  return samples.subarray(0, seconds * sampleRate);
}

/** Synthesis on the round-trip sentences of issue 75. */
function synthesisRow({ engine, limit, baseline }) {
  // Twenty sentences per language and preset; --limit caps the utterances.
  const cases = [];
  for (let index = 0; index < 20; index++) {
    for (const lang of LANGUAGES) {
      for (const preset of ['male', 'female']) {
        cases.push({ lang, preset, text: sentences[lang][index] });
      }
    }
  }
  cases.length = Math.min(cases.length, limit);
  const heard = (samples, sampleRate, options) =>
    recognize(samples, sampleRate, { ...options, engine: engine.recognition });
  const measure = (tier, timed) => {
    const errors = [];
    let seconds = 0;
    let recognitionSeconds = 0;
    let audioSeconds = 0;
    for (const { lang, preset, text } of cases) {
      const options = { lang, tier, head: 'random', preset, seed: 1 };
      const [spoken, cpu] = cpuTime(() =>
        synthesize(text, { ...options, engine: timed ? engine.render : 'js' })
      );
      seconds += cpu;
      audioSeconds += spoken.samples.length / spoken.sampleRate;
      const [result, recognitionCpu] = cpuTime(() =>
        roundTrip(text, { ...options, spoken, recognize: heard })
      );
      recognitionSeconds += recognitionCpu;
      errors.push(lang === 'zh' ? result.cer : result.wer);
    }
    return { wer: pooled(errors), seconds, recognitionSeconds, audioSeconds };
  };
  const low = measure(TIER, true);
  const base = baseline ? measure('wideband', false) : null;
  return {
    seconds: low.seconds,
    audioSeconds: low.audioSeconds,
    metrics: {
      wer: round(low.wer),
      ...(base && {
        wer16k: round(base.wer),
        werIncrease: round(low.wer - base.wer),
      }),
      rtf: round(low.seconds / low.audioSeconds),
      recognitionRtf: round(low.recognitionSeconds / low.audioSeconds),
      utterances: cases.length,
    },
  };
}

/** Recognition on the public benchmark sets of issue 76. */
async function recognitionRow({ engine, limit, baseline }) {
  warmUp({ engine: engine.recognition });
  const sums = { low: [], base: [] };
  let seconds = 0;
  let audioSeconds = 0;
  let utterances = 0;
  for (const set of BENCHMARK.sets) {
    const rows = await loadBenchmark({ set, limit: Math.min(set.rows, limit) });
    for (const row of rows) {
      const reference = prepareReference(row, set.language);
      if (!reference) {
        continue;
      }
      utterances++;
      const low = resample(row.samples, row.sampleRate, RATE);
      const [result, cpu] = cpuTime(() =>
        recognize(low, RATE, {
          level: LEVEL,
          engine: engine.recognition,
        })
      );
      seconds += cpu;
      audioSeconds += low.length / RATE;
      sums.low.push(scoreUtterance(row, result, set.language, { reference }));
      if (baseline) {
        const wide = resample(row.samples, row.sampleRate, 16000);
        const heard = recognize(wide, 16000, {
          level: 'medium',
          engine: engine.recognition,
        });
        sums.base.push(scoreUtterance(row, heard, set.language, { reference }));
      }
    }
  }
  const rates = (scores) =>
    scores.length
      ? {
          per: pooled(scores.map(({ per }) => per)),
          wer: pooled(scores.map(({ wer, cer }) => wer ?? cer)),
        }
      : null;
  const low = rates(sums.low);
  const base = rates(sums.base);
  return {
    seconds,
    audioSeconds,
    metrics: {
      per: round(low.per),
      wer: round(low.wer),
      ...(base && {
        per16k: round(base.per),
        wer16k: round(base.wer),
        perIncrease: round(low.per - base.per),
        werIncrease: round(low.wer - base.wer),
      }),
      rtf: round(seconds / audioSeconds),
      utterances,
    },
  };
}

/** A minute of English speech from the round-trip sentences. */
export function streamInput(seconds) {
  const parts = [];
  let length = 0;
  const gap = new Float32Array(0.3 * RATE);
  for (let i = 0; length < seconds * RATE; i = (i + 1) % 20) {
    const { samples } = telephone(
      sentences.en[i],
      { lang: 'en', head: 'random', preset: i % 2 ? 'female' : 'male' },
      'js'
    );
    parts.push(samples, gap);
    length += samples.length + gap.length;
  }
  const all = new Float32Array(length);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all.subarray(0, seconds * RATE);
}

/**
 * createRecognizer fed 20 ms chunks at real-time speed. firstPartial is the
 * wall time from the first chunk to the first partial with words; load is
 * the CPU time of the stream over the audio time.
 */
async function streamingRow({ engine, limit }) {
  const duration = Math.min(60, 5 * limit);
  const samples = streamInput(duration);
  const options = {
    sampleRate: RATE,
    level: LEVEL,
    languages: ['en'],
    engine: engine.recognition,
  };
  warmUp(options);
  const recognizer = createRecognizer(options);
  const chunk = 0.02 * RATE;
  let firstPartial = null;
  let partials = 0;
  let started;
  recognizer.on('partial', ({ text }) => {
    partials++;
    if (firstPartial === null && text) {
      firstPartial = (performance.now() - started) / 1000;
    }
  });
  recognizer.on('error', (error) => {
    throw error;
  });
  const [stream, seconds] = await cpuTimeAsync(async () => {
    started = performance.now();
    for (let i = 0; i < samples.length; i += chunk) {
      const due = started + (i / RATE) * 1000;
      const wait = due - performance.now();
      if (wait > 0) {
        await sleep(wait);
      }
      recognizer.push(samples.slice(i, i + chunk));
    }
    return recognizer.flush();
  });
  const batch = recognize(samples, RATE, options);
  const mismatch = errorRate(batch.text, stream.text, 'word');
  return {
    seconds,
    audioSeconds: duration,
    metrics: {
      textMismatch: round(
        mismatch.referenceLength
          ? mismatch.distance / mismatch.referenceLength
          : Number(Boolean(stream.text.trim()))
      ),
      firstPartial: round(firstPartial ?? Infinity),
      load: round(seconds / duration),
      partials,
      streamText: stream.text,
      batchText: batch.text,
      batchLastWord: round(batch.words.at(-1)?.end ?? 0),
    },
  };
}

/** fitVoice on 10 s of each preset voice. */
function voiceFitRow({ engine, limit }) {
  let seconds = 0;
  let audioSeconds = 0;
  const errors = { vocalTractLength: [], pitch: [] };
  for (const preset of PRESETS.slice(0, limit)) {
    const truth = presetHeadConfig(preset);
    const samples = speech(truth, 10);
    const [fit, cpu] = cpuTime(() =>
      fitVoice(samples, RATE, { language: 'en', engine: engine.render })
    );
    seconds += cpu;
    audioSeconds += 10;
    for (const key of Object.keys(errors)) {
      errors[key].push(relative(fit.head[key], truth[key]));
    }
  }
  return {
    seconds,
    audioSeconds,
    metrics: {
      vocalTractLengthError: round(Math.max(...errors.vocalTractLength)),
      pitchError: round(Math.max(...errors.pitch)),
      cpuRatio: round(seconds / audioSeconds),
    },
  };
}

/** A real-time voice session on 20 s of each preset voice. */
async function sessionRow({ engine, limit }) {
  let seconds = 0;
  let audioSeconds = 0;
  let stable = 0;
  const errors = { vocalTractLength: [], pitch: [] };
  const cases = [];
  const presets = PRESETS.slice(0, limit);
  for (const preset of presets) {
    const truth = presetHeadConfig(preset);
    const samples = speech(truth, 20);
    const chunk = 0.02 * RATE;
    const [session, cpu] = await cpuTimeAsync(async () => {
      const session = createVoiceSession({
        sampleRate: RATE,
        languages: ['en'],
        level: LEVEL,
        realtime: true,
        engine: engine.render,
      });
      let stableAt = null;
      session.on('state', ({ state, time }) => {
        if (state === 'stable') {
          stableAt ??= time;
        }
      });
      let failure;
      session.on('error', (error) => {
        failure = error;
      });
      const started = performance.now();
      for (let i = 0; i < samples.length; i += chunk) {
        const wait = started + (i / RATE) * 1000 - performance.now();
        if (wait > 0) {
          await sleep(wait);
        }
        session.push(samples.slice(i, i + chunk));
      }
      const reached = stableAt;
      const { words } = session.flush();
      if (failure) {
        throw failure;
      }
      return { session, reached, words: words.length };
    });
    seconds += cpu;
    audioSeconds += 20;
    stable += session.reached !== null;
    const head = session.session.voice
      ? loadVoice(session.session.voice).head
      : null;
    for (const key of Object.keys(errors)) {
      errors[key].push(head ? relative(head[key], truth[key]) : Infinity);
    }
    cases.push({
      preset,
      stableAt: session.reached,
      state: session.session.state,
      seconds: round(cpu),
      words: session.words,
      distances: session.session.history.map(({ distance }) => round(distance)),
      vocalTractLengthError: round(errors.vocalTractLength.at(-1)),
      pitchError: round(errors.pitch.at(-1)),
    });
  }
  return {
    seconds,
    audioSeconds,
    cases,
    metrics: {
      stable: round(stable / presets.length),
      vocalTractLengthError: round(Math.max(...errors.vocalTractLength)),
      pitchError: round(Math.max(...errors.pitch)),
      cpuRatio: round(seconds / audioSeconds),
    },
  };
}

/** copyRecording on the golden set, resampled to 8 kHz. */
function copyRow({ engine, limit }) {
  let seconds = 0;
  let audioSeconds = 0;
  const f0 = [];
  const timing = [];
  const phonemes = [];
  for (const item of loadGolden().slice(0, limit)) {
    const samples = resample(item.samples, item.sampleRate, RATE);
    const [copy, cpu] = cpuTime(() =>
      copyRecording(samples, RATE, { tier: TIER, engine: engine.render })
    );
    seconds += cpu;
    audioSeconds += samples.length / RATE;
    const cents = copy.metrics.f0?.rmseCents;
    f0.push(Number.isFinite(cents) ? cents / 100 : Infinity);
    timing.push(copy.metrics.timingError ?? Infinity);
    const again = recognize(copy.samples, copy.sampleRate, {
      level: LEVEL,
      languages: [copy.score.language],
      engine: engine.recognition,
    });
    phonemes.push(errorRate(copy.recognition.ipa, again.ipa, 'phone'));
  }
  const mean = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    seconds,
    audioSeconds,
    metrics: {
      f0RmseSemitones: round(mean(f0)),
      timingErrorMs: round(mean(timing), 1),
      phonemeAgreement: round(1 - pooled(phonemes)),
      maxF0RmseSemitones: round(Math.max(...f0)),
      maxTimingErrorMs: round(Math.max(...timing), 1),
      cpuRatio: round(seconds / audioSeconds),
      recordings: f0.length,
    },
  };
}

/** Every markup mode of issue 50 rendered at 8 kHz and recognised. */
function modesRow({ engine, limit }) {
  let seconds = 0;
  let renderSeconds = 0;
  let audioSeconds = 0;
  let found = 0;
  let total = 0;
  const missed = [];
  for (const lang of LANGUAGES) {
    const heard = {
      level: LEVEL,
      languages: [lang],
      voice: HEAD,
      engine: engine.recognition,
    };
    // The models and the baseline of the voice load once per language.
    const neutral = telephone(
      BASELINE_TEXT[lang],
      { lang, head: HEAD, markup: true },
      'js'
    );
    recognize(neutral.samples, neutral.sampleRate, heard);
    for (const label of LABELS.slice(0, limit)) {
      const options = { lang, head: HEAD, markup: true };
      const { ipa } = prepareUtterance(BASELINE_TEXT[lang], {
        ...options,
        tier: TIER,
      });
      const [audio, renderCpu] = cpuTime(() =>
        telephone(
          `{${label} ${ipa} ${label}}`,
          { ...options, ipa: true },
          engine.render
        )
      );
      renderSeconds += renderCpu;
      const [result, cpu] = cpuTime(() =>
        recognize(audio.samples, audio.sampleRate, heard)
      );
      seconds += cpu;
      audioSeconds += audio.samples.length / audio.sampleRate;
      total++;
      const recognised = result.modes.some(
        ({ notation }) => notation?.replace(/^[123]/u, '') === label
      );
      found += recognised;
      if (!recognised) {
        missed.push(`${lang}:${label}`);
      }
    }
  }
  return {
    seconds,
    audioSeconds,
    metrics: {
      modeShare: round(found / total),
      rtf: round(seconds / audioSeconds),
      renderRtf: round(renderSeconds / audioSeconds),
      utterances: total,
      missed,
    },
  };
}

export const ROWS = {
  synthesis: synthesisRow,
  recognition: recognitionRow,
  streaming: streamingRow,
  'voice-fit': voiceFitRow,
  session: sessionRow,
  copy: copyRow,
  modes: modesRow,
};
