/** Synthetic quality gates and focused numerical decoder checks. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  audioToIpa,
  createIpaDecoder,
  errorRate,
  planUtterance,
  renderPlan,
  syllabifyTokens,
} from '../src/index.js';
import { createRandom } from '../src/random.js';
import { VOWELS } from '../src/ipa/inventory.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { checkBlockedGate } from './helpers/blocked-gate.js';
import {
  DECODE_SENTENCES,
  DECODER_VOICES,
  mean,
  plannedPhones,
  renderDecoderText,
} from './helpers/decoder-material.js';

const hiRate = 16000;
const lowRate = 8000;

function gate(criterion, observed, target, min = false) {
  console.log('decoder', criterion, observed);
  checkBlockedGate({
    criterion: `issue 66: ${criterion}`,
    passed: min ? observed >= target : observed <= target,
    measured: `${observed.toFixed(6)}, required ${min ? 'at least' : 'at most'} ${target}`,
    action:
      'resolve the decoder quality limits documented in docs/CODEBOOK.md and rerun the original gates',
  });
}

const decodeCases = new Map();
const analyses = new Map();

function loadCases(sampleRate, knownLanguage, language) {
  const key = `${sampleRate}/${knownLanguage}/${language}`;
  const cached = decodeCases.get(key);
  if (cached) {
    return cached;
  }
  const rows = [];
  for (const [preset, voice] of Object.entries(DECODER_VOICES)) {
    for (const [index, text] of DECODE_SENTENCES[language].entries()) {
      const analysisKey = `${language}/${preset}/${index}`;
      const options = {
        voice,
        nbest: 10,
        language: knownLanguage ? language : undefined,
      };
      const settings = decoderSettings(sampleRate, options);
      let input = sampleRate === hiRate ? analyses.get(analysisKey) : undefined;
      if (!input) {
        const { plan, samples } = renderDecoderText(
          text,
          voice,
          sampleRate,
          language
        );
        input = {
          plan,
          analysis: analyzeForDecode(samples, sampleRate, options, settings),
        };
        if (sampleRate === hiRate && knownLanguage) {
          analyses.set(analysisKey, input);
        }
      }
      if (!knownLanguage) {
        analyses.delete(analysisKey);
      }
      const { plan, analysis } = input;
      const { prepared, templates } = prepareIpaDecode(analysis, settings);
      const search = decodeSearch(prepared, settings.language, {
        ...settings,
        lattice: false,
      });
      const { segments, syllables, nbest } = resultOf(
        analysis,
        settings,
        prepared,
        templates,
        search
      );
      const phones = plannedPhones(plan);
      const reference = phones.map(({ ipa }) => ipa);
      const readings = nbest.map(
        ({ ipa }) => errorRate(reference, ipa, 'phone').rate
      );
      const per = readings[0] ?? errorRate(reference, '', 'phone').rate;
      const oracle = Math.min(per, ...readings);
      rows.push({
        language,
        phones,
        plan,
        decoded: { segments, syllables },
        per,
        oracle,
      });
    }
  }
  decodeCases.set(key, rows);
  return rows;
}

function cases(sampleRate, knownLanguage) {
  return Object.keys(DECODE_SENTENCES).flatMap((language) =>
    loadCases(sampleRate, knownLanguage, language)
  );
}

it('keeps paths with different phone strings and their lowest cost', () => {
  const language = { symbols: ['a', 'b'], costs: new Float64Array(6) };
  const span = (to, a, b) => ({ to, terms: Float64Array.of(a, 0, 0, b, 0, 0) });
  const prepared = {
    times: Float64Array.of(0, 0.05, 0.1, 0.16),
    spans: [
      [span(1, 0, 4), span(2, 1, 5)],
      [span(3, 3, 1)],
      [span(3, 0.5, 2)],
      [],
    ],
  };
  const weights = { duration: 0.5, class: 4, phonotactic: 0 };
  const result = decodeSearch(prepared, language, {
    beam: 2,
    nbest: 4,
    weights,
  });
  assert.deepEqual(
    result.paths.map(({ cost }) => cost),
    [1, 1.5, 5, 5.5]
  );
  const pruned = decodeSearch(prepared, language, {
    beam: 1,
    nbest: 4,
    weights,
  });
  assert.deepEqual(
    pruned.paths.map(({ cost }) => cost),
    [1]
  );
  assert.equal(pruned.edges.filter(({ to }) => to === 3).length, 2);
});

it('returns nothing for silence and noise', () => {
  const random = createRandom(1);
  const noise = Float32Array.from(
    { length: lowRate },
    () => 0.05 * (2 * random() - 1)
  );
  for (const samples of [new Float32Array(lowRate), noise]) {
    const result = audioToIpa(samples, lowRate);
    assert.equal(result.ipa, '');
    assert.deepEqual(result.segments, []);
    assert.deepEqual(result.syllables, []);
    assert.deepEqual(result.nbest, []);
    assert.deepEqual(result.lattice.edges, []);
  }
});

for (const [preset, voice] of Object.entries(DECODER_VOICES)) {
  it(`decodes single vowels (${preset})`, () => {
    let first = 0;
    let topFive = 0;
    const vowels = Object.keys(VOWELS);
    assert.equal(vowels.length, 31);
    for (const vowel of vowels) {
      const plan = planUtterance(vowel, { head: voice, durations: [0.3] });
      const samples = renderPlan(plan, {
        sampleRate: hiRate,
        solver: 'waveguide',
        engine: 'js',
        seed: 1,
      });
      const result = audioToIpa(samples, hiRate, { voice, nbest: 5 });
      const ref = plannedPhones(plan).map(({ ipa }) => ipa);
      const isRight = (ipa) => errorRate(ref, ipa, 'phone').rate === 0;
      first += Number(isRight(result.ipa));
      topFive += Number(result.nbest.some(({ ipa }) => isRight(ipa)));
    }
    gate(`${preset} vowel top five`, topFive / vowels.length, 0.9, true);
    gate(`${preset} vowel first`, first / vowels.length, 0.6, true);
  });
}

// Measure shards separately so a single test does not consume the runtime's timeout.
for (const language of Object.keys(DECODE_SENTENCES)) {
  for (const sampleRate of [hiRate, lowRate]) {
    it(`evaluates ${language} sentences at ${sampleRate} Hz`, () => {
      const known = loadCases(sampleRate, true, language);
      assert.equal(known.length, 8);
      if (sampleRate === hiRate) {
        assert.equal(loadCases(hiRate, false, language).length, 8);
      }
    });
  }
}

it('decodes with the language given', () => {
  const high = mean(cases(hiRate, true).map(({ per }) => per));
  const low = mean(cases(lowRate, true).map(({ per }) => per));
  console.log('decoder known-language PER 16000/8000', high, low);
  gate('known-language PER at 16 kHz', high, 0.25);
  gate('known-language PER at 8 kHz', low, 0.35);
});

it('decodes without a language', () => {
  gate(
    'universal PER at 16 kHz',
    mean(cases(hiRate, false).map(({ per }) => per)),
    0.4
  );
});

it('finds the boundaries', () => {
  let total = 0;
  let matched = 0;
  for (const { phones, decoded } of cases(hiRate, true)) {
    const expected = new Set(phones.flatMap(({ start, end }) => [start, end]));
    const actual = decoded.segments.flatMap(({ start, end }) => [start, end]);
    total += expected.size;
    matched += [...expected].filter((time) =>
      actual.some((edge) => Math.abs(time - edge) <= 0.02)
    ).length;
  }
  gate('phone boundaries within 20 ms', matched / total, 0.8, true);
});

it('n-best holds better readings', () => {
  const rows = cases(hiRate, true);
  const first = mean(rows.map(({ per }) => per));
  const oracle = mean(rows.map((row) => row.oracle));
  console.log('oracle', oracle, 'first', first);
  gate('oracle improvement', first - oracle, 0.05, true);
});

it('syllables carry times', () => {
  let total = 0;
  let withinCount = 0;
  let withinStart = 0;
  for (const { decoded, plan, language } of cases(hiRate, true)) {
    const tokens = new Map();
    const starts = new Map();
    for (const segment of plan.segments) {
      const token = segment.token;
      if (!token || starts.has(token)) {
        continue;
      }
      starts.set(token, segment.start);
      if (token.kind === 'vowel' || token.kind === 'consonant') {
        if (!tokens.has(token.word)) {
          tokens.set(token.word, []);
        }
        tokens.get(token.word).push(token);
      }
    }
    const reference = [...tokens.values()].flatMap((word) =>
      syllabifyTokens(word, { language }).map((syllable) =>
        starts.get(syllable[0])
      )
    );
    const { syllables, segments } = decoded;
    total += reference.length;
    withinCount += Math.abs(syllables.length - reference.length);
    reference.forEach((time, i) => {
      withinStart += Number(
        Math.abs(time - (syllables[i]?.start ?? Infinity)) <= 0.05
      );
    });
    for (const syllable of syllables) {
      const [first, end] = syllable.segments;
      assert.equal(syllable.start, segments[first].start);
      assert.equal(syllable.end, segments[end - 1].end);
    }
  }
  console.log(
    'decoder syllable error count, within 50 ms',
    withinCount / total,
    withinStart / total
  );
  gate('syllable count relative error', withinCount / total, 0.1);
  gate('syllable starts within 50 ms', withinStart / total, 1, true);
});

it('stream fixes phonemes in time', () => {
  let latest = 0;
  const excess = [];
  for (const [language, sentences] of Object.entries(DECODE_SENTENCES)) {
    const text = sentences[0];
    for (const voice of Object.values(DECODER_VOICES)) {
      const { samples, plan } = renderDecoderText(
        text,
        voice,
        hiRate,
        language
      );
      const options = { voice, language };
      const batch = audioToIpa(samples, hiRate, options);
      const stream = createIpaDecoder(hiRate, options);
      const fixed = [];
      for (let first = 0; first < samples.length; first += hiRate / 50) {
        const end = Math.min(first + hiRate / 50, samples.length);
        for (const segment of stream.push(samples.subarray(first, end))
          .segments) {
          fixed.push(segment);
          if (segment.kind !== 'pause') {
            latest = Math.max(latest, end / hiRate - segment.end);
          }
        }
      }
      for (const segment of stream.flush().segments) {
        fixed.push(segment);
        if (segment.kind !== 'pause') {
          latest = Math.max(latest, samples.length / hiRate - segment.end);
        }
      }
      const recognized = stream.result();
      assert.deepEqual(recognized.segments, fixed);
      const ref = plannedPhones(plan).map(({ ipa }) => ipa);
      excess.push(
        errorRate(ref, recognized.ipa, 'phone').rate -
          errorRate(ref, batch.ipa, 'phone').rate
      );
      stream.reset();
      assert.equal(stream.result().ipa, '');
    }
  }
  console.log(
    'decoder streaming max delay and extra PER',
    latest,
    mean(excess)
  );
  assert.ok(latest <= 0.55, `Stream commitment took ${latest} seconds`);
  gate('stream PER above batch', mean(excess), 0.05);
});

it('stays within the CPU budget', () => {
  const voice = DECODER_VOICES.male;
  const known = { voice, language: 'en' };
  for (const rate of [hiRate, lowRate]) {
    const text = DECODE_SENTENCES.en[0];
    const { samples } = renderDecoderText(text, voice, rate, 'en');
    const settings = decoderSettings(rate, known);
    const analysis = analyzeForDecode(samples, rate, known, settings);
    prepareIpaDecode(analysis, settings);
    const duration = samples.length / rate;
    let decodeTime = Infinity;
    let full = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = globalThis.performance.now();
      const { prepared, templates } = prepareIpaDecode(analysis, settings);
      resultOf(
        analysis,
        settings,
        prepared,
        templates,
        decodeSearch(prepared, settings.language, settings)
      );
      decodeTime = Math.min(
        decodeTime,
        (globalThis.performance.now() - start) / 1000 / duration
      );
      const all = globalThis.performance.now();
      audioToIpa(samples, rate, known);
      full = Math.min(
        full,
        (globalThis.performance.now() - all) / 1000 / duration
      );
    }
    console.log('decode rtf', decodeTime, rate);
    console.log('audioToIpa rtf', full, rate);
    assert.ok(full <= 1);
    gate(`decode RTF at ${rate} Hz`, decodeTime, 0.05);
    gate(`warm audioToIpa RTF at ${rate} Hz`, full, 0.35);
  }
});
