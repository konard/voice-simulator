/** Check voiced envelope calibration across rates and speakers. Unlicense. */
import {
  analyzeFrames,
  buildCodebook,
  errorRate,
  frameEnvelope,
  invertArticulation,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  trackFormants,
  trackPitch,
  synthesize,
  tractShape,
} from '../src/index.js';
import { CHANNEL_DEFAULTS } from '../src/articulation/plan.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { VOWELS } from '../src/ipa/inventory.js';
import {
  GRID,
  normalizeEnvelope,
  steadyPlan,
  tractResponse,
} from '../src/recognition/codebook-features.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  segmentsOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { codebookSeeds } from '../src/recognition/codebook-seeds.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const renderOptions = { engine: 'js', seed: 1, solver: 'waveguide' };

function calibration(voice, rate, book, telephone) {
  const state = { ...CHANNEL_DEFAULTS };
  const plan = steadyPlan(state, 0.15);
  plan.channels.f0.fill(voice.pitch);
  const narrow = telephone ? { sections: 12, bandLimit: 3400 } : {};
  const audio = renderPlan(plan, {
    ...renderOptions,
    ...narrow,
    head: voice,
    sampleRate: rate,
  });
  const frames = analyzeFrames(audio, rate);
  const envelope = new Float64Array(GRID.length);
  frameEnvelope(frames, Math.floor(frames.count / 2), book, {
    envelope,
    key: new Float64Array(6),
  });
  const shape = tractShape(state, voice);
  const analytic = tractResponse(
    shape.areas,
    shape.length,
    GRID.map((f) => f / book.lengthScale),
    new Float64Array(GRID.length)
  );
  for (let j = 0; j < envelope.length; j++) {
    if (!Number.isFinite(envelope[j])) {
      analytic[j] = NaN;
    }
  }
  normalizeEnvelope(analytic);
  return envelope.map((db, j) =>
    Number.isFinite(analytic[j]) ? db - analytic[j] : 0
  );
}

function meanEnvelopes(frames, t, book) {
  const envelope = new Float64Array(GRID.length);
  const key = new Float64Array(6);
  const rows = [];
  for (
    let i = Math.max(0, t - 3);
    i <= Math.min(frames.count - 1, t + 3);
    i++
  ) {
    frameEnvelope(frames, i, book, { envelope, key });
    rows.push(envelope.slice());
  }
  return envelope.map(
    (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length
  );
}

const pitchLevels = [0.72, 0.86, 1, 1.16, 1.35];

function vowelReferences(voice, book, rate, hop) {
  const references = codebookSeeds().filter(({ kind }) => kind === 'vowel');
  return references.map(({ state, phone }) => ({
    state,
    row: book.phone.indexOf(phone),
    envelopes: pitchLevels.map((scale) => {
      const reference = steadyPlan(state, 0.16);
      reference.channels.f0.fill(voice.pitch * scale);
      const samples = renderPlan(reference, {
        ...renderOptions,
        ...(rate === 8000 && { sections: 12, bandLimit: 3400 }),
        head: voice,
        sampleRate: rate,
      });
      const modeled = analyzeFrames(samples, rate, { hop });
      return meanEnvelopes(modeled, Math.floor(modeled.count / 2), book);
    }),
  }));
}

function rankVowels(envelope, actualPitch, candidates, pitchWeight) {
  return candidates
    .map(({ state, row, envelopes }) => {
      let best = Infinity;
      for (const [m, reference] of envelopes.entries()) {
        let cost = pitchWeight * Math.log(actualPitch / pitchLevels[m]) ** 2;
        for (let j = 0; j < envelope.length; j++) {
          if (Number.isFinite(envelope[j]) && Number.isFinite(reference[j])) {
            cost += (envelope[j] - reference[j]) ** 2 / envelope.length;
          }
        }
        best = Math.min(best, cost);
      }
      return { row, state, cost: best };
    })
    .sort((a, b) => a.cost - b.cost);
}

function renderedVowels(voice, book, frames, plan, candidates) {
  const pitch = trackPitch(frames);
  const hits = [0, 0, 0];
  const total = plan.segments.filter(({ kind }) => kind === 'vowel').length;
  for (const { kind, start, end } of plan.segments) {
    if (kind !== 'vowel') {
      continue;
    }
    const t = Math.round((start + end) / (2 * frames.hop));
    const envelope = meanEnvelopes(frames, t, book);
    const truth = sampleState(plan, t * frames.hop);
    const actualPitch = (pitch.f0[t] || voice.pitch) / voice.pitch;
    for (const [i, pitchWeight] of [0, 50, 250].entries()) {
      const [{ state: winner }] = rankVowels(
        envelope,
        actualPitch,
        candidates,
        pitchWeight
      );
      hits[i] += Number(
        Math.abs(truth.height - winner.height) <= 0.15 &&
          Math.abs(truth.backness - winner.backness) <= 0.2
      );
    }
  }
  console.log(
    JSON.stringify({
      experiment: 'rendered-vowels',
      pitch: voice.pitch,
      hits,
      total,
    })
  );
}

function renderedInversion(frames, voice, book, candidates, options) {
  const { hold, drift = 16 } = options;
  const pitch = options.pitch ?? trackPitch(frames);
  const formants =
    options.formants ??
    trackFormants(frames, {
      pitch,
      vocalTractLength: voice.vocalTractLength,
    });
  const valid = formants.valid.slice();
  const available = candidates.filter(({ row }) => row >= 0);
  const analytic = calibratedQuery(frames, book, null, 0, true);
  const width = Math.round(hold / frames.hop);
  const envelopeDelta = (before, current) =>
    before.reduce(
      (total, db, i) =>
        total + (Number.isFinite(db) ? (db - current[i]) ** 2 : 0),
      0
    ) / before.length;
  const refs = { uses: 0 };
  const query = (t, out) => {
    if (
      t < width + 6 ||
      pitch.f0.subarray(t - width, t + 1).some((f0) => !f0)
    ) {
      analytic(t, out);
      return;
    }
    const envelope = meanEnvelopes(frames, t - 3, book);
    const before = meanEnvelopes(frames, t - width, book);
    if (envelopeDelta(before, envelope) > drift) {
      analytic(t, out);
      return;
    }
    const ranks = rankVowels(
      envelope,
      pitch.f0[t] / voice.pitch,
      available,
      50
    );
    if (ranks[0].cost > 45) {
      analytic(t, out);
      return;
    }
    refs.uses++;
    valid.fill(0, t * 4, t * 4 + 4);
    out.index.fill(-1);
    ranks.slice(0, out.index.length).forEach(({ row, cost }, i) => {
      out.index[i] = row;
      out.cost[i] = 16 * (cost - ranks[0].cost);
    });
  };
  const track = invertArticulation(frames, {
    voice,
    codebook: book,
    pitch,
    formants: { ...formants, valid },
    query,
  });
  return { track, ...refs };
}

function calibratedQuery(frames, book, correction, weight, periodicOnly) {
  const scratch = {
    envelope: new Float64Array(GRID.length),
    key: new Float64Array(6),
  };
  return (frame, out) => {
    frameEnvelope(frames, frame, book, scratch);
    if (weight && (!periodicOnly || frames.periodicity[frame] >= 0.45)) {
      for (let j = 0; j < scratch.envelope.length; j++) {
        scratch.envelope[j] -= weight * correction[j];
      }
    }
    book.query(scratch.envelope, out.index.length, out);
  };
}

const stabilitySettings = [
  { hold: 0.04, drift: 16 },
  { hold: 0.08, drift: 2 },
  { hold: 0.08, drift: 4 },
  { hold: 0.08, drift: 8 },
  { hold: 0.08, drift: 16 },
  { hold: 0.12, drift: 16 },
];

function steadyVowels() {
  const vowels = Object.keys(VOWELS);
  for (const preset of ['male', 'female']) {
    const voice = presetHeadConfig(preset);
    const codebook = buildCodebook(voice, { size: 5000 });
    const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
      head: voice,
      durations: vowels.map(() => 0.3),
    });
    const sampleRate = 16000;
    const samples = renderPlan(plan, { ...renderOptions, sampleRate });
    const frames = analyzeFrames(samples, sampleRate);
    const candidates = vowelReferences(voice, codebook, sampleRate, frames.hop);
    renderedVowels(voice, codebook, frames, plan, candidates);
    const correction = calibration(voice, sampleRate, codebook, false);
    for (const weight of [0, 0.5, 1, 1.5]) {
      const track = invertArticulation(frames, {
        voice,
        codebook,
        query: calibratedQuery(frames, codebook, correction, weight, true),
      });
      const correct = countSteadyVowels(plan, frames, track);
      console.log(
        JSON.stringify({ preset, weight, correct, total: vowels.length })
      );
    }
    for (const stability of stabilitySettings) {
      const { track, uses } = renderedInversion(
        frames,
        voice,
        codebook,
        candidates,
        stability
      );
      console.log(
        JSON.stringify({
          preset,
          ...stability,
          uses,
          frames: frames.count,
          correct: countSteadyVowels(plan, frames, track),
          total: vowels.length,
        })
      );
    }
  }
}

function countSteadyVowels(plan, frames, track) {
  let correct = 0;
  for (const { kind, start, end } of plan.segments) {
    if (kind !== 'vowel') {
      continue;
    }
    const t = Math.round((start + end) / (2 * frames.hop));
    const truth = sampleState(plan, t * frames.hop);
    const height = Math.abs(truth.height - track.channels.height[t]);
    const backness = Math.abs(truth.backness - track.channels.backness[t]);
    correct += Number(height <= 0.15 && backness <= 0.2);
  }
  return correct;
}

function sentenceSpeech(tier) {
  const cases = [
    ['en', 17],
    ['ru', 1],
    ['hi', 1],
    ['zh', 1],
  ];
  if (process.argv.includes('--held-out')) {
    cases.push(['en', 6], ['ru', 5], ['hi', 15], ['zh', 13]);
  }
  for (const [lang, index] of cases) {
    const spoken = synthesize(sentences[lang][index], {
      lang,
      head: 'random',
      preset: 'male',
      seed: 1,
      tier,
    });
    const { samples, sampleRate } = spoken;
    const settings = decoderSettings(sampleRate, {
      languages: Object.keys(sentences),
      beam: 8,
      hop: 0.01,
      whisper: false,
    });
    const analysis = analyzeForDecode(samples, sampleRate, {}, settings);
    const { frames, tracks, voice } = analysis;
    const { pitch, formants } = tracks;
    const codebook = buildCodebook(voice, { size: 256 });
    const correction = calibration(
      voice,
      sampleRate,
      codebook,
      tier === 'telephone'
    );
    const rendered = vowelReferences(voice, codebook, sampleRate, frames.hop);
    const candidates = [
      [0, false],
      [0.5, false],
      [1, false],
      [0.5, true],
      [1, true],
    ];
    for (const [weight, periodicOnly] of candidates) {
      const articulation = invertArticulation(frames, {
        voice,
        codebook,
        pitch,
        formants,
        query: calibratedQuery(
          frames,
          codebook,
          correction,
          weight,
          periodicOnly
        ),
      });
      const errors = phoneErrors(spoken, analysis, settings, articulation);
      console.log(
        JSON.stringify({ tier, lang, index, weight, periodicOnly, ...errors })
      );
    }
    for (const stability of stabilitySettings) {
      const { track, uses } = renderedInversion(
        frames,
        voice,
        codebook,
        rendered,
        { ...stability, pitch, formants }
      );
      const errors = phoneErrors(spoken, analysis, settings, track);
      console.log(
        JSON.stringify({
          tier,
          lang,
          index,
          ...stability,
          uses,
          frames: frames.count,
          ...errors,
        })
      );
    }
  }
}

function phoneErrors(spoken, analysis, settings, articulation) {
  const { prepared, templates } = prepareIpaDecode(
    { ...analysis, tracks: { ...analysis.tracks, articulation } },
    settings
  );
  const { paths } = decodeSearch(prepared, settings.language, {
    ...settings,
    lattice: false,
  });
  const heard = segmentsOf(
    paths[0],
    prepared.times,
    templates,
    settings.language
  )
    .map(({ ipa }) => ipa)
    .join('');
  const { distance, referenceLength } = errorRate(spoken.ipa, heard, 'phone');
  return { distance, referenceLength };
}

steadyVowels();
sentenceSpeech(process.argv.includes('--wideband') ? 'wideband' : 'telephone');
