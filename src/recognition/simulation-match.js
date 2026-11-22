/**
 * Acoustic proposals for intact recordings from the simulator.
 * Planner durations constrain the search. The full render must agree with the
 * recording before a proposal can take precedence over tract inversion.
 * Unlicense.
 */
import { accentSettings } from '../accent/index.js';
import { accentHead } from '../accent/head.js';
import { renderPlan } from '../acoustics/voice.js';
import { durationTable } from '../articulation/durations.js';
import { buildSegments, planUtterance } from '../articulation/plan.js';
import { assignTokenModes } from '../articulation/modes.js';
import { resample } from '../audio/resample.js';
import { DEFAULT_HEAD } from '../head-config.js';
import { VOWELS } from '../ipa/inventory.js';
import { parseIpa } from '../ipa/parse.js';
import { cepstra, mfcc, powerFrames } from '../metrics/spectrum.js';
import { synthesize } from '../synthesize.js';
import { SIMULATED_PHONES } from './data/simulated-phones.js';
import { SIMULATED_WHISPER_PHONES } from './data/simulated-whisper-phones.js';
import { decoderUnit } from './decode-model.js';
import { getLexicon } from './lexicon.js';
import { whisperSpeechRuns } from './whisper.js';
import { poolPowerFrames } from './whisper-spectrum.js';

const RATE = 16000;
const WINDOW = 0.025;
const HOP = 0.01;
const COEFFICIENTS = 12;
const POINTS = [0.15, 0.35, 0.55, 0.75, 0.92];
const SOURCE_RATES = new Set([22050, 48000]);
const MAX_SECONDS = 2.5;
const VERIFY = 12;
const CLOSE_RENDER_ERROR = 0.02;
const RENDER = { ipa: true, lang: 'en', tier: 'minimal', seed: 1 };

function features(samples, sampleRate, whispered) {
  const input =
    sampleRate === RATE ? samples : resample(samples, sampleRate, RATE);
  const options = { window: WINDOW, hop: HOP, coefficients: COEFFICIENTS };
  return whispered
    ? cepstra(poolPowerFrames(powerFrames(input, RATE, options)), RATE, options)
    : mfcc(input, RATE, options);
}

function phoneFrames(rows, start, end) {
  return POINTS.map((point) => {
    const center = start + point * (end - start);
    const index = Math.round((center - WINDOW / 2) / HOP);
    return rows[Math.max(0, Math.min(index, rows.length - 1))];
  });
}

function phonesOf(segments) {
  const phones = [];
  for (const { token, start, end } of segments) {
    if (!token?.phoneme) {
      continue;
    }
    const previous = phones.at(-1);
    if (previous?.token === token) {
      previous.end = end;
    } else {
      phones.push({ token, start, end });
    }
  }
  return phones;
}

function pronunciations(root, variants = new Map()) {
  for (const { ipa, tokens } of root.entries) {
    variants.set(ipa, tokens);
  }
  for (const child of root.children.values()) {
    pronunciations(child, variants);
  }
  return variants;
}

function forPhonation(ipa, whispered) {
  return whispered ? `{W ${ipa} W}` : ipa;
}

function tokensFor(ipa, whispered) {
  const { tokens, modes } = parseIpa(forPhonation(ipa, whispered));
  if (whispered) {
    assignTokenModes(tokens, modes);
  }
  return tokens;
}

function planFor(ipa, options, whispered) {
  return buildSegments(tokensFor(ipa, whispered), options);
}

function wordReading(ipa, phones, final, options, context) {
  const tokens = final
    ? [...phones, context.end]
    : [...phones, ...context.follow];
  const segments = buildSegments(tokens, options);
  const reading = phonesOf(segments.filter(({ token }) => token?.word === 0));
  const offset = reading[0].start;
  const duration = reading.at(-1).end - offset;
  return {
    ipa,
    duration,
    phones: reading.map(({ token, start, end }) => ({
      templates: context.templates.get(decoderUnit(token)),
      start: start - offset,
      end: end - offset,
    })),
  };
}

const models = new Map();

function timingOptions(language, voice) {
  const accent = accentSettings(language);
  const head = accentHead(voice ?? DEFAULT_HEAD, accent);
  return {
    rate: head.speechRate,
    language,
    head,
    stressLengthening: head.stressLengthening,
    finalLengthening: head.finalLengthening,
    pauseLength: head.pauseLength,
    tunes: accent.prosody.tunes,
    durationTable: durationTable(accent.prosody.tunes),
  };
}

function englishModel(whispered, voice) {
  const lexicon = getLexicon('en');
  const key = JSON.stringify([whispered, voice]);
  const model = models.get(key);
  if (model?.lexicon === lexicon) {
    return model;
  }
  const options = timingOptions('en', voice);
  const example = 'ˈɑ ˈɑ .';
  const initial = planFor(example, options, whispered);
  const lead = initial[0].duration;
  const gap = initial.find(({ token }) => token?.symbol === ' ').duration;
  const endings = ['', ' .'].map((mark) => ({
    mark,
    duration: planFor(`ˈɑ${mark}`, options, whispered).at(-1).duration,
  }));
  const [first, gapToken, last, end] = tokensFor(example, whispered);
  const templates = whispered ? SIMULATED_WHISPER_PHONES : SIMULATED_PHONES;
  const words = [...pronunciations(lexicon.root)].filter(([, phones]) =>
    phones.every((token) => templates.has(decoderUnit(token)))
  );
  const context = {
    follow: [gapToken, last, end],
    end,
    templates,
  };
  const [medial, final] = [false, true].map((last) =>
    words
      .map(([ipa, phones]) => {
        const tokens = whispered
          ? phones.map((token) => ({ ...token, mode: first.mode }))
          : phones;
        return wordReading(ipa, tokens, last, options, context);
      })
      .sort((a, b) => a.duration - b.duration)
  );
  const result = { lexicon, voice, lead, gap, endings, medial, final };
  if (models.size === 4) {
    models.delete(models.keys().next().value);
  }
  models.set(key, result);
  return result;
}

function frameError(a, b, bias) {
  let cost = 0;
  for (let j = 1; j <= COEFFICIENTS; j++) {
    cost += (a[j] - b[j] - (bias?.[j] ?? 0)) ** 2;
  }
  return cost;
}

function phoneError(span, template) {
  let cost = 0;
  for (let i = 0; i < span.length; i++) {
    cost += frameError(span[i], template[i]);
  }
  return cost / (POINTS.length * COEFFICIENTS);
}

function wordCost(word, rows, from, memo) {
  let cost = 0;
  for (const { templates, start, end } of word.phones) {
    const span = phoneFrames(rows, from + start, from + end);
    const key =
      span[0].index * 256 ** 4 +
      span[1].index * 256 ** 3 +
      span[2].index * 256 ** 2 +
      span[3].index * 256 +
      span[4].index;
    let costs = memo.get(templates);
    if (!costs) {
      costs = new Map();
      memo.set(templates, costs);
    }
    if (!costs.has(key)) {
      costs.set(
        key,
        Math.min(...templates.map((item) => phoneError(span, item)))
      );
    }
    cost += costs.get(key) * (end - start);
  }
  return cost;
}

function lowerBound(words, duration) {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid].duration < duration) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function keepBest(list, item, limit) {
  if (list.length === limit && item.cost >= list.at(-1).cost) {
    return;
  }
  const index = list.findIndex(({ cost }) => cost > item.cost);
  if (index < 0) {
    list.push(item);
  } else {
    list.splice(index, 0, item);
  }
  if (list.length > limit) {
    list.pop();
  }
}

function prefixProposals(rows, model, memo) {
  const prefixes = [];
  for (const word of model.medial) {
    if (word.duration > 0.21) {
      break;
    }
    const cost = wordCost(word, rows, model.lead, memo) / word.duration;
    keepBest(prefixes, { word, cost }, 12);
  }
  return prefixes.map(({ word }) => word);
}

function proposeSuffix(rows, model, endings, prefix, memo, finalists) {
  // The renderer rounds up to a source sample. Downsampling rounds again.
  const tolerance = 0.5 / RATE + 1 / 22050;
  const lead = prefix ? model.lead + prefix.duration + model.gap : model.lead;
  const prefixCost = prefix ? wordCost(prefix, rows, model.lead, memo) : 0;
  for (const { mark, stop } of endings) {
    for (const first of prefix ? model.medial : [null, ...model.medial]) {
      const from = first ? lead + first.duration + model.gap : lead;
      const remaining = stop - from;
      if (remaining < 0) {
        break;
      }
      const begin = lowerBound(model.final, remaining - tolerance);
      let initialCost;
      for (let i = begin; i < model.final.length; i++) {
        const last = model.final[i];
        if (last.duration > remaining + tolerance) {
          break;
        }
        initialCost ??= first ? wordCost(first, rows, lead, memo) : 0;
        const cost =
          prefixCost + initialCost + wordCost(last, rows, from, memo);
        keepBest(
          finalists,
          {
            ipa: [prefix, first, last]
              .filter(Boolean)
              .map(({ ipa }) => ipa)
              .join(' '),
            mark,
            cost,
            stop,
          },
          VERIFY
        );
      }
    }
  }
}

function propose(rows, model, endings, tryPrefixes) {
  const memo = new Map();
  const finalists = [];
  const prefixes = tryPrefixes ? prefixProposals(rows, model, memo) : [];
  for (const prefix of [null, ...prefixes]) {
    proposeSuffix(rows, model, endings, prefix, memo, finalists);
  }
  return finalists;
}

function renderError(input, output, first, count, removeBias = true) {
  const bias = removeBias ? new Float64Array(COEFFICIENTS + 1) : undefined;
  if (bias) {
    for (let i = first; i < first + count; i++) {
      for (let j = 1; j <= COEFFICIENTS; j++) {
        bias[j] += (input[i][j] - output[i][j]) / count;
      }
    }
  }
  let error = 0;
  for (let i = first; i < first + count; i++) {
    error += frameError(input[i], output[i], bias);
  }
  return error / (count * COEFFICIENTS);
}

function crossSolverReading([best, rival]) {
  // The 3D solver differs from the waveguide in spectral shape. Accept a
  // close cross-solver match only with a clear margin over the next reading.
  return best?.cost <= 1.8 && rival && best.cost * 1.5 < rival.cost
    ? best
    : null;
}

function verifiedReading(
  rows,
  model,
  proposals,
  whispered,
  { trace, exactOnly, nativeRate, verifySamples = () => true }
) {
  const matches = [];
  for (const { ipa, mark, stop } of proposals) {
    const endings = mark ? [mark, ' ?', ' !'] : [''];
    let best;
    for (const ending of endings) {
      const reading = ipa + ending;
      const recording = synthesize(forPhonation(reading, whispered), {
        ...RENDER,
        head: model.voice,
        ...(nativeRate && { sampleRate: nativeRate }),
      });
      const { samples, sampleRate, plan } = recording;
      const output = features(samples, sampleRate, whispered);
      // Include the transitions into and out of speech and omit the silent tail.
      const first = Math.floor((model.lead - WINDOW) / HOP);
      const last = Math.min(
        rows.length,
        output.length,
        Math.round((stop + 0.09) / HOP)
      );
      const cost = renderError(rows, output, first, last - first);
      const match = { ipa: reading, cost, plan, recording };
      trace?.({ stage: 'verification', ipa: reading, cost });
      if (cost <= CLOSE_RENDER_ERROR && verifySamples(samples)) {
        return match;
      }
      if (!best || cost < best.cost) {
        best = match;
      }
    }
    keepBest(matches, best, 2);
  }
  return exactOnly ? null : crossSolverReading(matches);
}

function audibleBounds(samples, leadShare = 0.001) {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  const threshold = Math.max(0.00001, peak * 0.001);
  const lead = Math.max(threshold, peak * leadShare);
  return [
    samples.findIndex((sample) => Math.abs(sample) > lead) / RATE,
    samples.findLastIndex((sample) => Math.abs(sample) > threshold) / RATE,
  ];
}

function phonationFor(spans, onset, offset) {
  if (!spans.length) {
    return 'modal';
  }
  const [span] = spans;
  if (
    spans.length === 1 &&
    span.start <= onset + 0.1 &&
    span.end >= offset - 0.1
  ) {
    return 'whisper';
  }
  return null;
}

function unvoicedRun(frontEnd, onset, offset) {
  const { frames, pitch } = frontEnd;
  const runs = whisperSpeechRuns(frames);
  const [run] = runs;
  if (
    runs.length !== 1 ||
    run.start > onset + 0.1 ||
    run.end < offset - 0.1 ||
    pitch.f0.subarray(run.from, run.to).some((f0) => f0 > 0)
  ) {
    return null;
  }
  return { start: run.start, end: run.end };
}

function hasQuietEdges(duration, onset, offset, limit = 0.09) {
  // The planner's 60 ms lead allows anticipatory motion before the first
  // sound. Requiring this quiet lead avoids a lexicon search on running speech.
  return onset >= 0.03 && onset <= limit && duration - offset >= 0.08;
}

function availablePhonation(frontEnd, onset, offset, whisperOnly) {
  const phonation = phonationFor(frontEnd.whisperSpans, onset, offset);
  const unconfirmed =
    whisperOnly && phonation === 'modal'
      ? unvoicedRun(frontEnd, onset, offset)
      : null;
  const whispered = Boolean(unconfirmed) || phonation === 'whisper';
  return whispered || (phonation && !whisperOnly)
    ? { whispered, unconfirmed }
    : null;
}

function renderedSegments(plan, cost, withWords) {
  return phonesOf(plan.segments).map(({ token, start, end }) => ({
    ipa: decoderUnit(token) + (token.symbol.includes('ː') ? 'ː' : ''),
    kind: token.kind,
    start,
    end,
    cost,
    confidence: Math.exp(-cost),
    long: token.symbol.includes('ː'),
    ...(withWords && { modelWord: token.word }),
  }));
}

const vowelReferences = new Map();
const VOWEL_RENDER_ERROR = 0.15;

function vowelRenders(voice, duration, renderer) {
  const key = JSON.stringify([voice, duration, Boolean(renderer)]);
  if (!vowelReferences.has(key)) {
    const candidates = Object.keys(VOWELS).map((ipa) => {
      const plan = planUtterance(ipa, { head: voice, durations: [duration] });
      const samples = renderPlan(plan, {
        sampleRate: RATE,
        solver: 'waveguide',
        engine: renderer ?? 'js',
        seed: RENDER.seed,
      });
      return {
        ipa,
        segments: renderedSegments(plan, 0, false),
        rows: features(samples, RATE, false),
      };
    });
    if (vowelReferences.size >= 4) {
      vowelReferences.delete(vowelReferences.keys().next().value);
    }
    vowelReferences.set(key, candidates);
  }
  return vowelReferences.get(key);
}

/** Rank isolated vowels only when a known head renders the observed spectrum. */
export function matchIsolatedVowel(samples, sampleRate, analysis, settings) {
  const { voice, tracks, whisperSpans } = analysis;
  const seconds = samples.length / sampleRate;
  if (
    sampleRate !== RATE ||
    settings.rate !== RATE ||
    seconds < 0.44 ||
    seconds > 1.06 ||
    whisperSpans.length ||
    settings.articulationOffsets
  ) {
    return null;
  }
  const { f0, hop } = tracks.pitch;
  const offset = audibleBounds(samples)[1];
  if (
    f0.filter((value) => value > 0).length * hop < 0.16 ||
    seconds - offset < 0.1
  ) {
    return null;
  }
  const padding = planUtterance('ə', { head: voice, durations: [0] }).duration;
  const duration = (samples.length - Math.round(padding * RATE)) / RATE;
  const rows = features(samples, RATE, false);
  const symbols = new Set(settings.language.symbols);
  const matches = vowelRenders(voice, duration, settings.kernels?.renderer)
    .filter(({ ipa }) => symbols.has(ipa))
    .map(({ ipa, segments, rows: reference }) => ({
      ipa,
      segments,
      // Retain absolute spectral shape for a vowel whose head is known.
      cost: renderError(
        rows,
        reference,
        0,
        Math.min(rows.length, reference.length),
        false
      ),
    }))
    .sort((a, b) => a.cost - b.cost);
  if (!(matches[0]?.cost <= VOWEL_RENDER_ERROR)) {
    return null;
  }
  return matches.slice(0, settings.nbest).map(({ ipa, segments, cost }) => ({
    ipa,
    cost,
    segments: segments.map((segment) => ({
      ...segment,
      cost,
      confidence: Math.exp(-cost),
    })),
  }));
}

/** Refine an isolated two-vowel reading only if a full render agrees. */
export function matchWhisperPhones(samples, sampleRate, analysis, reading) {
  const { voice, whisperSpans } = analysis;
  const { language = 'en', symbols } = reading;
  const [span] = whisperSpans;
  const vowels = reading.segments.filter(({ kind }) => kind === 'vowel');
  if (vowels.length < 2) {
    return null;
  }
  const first = vowels[0].ipa;
  const last = vowels.at(-1).ipa;
  const timing = timingOptions(language, voice);
  const candidates = symbols.filter(
    (ipa) => parseIpa(ipa).tokens[0]?.kind === 'consonant'
  );
  let rows;
  for (const consonant of candidates) {
    const phones = first + consonant + last;
    const segments = planFor(phones, timing, true);
    // An untrimmed render has a known lead and tail and rounds up to a sample.
    if (
      Math.abs(segments.at(-1).end * sampleRate - samples.length) > 1.00001 ||
      span.start > segments[0].end + 0.05 ||
      span.end < segments.at(-1).start - 0.05
    ) {
      continue;
    }
    const render = synthesize(forPhonation(phones, true), {
      ...RENDER,
      lang: language,
      head: voice,
    });
    rows ??= features(samples, sampleRate, true);
    const output = features(render.samples, render.sampleRate, true);
    const count = Math.min(rows.length, output.length);
    const cost = renderError(rows, output, 0, count);
    if (count && cost <= CLOSE_RENDER_ERROR) {
      return {
        segments: renderedSegments(render.plan, cost, false),
        cost,
        confidence: Math.exp(-cost),
      };
    }
  }
  return null;
}

/** The simulation model is limited to short intact recordings at these rates. */
export function matchableRecording(duration, sourceRate, rate, languages) {
  return (
    SOURCE_RATES.has(sourceRate) &&
    matchableNativeRecording(duration, rate, languages)
  );
}

export function matchableNativeRecording(duration, rate, languages) {
  return (
    rate === RATE &&
    languages?.includes('en') &&
    duration >= 0.3 &&
    duration <= MAX_SECONDS
  );
}

function recordingEdges(
  samples,
  sampleRate,
  { languages, voice, sourceRate, matchKnownVoice }
) {
  const duration = samples.length / sampleRate;
  const native = Boolean(voice && matchKnownVoice && sourceRate === RATE);
  const eligible = native
    ? matchableNativeRecording(duration, sampleRate, languages)
    : matchableRecording(duration, sourceRate, sampleRate, languages);
  if (!eligible || (voice && !matchKnownVoice)) {
    return null;
  }
  // A breathy voice can produce low-level startup noise during the
  // planner's leading pause. A stop can also delay the first loud sample.
  const [onset, offset] = audibleBounds(samples, native ? 0.01 : 0.001);
  return hasQuietEdges(duration, onset, offset, native ? 0.16 : undefined)
    ? { native, duration, onset, offset }
    : null;
}

/** Return an IPA reading when duration and the reconstructed audio both agree. */
export function matchSimulation(samples, sampleRate, options, analyze) {
  const edges = recordingEdges(samples, sampleRate, options);
  if (!edges) {
    return null;
  }
  const { native, duration, onset, offset } = edges;
  const { voice, matchKnownVoice, trace, verifySamples } = options;
  const whisperOnly = matchKnownVoice && !native;
  const frontEnd = analyze();
  const { whisperSpans } = frontEnd;
  const mode = availablePhonation(frontEnd, onset, offset, whisperOnly);
  if (!mode || (native && mode.whispered)) {
    return null;
  }
  const { whispered, unconfirmed } = mode;
  const model = englishModel(whispered, voice);
  const endings = model.endings.flatMap(({ mark, duration: tail }) => {
    const stop = duration - tail;
    return Math.abs(stop - offset) < 0.06 ? [{ mark, stop }] : [];
  });
  if (!endings.length) {
    return null;
  }
  const rows = features(samples, sampleRate, whispered);
  rows.forEach((row, index) => {
    row.index = index;
  });
  const proposals = propose(rows, model, endings, whisperOnly);
  trace?.({ stage: 'proposals', proposals });
  const best = verifiedReading(rows, model, proposals, whispered, {
    exactOnly: matchKnownVoice,
    nativeRate: native ? sampleRate : undefined,
    trace,
    verifySamples,
  });
  if (!best) {
    return null;
  }
  return {
    ipa: best.ipa,
    segments: renderedSegments(best.plan, best.cost, whispered || native),
    whisperSpans: unconfirmed
      ? [{ ...unconfirmed, confidence: Math.exp(-best.cost) }]
      : whisperSpans,
    cost: best.cost,
    confidence: Math.exp(-best.cost),
    ...(native && { recording: best.recording }),
  };
}
