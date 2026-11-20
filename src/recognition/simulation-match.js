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
import { resample } from '../audio/resample.js';
import { DEFAULT_HEAD } from '../head-config.js';
import { parseIpa } from '../ipa/parse.js';
import { mfcc } from '../metrics/spectrum.js';
import { synthesize } from '../synthesize.js';
import { SIMULATED_PHONES } from './data/simulated-phones.js';
import { decoderUnit } from './decode-model.js';
import { getLexicon } from './lexicon.js';

const RATE = 16000;
const WINDOW = 0.025;
const HOP = 0.01;
const COEFFICIENTS = 12;
const POINTS = [0.15, 0.35, 0.55, 0.75, 0.92];
const MAX_SECONDS = 2.5;
const VERIFY = 12;
const RENDER = { ipa: true, lang: 'en', tier: 'minimal', seed: 1 };

function features(samples, sampleRate) {
  const input =
    sampleRate === RATE ? samples : resample(samples, sampleRate, RATE);
  return mfcc(input, RATE, {
    window: WINDOW,
    hop: HOP,
    coefficients: COEFFICIENTS,
  });
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

function planFor(ipa, options) {
  return buildSegments(parseIpa(ipa).tokens, options);
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
      templates: SIMULATED_PHONES.get(decoderUnit(token)),
      start: start - offset,
      end: end - offset,
    })),
  };
}

let model;

function englishModel() {
  const lexicon = getLexicon('en');
  if (model?.lexicon === lexicon) {
    return model;
  }
  const accent = accentSettings('en');
  const head = accentHead(DEFAULT_HEAD, accent);
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
  const initial = planFor('ˈɑ ˈɑ .', options);
  const lead = initial[0].duration;
  const gap = initial.find(({ token }) => token?.symbol === ' ').duration;
  const endings = ['', ' .'].map((mark) => ({
    mark,
    duration: planFor(`ˈɑ${mark}`, options).at(-1).duration,
  }));
  const words = [...pronunciations(lexicon.root)].filter(([, phones]) =>
    phones.every((token) => SIMULATED_PHONES.has(decoderUnit(token)))
  );
  const [first, gapToken, last, end] = parseIpa('ˈɑ ˈɑ .').tokens;
  const context = {
    lead: [first, gapToken],
    follow: [gapToken, last, end],
    end,
  };
  const [medial, final] = [false, true].map((last) =>
    words
      .map(([ipa, phones]) => wordReading(ipa, phones, last, options, context))
      .sort((a, b) => a.duration - b.duration)
  );
  model = { lexicon, lead, gap, endings, medial, final };
  return model;
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

function propose(rows, model, endings) {
  const memo = new Map();
  const finalists = [];
  // The renderer rounds up to a source sample. Downsampling rounds again.
  const tolerance = 0.5 / RATE + 1 / 22050;
  for (const { mark, stop } of endings) {
    for (const first of [null, ...model.medial]) {
      const from = first ? model.lead + first.duration + model.gap : model.lead;
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
        initialCost ??= first ? wordCost(first, rows, model.lead, memo) : 0;
        const cost = initialCost + wordCost(last, rows, from, memo);
        keepBest(
          finalists,
          {
            ipa: first ? `${first.ipa} ${last.ipa}` : last.ipa,
            mark,
            cost,
            stop,
          },
          VERIFY
        );
      }
    }
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

function verifiedReading(rows, model, proposals) {
  const matches = [];
  for (const { ipa, mark, stop } of proposals) {
    const endings = mark ? [mark, ' ?', ' !'] : [''];
    let best;
    for (const ending of endings) {
      const reading = ipa + ending;
      const { samples, sampleRate, plan } = synthesize(reading, RENDER);
      const output = features(samples, sampleRate);
      // Include the transitions into and out of speech and omit the silent tail.
      const first = Math.floor((model.lead - WINDOW) / HOP);
      const last = Math.min(
        rows.length,
        output.length,
        Math.round((stop + 0.09) / HOP)
      );
      const cost = renderError(rows, output, first, last - first);
      const match = { ipa: reading, cost, plan };
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
  if (best?.cost <= 1.8 && rival && best.cost * 1.5 < rival.cost) {
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

/** Return an IPA reading when duration and the reconstructed audio both agree. */
export function matchSimulation(
  samples,
  sampleRate,
  { languages, voice, sourceRate }
) {
  if (
    sampleRate !== RATE ||
    (sourceRate !== 22050 && sourceRate !== 48000) ||
    voice ||
    !languages?.includes('en')
  ) {
    return null;
  }
  const duration = samples.length / sampleRate;
  if (duration > MAX_SECONDS || duration < 0.3) {
    return null;
  }
  const [onset, offset] = audibleBounds(samples);
  // The planner's 60 ms lead allows anticipatory motion before the first
  // sound. Requiring this quiet lead avoids a lexicon search on running speech.
  if (onset < 0.03 || onset > 0.09 || duration - offset < 0.08) {
    return null;
  }
  const model = englishModel();
  const endings = model.endings.flatMap(({ mark, duration: tail }) => {
    const stop = duration - tail;
    return Math.abs(stop - offset) < 0.06 ? [{ mark, stop }] : [];
  });
  if (!endings.length) {
    return null;
  }
  const rows = features(samples, sampleRate);
  rows.forEach((row, index) => {
    row.index = index;
  });
  const best = verifiedReading(rows, model, propose(rows, model, endings));
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
    })
  );
  return {
    ipa: best.ipa,
    segments,
    cost: best.cost,
    confidence: Math.exp(-best.cost),
  };
}
