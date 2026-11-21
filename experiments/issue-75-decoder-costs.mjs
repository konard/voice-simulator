/** Compare acoustic search costs on short 8 kHz synthetic sentences. Unlicense. */
import { errorRate, synthesize, tokenize } from '../src/index.js';
import { createRecognitionTemplatePlanner } from '../src/articulation/plan.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import {
  decoderLanguage,
  decoderUnit,
  TEMPLATE_CHANNELS,
  TEMPLATE_POINTS,
} from '../src/recognition/decode-model.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  segmentsOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import {
  createSpanScorer,
  prepareDecode,
} from '../src/recognition/decode-spans.js';
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

function plannedTrack(inferred, plan) {
  const channels = Object.fromEntries(
    Object.entries(inferred.channels).map(([name, values]) => [
      name,
      new Float32Array(values.length),
    ])
  );
  for (let frame = 0; frame < inferred.frameCount; frame++) {
    const time = inferred.startTime + frame / inferred.frameRate;
    const state = sampleState(plan, time);
    for (const [name, values] of Object.entries(channels)) {
      values[frame] = state[name];
    }
  }
  return { ...inferred, channels };
}

// Score the original graph against the planner's articulatory controls.
function plannedArticulation(prepared, templates, analysis, plan) {
  const { frames, tracks } = analysis;
  const score = createSpanScorer(
    frames,
    tracks.landmarks,
    plannedTrack(tracks.articulation, plan)
  );
  const { times, spans } = prepared;
  return {
    times,
    spans: spans.map((edges, from) =>
      edges.map((span) => {
        if (span.pause) {
          return span;
        }
        const { terms } = score(times[from], times[span.to], templates);
        return {
          ...span,
          terms: span.terms.map((term, index) =>
            index % 3 === 0 ? terms[index] : term
          ),
        };
      })
    ),
  };
}

// A supplied language gives access to the same timing rules used by the
// synthesizer. Articulation inferred from the audio stays unchanged.
function languageTemplates(templates, voice, language) {
  const planPhone = createRecognitionTemplatePlanner(
    { head: voice, language },
    TEMPLATE_CHANNELS
  );
  return templates.map((unit) => {
    const vowel = unit.kind === 'vowel';
    const plan = planPhone(vowel ? unit.ipa : `ə${unit.ipa}ə`);
    const target = plan.tokens[vowel ? 0 : 1];
    const segments = plan.segments.filter(({ token }) => token === target);
    const start = segments[0].start;
    const duration = segments.at(-1).end - start;
    const states = TEMPLATE_POINTS.map((point) =>
      sampleState(plan, start + point * duration)
    );
    const width = TEMPLATE_CHANNELS.length;
    const values = Float64Array.from(
      unit.compared,
      (cell) =>
        states[Math.floor(cell / width)][TEMPLATE_CHANNELS[cell % width]]
    );
    return { ...unit, values, duration };
  });
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

// Remove segmentation and phone transitions from the comparison and use
// the correct language inventory. Both runs retain the inferred classes.
function measureKnownSpans(analysis, templates, plan, lang) {
  const { frames, tracks } = analysis;
  const inventory = new Set(decoderLanguage({ language: lang }).symbols);
  const phones = templates.filter(({ ipa }) => inventory.has(ipa));
  const spans = [];
  for (const { token, start, end } of plan.segments) {
    if (!token?.phoneme) {
      continue;
    }
    if (spans.at(-1)?.token === token) {
      spans.at(-1).end = end;
    } else {
      spans.push({ token, start, end });
    }
  }
  const articulations = {
    inferred: tracks.articulation,
    planned: plannedTrack(tracks.articulation, plan),
  };
  for (const [source, track] of Object.entries(articulations)) {
    const score = createSpanScorer(frames, tracks.landmarks, track);
    console.log(
      JSON.stringify({ lang, source, ...rankKnownPhones(spans, phones, score) })
    );
  }
}

function rankKnownPhones(spans, phones, score) {
  const results = {
    count: spans.length,
    absent: 0,
    first: 0,
    topFive: 0,
  };
  for (const { token, start, end } of spans) {
    const unit = decoderUnit(token);
    const expected = phones.findIndex(({ ipa }) => ipa === unit);
    if (expected < 0) {
      results.absent++;
      continue;
    }
    const { terms } = score(start, end, phones);
    const { duration, class: broadClass } = settings.weights;
    const costs = phones.map(
      (_, i) =>
        terms[i * 3] +
        duration * terms[i * 3 + 1] +
        broadClass * terms[i * 3 + 2]
    );
    const rank = costs.filter(
      (cost, i) =>
        cost < costs[expected] || (cost === costs[expected] && i < expected)
    ).length;
    results.first += Number(rank === 0);
    results.topFive += Number(rank < 5);
  }
  return results;
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
  if (process.argv.includes('--reference-spans')) {
    measureKnownSpans(analysis, templates, spoken.plan, lang);
    continue;
  }
  if (process.argv.includes('--language-templates')) {
    const matched = languageTemplates(templates, analysis.voice, lang);
    const { frames, tracks } = analysis;
    const prepared = prepareDecode(
      frames,
      tracks.landmarks,
      tracks.articulation,
      matched,
      {
        from: frames.startTime,
        to: frames.startTime + frames.sampleCount / frames.rate,
      }
    );
    measureSearch(
      prepared,
      matched,
      settings,
      spoken.ipa,
      lang,
      'templates with reference language timing'
    );
  }
  if (process.argv.includes('--planned-articulation')) {
    measureSearch(
      plannedArticulation(prepared, templates, analysis, spoken.plan),
      templates,
      settings,
      spoken.ipa,
      lang,
      'planner articulation on the inferred boundaries'
    );
  }
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
