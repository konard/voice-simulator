/** Rank dictionary alternatives on the acoustic span graph at known word times. Unlicense. */
import { synthesize, tokenize } from '../src/index.js';
import { wordTransition } from '../src/recognition/data/index.js';
import { decoderUnit } from '../src/recognition/decode-model.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
} from '../src/recognition/decode-pipeline.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const slack = 0.045;
const boundaryCost = 20;

function makeWordGraph({ times, spans }, { start, end }, settings, relative) {
  const first = times.findIndex((time) => time >= start - slack);
  const last = times.findLastIndex((time) => time <= end + slack);
  if (first < 0 || last <= first) {
    return null;
  }
  const edges = spans.slice(first, last + 1).map((row) =>
    row
      .filter((span) => !span.pause && span.to <= last)
      .map((span) => {
        const costs = Float64Array.from(
          settings.language.symbols,
          (_, unit) => {
            const i = 3 * unit;
            return (
              span.terms[i] +
              settings.weights.duration * span.terms[i + 1] +
              settings.weights.class * span.terms[i + 2]
            );
          }
        );
        if (relative) {
          const minimum = Math.min(...costs);
          for (let unit = 0; unit < costs.length; unit++) {
            costs[unit] -= minimum;
          }
        }
        return { to: span.to - first, long: span.long, costs };
      })
  );
  const wordTimes = times.slice(first, last + 1);
  const initial = wordTimes.map((time) =>
    Math.abs(time - start) <= slack
      ? boundaryCost * Math.abs(time - start)
      : Infinity
  );
  const terminal = wordTimes.map((time) =>
    Math.abs(time - end) <= slack
      ? boundaryCost * Math.abs(time - end)
      : Infinity
  );
  return { edges, initial, terminal };
}

function findReadings(graph, lexicon, language, { matchLength = true } = {}) {
  if (!graph) {
    return [];
  }
  const { edges, initial, terminal } = graph;
  const units = new Map(language.symbols.map((ipa, index) => [ipa, index]));
  const tokenIds = new Map();
  const readings = new Map();

  function extend(previous, token) {
    if (!tokenIds.has(token.symbol)) {
      tokenIds.set(token.symbol, units.get(decoderUnit(token)));
    }
    const unit = tokenIds.get(token.symbol);
    if (unit === undefined) {
      return null;
    }
    const hasLength = /[ːˑ]/u.test(token.symbol);
    const distinguishesLength =
      matchLength && language.long.has(language.symbols[unit]);
    const next = new Float64Array(previous.length).fill(Infinity);
    let reached = false;
    for (let from = 0; from < previous.length; from++) {
      if (!Number.isFinite(previous[from])) {
        continue;
      }
      for (const edge of edges[from]) {
        if (!distinguishesLength || Boolean(edge.long[unit]) === hasLength) {
          reached = true;
          next[edge.to] = Math.min(
            next[edge.to],
            previous[from] + edge.costs[unit]
          );
        }
      }
    }
    return reached ? next : null;
  }

  function visit(node, scores) {
    if (node.entries.length) {
      const cost = scores.reduce(
        (best, score, i) => Math.min(best, score + terminal[i]),
        Infinity
      );
      if (Number.isFinite(cost)) {
        for (const { word } of node.entries) {
          readings.set(word, Math.min(cost, readings.get(word) ?? Infinity));
        }
      }
    }
    for (const child of node.children.values()) {
      const next = extend(scores, child.token);
      if (next) {
        visit(child, next);
      }
    }
  }
  visit(lexicon.root, initial);
  return [...readings.entries()].map(([word, acoustic]) => ({
    word,
    acoustic,
    prior: wordTransition(lexicon, word)(null),
  }));
}

for (const [lang, index] of Object.entries({ en: 17, ru: 1, hi: 1, zh: 1 })) {
  const requested = process.argv.find((flag) => flag.startsWith('--lang='));
  if (requested && requested !== `--lang=${lang}`) {
    continue;
  }
  const spoken = synthesize(sentences[lang][index], {
    lang,
    tier: 'telephone',
    head: 'random',
    preset: 'male',
    seed: 1,
  });
  const { samples, sampleRate } = spoken;
  const settings = decoderSettings(sampleRate, {
    language: lang,
    beam: 8,
    hop: 0.01,
    whisper: false,
  });
  const analysis = analyzeForDecode(samples, sampleRate, {}, settings);
  const { prepared } = prepareIpaDecode(analysis, settings);
  const lexicon = getLexicon(lang);
  const words = new Set(lexicon.words.map(({ word }) => word));
  for (const { text, start, end, ipa } of spoken.timeline.words) {
    const graph = makeWordGraph(
      prepared,
      { start, end },
      settings,
      process.argv.includes('--relative')
    );
    const expected = tokenize(text, 'word')[0];
    const readings = findReadings(graph, lexicon, settings.language);
    const inLexicon = words.has(expected);
    const lengthBlocks =
      inLexicon &&
      !readings.some(({ word }) => word === expected) &&
      findReadings(graph, lexicon, settings.language, {
        matchLength: false,
      }).some(({ word }) => word === expected);
    const results = [0, 0.25, 1].map((priorWeight) => {
      const cost = ({ acoustic, prior }) => acoustic + priorWeight * prior;
      readings.sort((a, b) => cost(a) - cost(b));
      const index = readings.findIndex(({ word }) => word === expected);
      return {
        priorWeight,
        rank: index < 0 ? null : index + 1,
        costGap: index < 0 ? null : cost(readings[index]) - cost(readings[0]),
        best: readings.slice(0, 3).map(({ word }) => word),
      };
    });
    console.log(
      JSON.stringify({
        lang,
        expected,
        ipa,
        inLexicon,
        lengthBlocks,
        candidates: readings.length,
        results,
      })
    );
  }
}
