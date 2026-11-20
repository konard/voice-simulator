/** Test text-derived two-phone contexts on the unchanged acoustic span graph. Unlicense. */
import { errorRate, parseIpa } from '../src/index.js';
import { decoderUnit, phoneClass } from '../src/recognition/decode-model.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { goldenCases } from './issue-153-golden.mjs';

const models = new Map();

function phoneContext(lang, symbols) {
  if (models.has(lang)) {
    return models.get(lang);
  }
  const boundary = symbols.length;
  const width = boundary + 1;
  const ids = new Map(symbols.map((symbol, id) => [symbol, id]));
  const bigrams = new Float64Array(width ** 2).fill(0.5);
  const trigrams = new Float64Array(width ** 3);
  const nodes = [getLexicon(lang).root];
  for (const node of nodes) {
    nodes.push(...node.children.values());
    for (const { count, tokens } of node.entries) {
      const units = [
        boundary,
        boundary,
        ...tokens.map((token) => ids.get(decoderUnit(token)) ?? boundary),
        boundary,
      ];
      for (let i = 2; i < units.length; i++) {
        const [a, b, c] = units.slice(i - 2, i + 1);
        bigrams[b * width + c] += count;
        trigrams[(a * width + b) * width + c] += count;
      }
    }
  }
  const costs = new Float32Array(trigrams.length);
  for (let ab = 0; ab < width ** 2; ab++) {
    const b = ab % width;
    const counts = trigrams.subarray(ab * width, (ab + 1) * width);
    const backoff = bigrams.subarray(b * width, (b + 1) * width);
    const start = bigrams.subarray(boundary * width);
    const sum = (values) => values.reduce((total, count) => total + count, 0);
    const total = sum(counts);
    const backoffTotal = sum(backoff);
    const startTotal = sum(start);
    const mix = total / (total + 500);
    const cross =
      mix * (counts[boundary] / Math.max(total, 1)) +
      (1 - mix) * (backoff[boundary] / backoffTotal);
    for (let c = 0; c < boundary; c++) {
      const inner =
        (mix * counts[c]) / Math.max(total, 1) +
        ((1 - mix) * backoff[c]) / backoffTotal;
      costs[ab * width + c] = -Math.log(
        Math.max(inner, (cross * start[c]) / startTotal)
      );
    }
  }

  const model = { width, costs, boundary };
  models.set(lang, model);
  return model;
}

function rankedSpans(spans, settings) {
  return spans.map((row) =>
    row.map(({ to, pause, terms, long }) => {
      if (pause) {
        return { to, pause };
      }
      const scores = Array.from({ length: terms.length / 3 }, (_, unit) => ({
        unit,
        cost:
          terms[unit * 3] +
          settings.weights.duration * terms[unit * 3 + 1] +
          settings.weights.class * terms[unit * 3 + 2],
        long: Boolean(long[unit]),
      }));
      scores.sort((a, b) => a.cost - b.cost);
      return { to, scores };
    })
  );
}

function retain(states, context, previous, arc, cost) {
  if (!(states.get(context)?.cost <= cost)) {
    states.set(context, { context, previous, arc, cost });
  }
}

function bestReading(spans, model, { weight, keep }) {
  if (!spans.length) {
    return [];
  }
  const { width, costs, boundary } = model;
  const reset = boundary * width + boundary;
  const pending = spans.map(() => new Map());
  pending[0].set(reset, { cost: 0, context: reset });
  const byCost = (a, b) => a.cost - b.cost;
  for (const [from, edges] of spans.entries()) {
    const parents = [...pending[from].values()].sort(byCost).slice(0, 32);
    for (const { to, pause, scores } of edges) {
      const next = pending[to];
      if (pause && parents.length > 0) {
        retain(next, reset, parents[0], null, parents[0].cost);
      }
      if (!scores) {
        continue;
      }
      for (const state of parents) {
        for (const arc of scores.slice(0, keep)) {
          const context = (state.context % width) * width + arc.unit;
          const prior = costs[state.context * width + arc.unit];
          retain(
            next,
            context,
            state,
            arc,
            state.cost + arc.cost + weight * prior
          );
        }
      }
    }
  }
  const result = [];
  let best = [...pending.at(-1).values()].sort(byCost)[0];
  while (best?.previous) {
    if (best.arc) {
      result.push(best.arc);
    }
    best = best.previous;
  }
  return result.reverse();
}

const conditions = [
  { weight: 0.75, keep: 10 },
  { weight: 1.5, keep: 10 },
  { weight: 3, keep: 10 },
  { weight: 1.5, keep: Infinity },
];
const totals = conditions.map(() => ({ phone: 0, broad: 0, count: 0 }));
for (const { lang, ipa, prepared, templates, settings } of goldenCases(
  process.argv[2]
)) {
  const model = phoneContext(lang, settings.language.symbols);
  const spans = rankedSpans(prepared.spans, settings);
  const reference = parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
  const phone = reference.map(({ symbol }) => symbol);
  const broad = reference.map(phoneClass);
  for (const [index, condition] of conditions.entries()) {
    const reading = bestReading(spans, model, condition);
    const hypothesis = reading.map(({ unit, long }) => {
      const { ipa } = templates[unit];
      return ipa + (long && settings.language.long.has(ipa) ? 'ː' : '');
    });
    totals[index].phone += errorRate(phone, hypothesis.join(''), 'phone').rate;
    totals[index].broad += errorRate(
      broad,
      reading.map(({ unit }) => phoneClass(templates[unit].token)),
      'phone'
    ).rate;
    totals[index].count++;
  }
}

console.log('Two-phone context | Phone error | Broad-class error');
for (const [index, { phone, broad, count }] of totals.entries()) {
  console.log(
    conditions[index],
    ((100 * phone) / count).toFixed(2),
    ((100 * broad) / count).toFixed(2)
  );
}
