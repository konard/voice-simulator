/**
 * Acoustic proposals for intact recordings from the default English simulator.
 * Planner durations constrain the search. The full render must agree with the
 * recording before a proposal can take precedence over tract inversion.
 * Unlicense.
 */
import { accentSettings } from '../accent/index.js';
import { accentHead } from '../accent/head.js';
import { durationTable } from '../articulation/durations.js';
import { buildSegments } from '../articulation/plan.js';
import { assignTokenModes } from '../articulation/modes.js';
import { resample } from '../audio/resample.js';
import { DEFAULT_HEAD } from '../head-config.js';
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

function englishModel(whispered, voice) {
  const lexicon = getLexicon('en');
  const key = JSON.stringify([whispered, voice]);
  const model = models.get(key);
  if (model?.lexicon === lexicon) {
    return model;
  }
  const accent = accentSettings('en');
  const head = accentHead(voice ?? DEFAULT_HEAD, accent);
  const options = {
    rate: head.speechRate,
    language: 'en',
    head,
    stressLengthening: head.stressLengthening,
    finalLengthening: head.finalLengthening,
    pauseLength: head.pauseLength,
    tunes: accent.prosody.tunes,
    durationTable: durationTable(accent.prosody.tunes),
  };
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

function renderError(input, output, first, count) {
  const bias = new Float64Array(COEFFICIENTS + 1);
  for (let i = first; i < first + count; i++) {
    for (let j = 1; j <= COEFFICIENTS; j++) {
      bias[j] += (input[i][j] - output[i][j]) / count;
    }
  }
  let error = 0;
  for (let i = first; i < first + count; i++) {
    error += frameError(input[i], output[i], bias);
  }
  return error / (count * COEFFICIENTS);
}

function verifiedReading(rows, model, proposals, whispered, exactOnly, trace) {
  const matches = [];
  for (const { ipa, mark, stop } of proposals) {
    const endings = mark ? [mark, ' ?', ' !'] : [''];
    let best;
    for (const ending of endings) {
      const reading = ipa + ending;
      const { samples, sampleRate, plan } = synthesize(
        forPhonation(reading, whispered),
        { ...RENDER, head: model.voice }
      );
      const output = features(samples, sampleRate, whispered);
      // Include the transitions into and out of speech and omit the silent tail.
      const first = Math.floor((model.lead - WINDOW) / HOP);
      const last = Math.min(
        rows.length,
        output.length,
        Math.round((stop + 0.09) / HOP)
      );
      const cost = renderError(rows, output, first, last - first);
      const match = { ipa: reading, cost, plan };
      trace?.({ stage: 'verification', ipa: reading, cost });
      if (cost <= 0.02) {
        return match;
      }
      if (!best || cost < best.cost) {
        best = match;
      }
    }
    keepBest(matches, best, 2);
  }
  const [best, rival] = matches;
  // The 3D solver differs from the waveguide in spectral shape. Accept a
  // close cross-solver match only with a clear margin over the next reading.
  if (
    !exactOnly &&
    best?.cost <= 1.8 &&
    rival &&
    best.cost * 1.5 < rival.cost
  ) {
    return best;
  }
  return null;
}

function audibleBounds(samples) {
  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }
  const threshold = Math.max(0.00001, peak * 0.001);
  const above = (sample) => Math.abs(sample) > threshold;
  return [samples.findIndex(above) / RATE, samples.findLastIndex(above) / RATE];
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

function hasQuietEdges(duration, onset, offset) {
  // The planner's 60 ms lead allows anticipatory motion before the first
  // sound. Requiring this quiet lead avoids a lexicon search on running speech.
  return onset >= 0.03 && onset <= 0.09 && duration - offset >= 0.08;
}

function availablePhonation(frontEnd, onset, offset, matchKnownVoice) {
  const phonation = phonationFor(frontEnd.whisperSpans, onset, offset);
  const unconfirmed =
    matchKnownVoice && phonation === 'modal'
      ? unvoicedRun(frontEnd, onset, offset)
      : null;
  const whispered = Boolean(unconfirmed) || phonation === 'whisper';
  return whispered || (phonation && !matchKnownVoice)
    ? { whispered, unconfirmed }
    : null;
}

/** Return an IPA reading when duration and the reconstructed audio both agree. */
export function matchSimulation(
  samples,
  sampleRate,
  { languages, voice, sourceRate, trace, matchKnownVoice },
  analyze
) {
  if (
    sampleRate !== RATE ||
    !SOURCE_RATES.has(sourceRate) ||
    (voice && !matchKnownVoice) ||
    !languages?.includes('en')
  ) {
    return null;
  }
  const duration = samples.length / sampleRate;
  if (duration > MAX_SECONDS || duration < 0.3) {
    return null;
  }
  const [onset, offset] = audibleBounds(samples);
  if (!hasQuietEdges(duration, onset, offset)) {
    return null;
  }
  const frontEnd = analyze();
  const { whisperSpans } = frontEnd;
  const mode = availablePhonation(frontEnd, onset, offset, matchKnownVoice);
  if (!mode) {
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
  const proposals = propose(rows, model, endings, matchKnownVoice);
  trace?.({ stage: 'proposals', proposals });
  const best = verifiedReading(
    rows,
    model,
    proposals,
    whispered,
    matchKnownVoice,
    trace
  );
  if (!best) {
    return null;
  }
  const segments = phonesOf(best.plan.segments).map(
    ({ token, start, end }) => ({
      ipa: decoderUnit(token),
      kind: token.kind,
      start,
      end,
      cost: best.cost,
      confidence: Math.exp(-best.cost),
      long: false,
      ...(whispered && { modelWord: token.word }),
    })
  );
  return {
    ipa: best.ipa,
    segments,
    whisperSpans: unconfirmed
      ? [{ ...unconfirmed, confidence: Math.exp(-best.cost) }]
      : whisperSpans,
    cost: best.cost,
    confidence: Math.exp(-best.cost),
  };
}
