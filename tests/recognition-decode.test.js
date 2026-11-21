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
import { planRecognitionTemplate } from '../src/articulation/plan.js';
import { VOWELS } from '../src/ipa/inventory.js';
import {
  decoderTemplates,
  TEMPLATE_CHANNELS,
} from '../src/recognition/decode-model.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { prepareDecode } from '../src/recognition/decode-spans.js';
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

it('uses the same phone trajectories as the synthesis planner', () => {
  const options = { head: { pitch: 181, speechRate: 5, vibrato: 0.7 } };
  for (const ipa of ['a', 'əpʰə', 'ət͡ʃə', 'əǃə', 'a˨˩˦']) {
    const full = planUtterance(ipa, options);
    const template = planRecognitionTemplate(ipa, options, TEMPLATE_CHANNELS);
    assert.deepEqual(template.segments, full.segments);
    for (const name of TEMPLATE_CHANNELS) {
      assert.deepEqual(
        template.channels[name],
        full.channels[name],
        `${ipa}: ${name}`
      );
    }
  }
});

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
  const best = { beam: 2, nbest: 1, weights };
  assert.deepEqual(
    decodeSearch(prepared, language, { ...best, lattice: false }).paths,
    decodeSearch(prepared, language, { ...best, lattice: true }).paths
  );
});

it('decodes steady speech across a gap in boundary candidates', () => {
  const count = 380;
  const hop = 0.005;
  const speech = new Uint8Array(count).fill(1);
  speech.fill(0, 100, 280);
  const frames = { hop, startTime: 0, speech };
  const classes = new Uint8Array(count).fill(1);
  classes.fill(0, 100, 280);
  const landmarks = { count, classes, landmarks: [] };
  const flat = new Float32Array(count);
  const channels = Object.fromEntries(
    TEMPLATE_CHANNELS.map((name) => [name, flat])
  );
  channels.voicing = Float32Array.from(speech);
  const voice = DECODER_VOICES.male;
  const templates = decoderTemplates(voice, ['a']);
  const track = {
    frameCount: count,
    frameRate: 1 / hop,
    startTime: 0,
    channels,
    variance: channels,
  };
  const prepared = prepareDecode(frames, landmarks, track, templates, {
    from: 0,
    to: count * hop,
  });
  assert.deepEqual(
    Array.from(prepared.times, (time) => Math.round(time * 1000)),
    [0, 250, 500, 1400, 1650, 1900]
  );
  const result = decodeSearch(
    prepared,
    { symbols: ['a'], costs: new Float64Array(2) },
    { ...decoderSettings(hiRate, {}), beam: 1 }
  );
  assert.equal(result.paths.length, 1);
  const pauses = result.edges.filter(({ pause }) => pause);
  assert.deepEqual(
    pauses.map(({ from, to }) => [from, to]),
    [[2, 3]]
  );
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

it('rejects an oversized stream chunk before processing it', () => {
  const stream = createIpaDecoder(lowRate, { maxSeconds: 0.1 });
  assert.throws(() => stream.push(new Float32Array(lowRate)), RangeError);
  assert.equal(stream.result().frames.sampleCount, 0);
  stream.push(new Float32Array(lowRate / 10));
  assert.deepEqual(stream.flush().segments, []);
  assert.equal(stream.result().frames.sampleCount, lowRate / 10);
});

it('keeps the fitted stream voice until a long gap', () => {
  const plan = planUtterance('a', {
    head: DECODER_VOICES.female,
    durations: [0.6],
  });
  const samples = renderPlan(plan, {
    sampleRate: hiRate,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const stream = createIpaDecoder(hiRate, { language: 'en' });
  const recording = new Float32Array(samples.length + 0.45 * hiRate);
  recording.set(samples);
  let previous = stream.result();
  let changes = 0;
  for (let i = 0; i < recording.length; i += hiRate / 50) {
    stream.push(recording.subarray(i, i + hiRate / 50));
    const current = stream.result();
    if (previous.tracks.formants && current.voice !== previous.voice) {
      const { count, speech, hop } = current.frames;
      const last = speech.subarray(0, count).findLastIndex(Boolean);
      assert.ok((count - last - 1) * hop >= 0.3);
      changes++;
    }
    previous = current;
  }
  assert.ok(changes >= 1);
  stream.flush();
  const result = stream.result();
  assert.deepEqual(result.tracks.articulation.head, result.voice);
  assert.equal(result.tracks.formants.count, result.frames.count);
  const { height } = result.tracks.articulation.channels;
  assert.ok(height.subarray(0, result.frames.count).every(Number.isFinite));
});

function streamSentence(text, voice, language) {
  const { samples, plan } = renderDecoderText(text, voice, hiRate, language);
  const options = { voice, language };
  const batch = audioToIpa(samples, hiRate, options);
  const stream = createIpaDecoder(hiRate, options);
  const fixed = [];
  let latest = 0;
  function collect(segments, end) {
    for (const segment of segments) {
      fixed.push(segment);
      if (segment.kind !== 'pause') {
        latest = Math.max(latest, end / hiRate - segment.end);
      }
    }
  }
  for (let first = 0; first < samples.length; first += hiRate / 50) {
    const end = Math.min(first + hiRate / 50, samples.length);
    collect(stream.push(samples.subarray(first, end)).segments, end);
  }
  collect(stream.flush().segments, samples.length);
  const recognized = stream.result();
  assert.deepEqual(recognized.segments, fixed);
  const ref = plannedPhones(plan).map(({ ipa }) => ipa);
  const excess =
    errorRate(ref, recognized.ipa, 'phone').rate -
    errorRate(ref, batch.ipa, 'phone').rate;
  stream.reset();
  assert.equal(stream.result().ipa, '');
  return { latest, excess };
}

const streamingResults = [];
for (const [language, sentences] of Object.entries(DECODE_SENTENCES)) {
  for (const [preset, voice] of Object.entries(DECODER_VOICES)) {
    it(`streams ${language} sentences (${preset})`, () => {
      for (const text of sentences) {
        streamingResults.push(streamSentence(text, voice, language));
      }
    });
  }
}

it('stream fixes phonemes in time', () => {
  assert.equal(streamingResults.length, 32);
  const latest = Math.max(...streamingResults.map((result) => result.latest));
  const excess = mean(streamingResults.map((result) => result.excess));
  console.log('decoder streaming max delay and extra PER', latest, excess);
  assert.ok(latest <= 0.55, `Stream commitment took ${latest} seconds`);
  gate('stream PER above batch', excess, 0.05);
});

it('stays within the CPU budget', () => {
  for (const [rate, voice] of [
    [hiRate, DECODER_VOICES.male],
    [lowRate, DECODER_VOICES.female],
  ]) {
    const known = { voice, language: 'en' };
    const text = DECODE_SENTENCES.en[0];
    const { samples } = renderDecoderText(text, voice, rate, 'en');
    const duration = samples.length / rate;
    const coldStart = globalThis.performance.now();
    audioToIpa(samples, rate, known);
    const cold = (globalThis.performance.now() - coldStart) / 1000 / duration;
    const fitStart = globalThis.performance.now();
    audioToIpa(samples, rate, { language: 'en' });
    const fitted = (globalThis.performance.now() - fitStart) / 1000 / duration;
    const settings = decoderSettings(rate, known);
    const analysis = analyzeForDecode(samples, rate, known, settings);
    prepareIpaDecode(analysis, settings);
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
    console.log('audioToIpa first call and fitted rtf', cold, fitted, rate);
    assert.ok(Math.max(full, cold, fitted) <= 1);
    gate(`decode RTF at ${rate} Hz`, decodeTime, 0.05);
    gate(`warm audioToIpa RTF at ${rate} Hz`, full, 0.35);
    gate(`first call RTF at ${rate} Hz`, cold, 0.35);
    gate(`fitted voice RTF at ${rate} Hz`, fitted, 0.65);
  }
});
