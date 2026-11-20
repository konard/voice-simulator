/** Bound the golden-set error attainable with the existing decoder graph. Unlicense. */
import { parseIpa } from '../src/index.js';
import { phoneClass } from '../src/recognition/decode-model.js';
import { decodeSearch, pathArcs } from '../src/recognition/decode-search.js';
import { goldenCases } from './issue-153-golden.mjs';

const rankLimits = [1, 3, 5, Infinity];

function rankSpan(span, templates, { weights, language }) {
  const ranked = templates.map(({ ipa, token }, index) => {
    const offset = 3 * index;
    return {
      phone: ipa + (span.long[index] && language.long.has(ipa) ? 'ː' : ''),
      broad: phoneClass(token),
      cost:
        span.terms[offset] +
        weights.duration * span.terms[offset + 1] +
        weights.class * span.terms[offset + 2],
    };
  });
  return ranked.sort((a, b) => a.cost - b.cost);
}

function graph(prepared, templates, settings) {
  return prepared.spans.map((row) =>
    row.map((span) => ({
      to: span.to,
      options: span.pause ? null : rankSpan(span, templates, settings),
    }))
  );
}

// Levenshtein alignment over all paths in the directed acyclic boundary
// graph. A row records the cost of each reference prefix at one boundary.
function minimumError(spans, reference, key, limit) {
  if (!spans.length) {
    return 1;
  }
  const width = reference.length + 1;
  const cost = spans.map(() => new Float64Array(width).fill(Infinity));
  cost[0][0] = 0;
  for (const [from, edges] of spans.entries()) {
    const row = cost[from];
    for (let prefix = 1; prefix < width; prefix++) {
      row[prefix] = Math.min(row[prefix], row[prefix - 1] + 1);
    }
    for (const { to, options } of edges) {
      const next = cost[to];
      if (!options) {
        for (let prefix = 0; prefix < width; prefix++) {
          next[prefix] = Math.min(next[prefix], row[prefix]);
        }
        continue;
      }
      const labels = new Set(options.slice(0, limit).map((item) => item[key]));
      next[0] = Math.min(next[0], row[0] + 1);
      for (let prefix = 1; prefix < width; prefix++) {
        const substitution = labels.has(reference[prefix - 1]) ? 0 : 1;
        next[prefix] = Math.min(
          next[prefix],
          row[prefix] + 1,
          row[prefix - 1] + substitution
        );
      }
    }
  }
  return cost.at(-1).at(-1) / Math.max(1, reference.length);
}

function results(prepared, templates, settings, ipa) {
  const reference = parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
  const listening = graph(prepared, templates, settings);
  const search = decodeSearch(prepared, settings.language, {
    ...settings,
    lattice: false,
  });
  const chosenSpans = listening.map(() => []);
  for (const { from, to } of pathArcs(search.paths[0])) {
    chosenSpans[from].push(listening[from].find((edge) => edge.to === to));
  }
  const phone = reference.map(({ symbol }) => symbol);
  const broad = reference.map(phoneClass);
  return [
    ['Decoded boundaries, all labels', chosenSpans, Infinity],
    ...rankLimits.map((limit) => [
      `All boundaries, ${Number.isFinite(limit) ? `top ${limit}` : 'all labels'}`,
      listening,
      limit,
    ]),
  ].map(([name, spans, limit]) => ({
    name,
    phone: minimumError(spans, phone, 'phone', limit),
    broad: minimumError(spans, broad, 'broad', limit),
  }));
}

const scores = [];
for (const { prepared, templates, settings, ipa } of goldenCases()) {
  scores.push(...results(prepared, templates, settings, ipa));
}

console.log('Oracle using reference labels | Phone error | Broad-class error');
for (const name of new Set(scores.map((row) => row.name))) {
  const rows = scores.filter((row) => row.name === name);
  const mean = (key) =>
    (100 * rows.reduce((sum, row) => sum + row[key], 0)) / rows.length;
  console.log(name, mean('phone').toFixed(2), mean('broad').toFixed(2));
}
