/** Compare acoustic search costs on short 8 kHz synthetic sentences. Unlicense. */
import { errorRate, synthesize, tokenize } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  segmentsOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const indexes = { en: 17, ru: 1, hi: 1, zh: 1 };
const settings = decoderSettings(8000, {
  languages: Object.keys(sentences),
  beam: 8,
  hop: 0.01,
  whisper: false,
});
const conditions = [
  { name: 'default' },
  { name: 'lower phone transition cost', phonotactic: 0.25 },
  { name: 'higher duration cost', duration: 4 },
  { name: 'duration weighted acoustic costs', durationWeighted: true },
  {
    name: 'duration weighted acoustic costs and lower transition cost',
    durationWeighted: true,
    phonotactic: 0.25,
  },
];

function weightByDuration({ spans, times }) {
  return spans.map((row, from) =>
    row.map((span) => {
      if (span.pause) {
        return span;
      }
      const scale = (times[span.to] - times[from]) / 0.08;
      const terms = span.terms.map((value, index) =>
        index % 3 === 1 ? value : scale * value
      );
      return { ...span, terms };
    })
  );
}

// Optimistic edit count if a reference-aware search could choose any path
// through the existing graph and any of the allowed labels at each span.
function graphErrors({ spans }, reference, symbols, count, lengthVariants) {
  const rows = spans.map(() =>
    new Float64Array(reference.length + 1).fill(Infinity)
  );
  rows[0][0] = 0;
  const { weights, language } = settings;
  for (const [from, edges] of spans.entries()) {
    const row = rows[from];
    for (let i = 1; i <= reference.length; i++) {
      row[i] = Math.min(row[i], row[i - 1] + 1);
    }
    for (const { to, terms, long, pause } of edges) {
      const next = rows[to];
      if (pause) {
        for (let i = 0; i <= reference.length; i++) {
          next[i] = Math.min(next[i], row[i]);
        }
        continue;
      }
      const ranked = symbols.map((symbol, unit) => ({
        label: symbol + (long[unit] && language.long.has(symbol) ? 'ː' : ''),
        alternate:
          lengthVariants && language.long.has(symbol)
            ? symbol + (long[unit] ? '' : 'ː')
            : null,
        cost:
          terms[3 * unit] +
          weights.duration * terms[3 * unit + 1] +
          weights.class * terms[3 * unit + 2],
      }));
      ranked.sort((a, b) => a.cost - b.cost);
      const labels = new Set(
        ranked
          .slice(0, count)
          .flatMap(({ label, alternate }) => [label, alternate])
      );
      next[0] = Math.min(next[0], row[0] + 1);
      for (let i = 1; i <= reference.length; i++) {
        next[i] = Math.min(
          next[i],
          row[i] + 1,
          row[i - 1] + Number(!labels.has(reference[i - 1]))
        );
      }
    }
  }
  return rows.at(-1).at(-1);
}

// Let the search distinguish short from long models by the planner's
// acoustic and duration templates. Transition costs use base phone labels.
function withLengthModels(settings) {
  const { language } = settings;
  const baseUnits = language.symbols;
  const lengths = baseUnits.filter((unit) => language.long.has(unit));
  const symbols = [...baseUnits, ...lengths.map((unit) => `${unit}ː`)];
  const indexes = [
    ...baseUnits.keys(),
    ...lengths.map((unit) => baseUnits.indexOf(unit)),
  ];
  const from = [...indexes, baseUnits.length];
  const costs = Float64Array.from(
    from.flatMap((previous) =>
      indexes.map((next) => language.costs[previous * baseUnits.length + next])
    )
  );
  return {
    ...settings,
    language: { ...language, symbols, costs, long: new Set() },
  };
}

function measureSearch(
  prepared,
  templates,
  settings,
  reference,
  lang,
  condition
) {
  const { paths } = decodeSearch(prepared, settings.language, {
    ...settings,
    lattice: false,
  });
  const ipa = segmentsOf(paths[0], prepared.times, templates, settings.language)
    .map((segment) => segment.ipa)
    .join(' ');
  console.log(
    JSON.stringify({
      lang,
      condition,
      reference,
      ipa,
      phones: tokenize(ipa, 'phone').length,
      ...errorRate(reference, ipa, 'phone'),
    })
  );
}

for (const [lang, index] of Object.entries(indexes)) {
  const spoken = synthesize(sentences[lang][index], {
    lang,
    tier: 'telephone',
    ...(process.argv.includes('--seeded-preset') && { head: 'random' }),
    preset: 'male',
    seed: 1,
  });
  const analysis = analyzeForDecode(
    spoken.samples,
    spoken.sampleRate,
    {},
    settings
  );
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const reference = tokenize(spoken.ipa, 'phone');
  for (const count of [3, templates.length]) {
    console.log(
      JSON.stringify({
        lang,
        condition: `oracle with up to ${count} labels per span`,
        distance: graphErrors(
          prepared,
          reference,
          settings.language.symbols,
          count
        ),
        referenceLength: reference.length,
      })
    );
  }
  console.log(
    JSON.stringify({
      lang,
      condition: 'oracle with all labels and free phone length',
      distance: graphErrors(
        prepared,
        reference,
        settings.language.symbols,
        templates.length,
        true
      ),
      referenceLength: reference.length,
    })
  );
  if (process.argv.includes('--length-models')) {
    const model = withLengthModels(settings);
    const modeled = prepareIpaDecode(analysis, model);
    for (const weights of [
      settings.weights,
      { ...settings.weights, duration: 4 },
    ]) {
      measureSearch(
        modeled.prepared,
        modeled.templates,
        { ...model, weights },
        spoken.ipa,
        lang,
        `explicit short and long phone models, duration weight ${weights.duration}`
      );
    }
  }
  const weighted = weightByDuration(prepared);
  for (const { name, durationWeighted, ...weights } of conditions) {
    const input = durationWeighted
      ? { ...prepared, spans: weighted }
      : prepared;
    measureSearch(
      input,
      templates,
      { ...settings, weights: { ...settings.weights, ...weights } },
      spoken.ipa,
      lang,
      name
    );
  }
}
