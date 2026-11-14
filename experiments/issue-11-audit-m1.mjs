// Measurements behind the M1 plan issues (P10, P12, P14, P16, P17) of issue 11.
// Run: node experiments/issue-11-audit-m1.mjs > experiments/issue-11-audit-m1.txt
import { performance } from 'node:perf_hooks';
import {
  textToIpa,
  planUtterance,
  renderPlan,
  sampleState,
  tractShape,
  synthesize,
  analyzeVoice,
  normalizeHeadConfig,
} from '../src/index.js';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);

const sentence = 'The quick brown fox jumps over the lazy dog.';
const vowels = ['aː', 'iː', 'uː'];

const formants = (ipa, options) => {
  const out = synthesize(ipa, { ipa: true, seed: 1, ...options });
  return analyzeVoice(out.samples, out.sampleRate)
    .formants.slice(0, 3)
    .map(Math.round);
};

const rtf = (options) => {
  let best = Infinity;
  let duration = 0;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    const out = synthesize(sentence, { seed: 1, ...options });
    best = Math.min(best, (performance.now() - started) / 1000);
    duration = out.duration;
  }
  return Number((best / duration).toFixed(3));
};

// 1. Narrow-band candidates: F1-F3 of three long vowels and the real-time
//    factor of a sentence, per (output rate, section count), against the
//    44-section waveguide at 48 kHz.
const reference = vowels.map((ipa) =>
  formants(ipa, { solver: 'waveguide', sections: 44, sampleRate: 48000 })
);
show('reference 44@48000', {
  formants: Object.fromEntries(vowels.map((ipa, i) => [ipa, reference[i]])),
  rtf: rtf({ solver: 'waveguide', sections: 44, sampleRate: 48000 }),
});
for (const sampleRate of [8000, 11025, 16000]) {
  for (const sections of [8, 11, 12, 16, 22, 44]) {
    const options = { solver: 'waveguide', sections, sampleRate };
    const measured = vowels.map((ipa) => formants(ipa, options));
    let worst = 0;
    measured.forEach((list, vowel) =>
      list.forEach((value, index) => {
        const target = reference[vowel][index];
        worst = Math.max(worst, Math.abs(value - target) / target);
      })
    );
    show(`${sections}@${sampleRate}`, {
      formants: Object.fromEntries(vowels.map((ipa, i) => [ipa, measured[i]])),
      worstDeviation: Number(worst.toFixed(3)),
      rtf: rtf(options),
    });
  }
}

// 2. Share of the render time spent in sampleState() + tractShape(), the
//    part that stays in JavaScript when the solver moves to Rust.
const { ipa } = textToIpa(sentence, { lang: 'en' });
const head = normalizeHeadConfig({});
const plan = planUtterance(ipa, { head });
for (const [sections, sampleRate] of [
  [22, 22050],
  [44, 48000],
]) {
  let started = performance.now();
  renderPlan(plan, { solver: 'waveguide', sections, sampleRate, seed: 1 });
  const render = (performance.now() - started) / 1000;
  const state = {};
  const step = 32 / sampleRate;
  let frames = 0;
  started = performance.now();
  for (let time = 0; time < plan.duration; time += step) {
    sampleState(plan, time, state);
    tractShape(state, head, { sections, teeth: true });
    frames++;
  }
  const shapes = (performance.now() - started) / 1000;
  show(`shape share ${sections}@${sampleRate}`, {
    duration: Number(plan.duration.toFixed(2)),
    frames,
    renderSeconds: Number(render.toFixed(3)),
    shapeSeconds: Number(shapes.toFixed(3)),
    share: Number((shapes / render).toFixed(2)),
  });
}

// 3. The present cheap tiers on the same scale, for the cost ladder.
for (const [sections, sampleRate] of [
  [22, 22050],
  [32, 32000],
]) {
  show(`present ${sections}@${sampleRate}`, {
    rtf: rtf({ solver: 'waveguide', sections, sampleRate }),
  });
}

// 4. Control interval: the renderer updates the tract every `blockSize`
//    output samples (32), which is 4 ms at 8 kHz but 1.45 ms at 22.05 kHz.
//    Cost and effect of keeping about 1.5 ms at the narrow-band rates.
const level = (samples) =>
  Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0));
for (const [sections, sampleRate, blockSize] of [
  [12, 8000, 12],
  [16, 11025, 16],
  [22, 16000, 24],
]) {
  const render = (size) => {
    const started = performance.now();
    const samples = renderPlan(plan, {
      solver: 'waveguide',
      sections,
      sampleRate,
      seed: 1,
      blockSize: size,
    });
    return { samples, seconds: (performance.now() - started) / 1000 };
  };
  const coarse = render(32);
  const fine = render(blockSize);
  const difference = coarse.samples.map(
    (value, index) => value - fine.samples[index]
  );
  show(`control interval ${sections}@${sampleRate}`, {
    blockSize,
    rtf32: Number((coarse.seconds / plan.duration).toFixed(3)),
    rtfFine: Number((fine.seconds / plan.duration).toFixed(3)),
    differenceDb: Number(
      (20 * Math.log10(level(difference) / level(fine.samples))).toFixed(1)
    ),
  });
}

// 5. Size of the 3D problem per tier: active cells, links and solver
//    steps per second of audio (dt = COURANT * dx / SPEED_OF_SOUND).
const { buildVoxelModel, DEFAULT_HEAD } = await import('../src/index.js');
const box = { width: 40, height: 40, depth: 40 };
for (const [dx, enclosure] of [
  [1],
  [0.6],
  [0.5],
  [0.4],
  [1, box],
  [0.5, box],
]) {
  const started = performance.now();
  const model = buildVoxelModel(DEFAULT_HEAD, { dx, enclosure });
  show(`voxels dx ${dx}${enclosure ? ' in a 40 cm box' : ''}`, {
    cells: model.cells.length,
    links: model.links.a.length,
    stepsPerSecond: Math.round(35000 / (0.5 * dx)),
    buildSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
  });
}

// 6. Size of the embedded hand-written WebAssembly kernel.
const kernel = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(
    new globalThis.URL('../src/acoustics/fdtd-kernel.js', import.meta.url),
    'utf8'
  )
);
const base64 = /'([A-Za-z0-9+/=]{200,})'/.exec(kernel)[1];
show('wasm kernel', {
  base64Characters: base64.length,
  bytes: Buffer.from(base64, 'base64').length,
});

// 7. Aliasing at 8 kHz (P14). The same solver (12 sections) is rendered once
// straight at 8000 Hz and once at 24000 Hz followed by the windowed-sinc
// `resample` to 8000 Hz. The second is the band-limited reference. The level
// of the band 300-3400 Hz is compared; a positive difference is energy
// folded down from above 4000 Hz.
const { resample } = await import('../src/audio/resample.js');
const bandLevel = (samples, sampleRate, low, high) => {
  const size = 2048;
  const start = Math.max(0, Math.floor((samples.length - size) / 2));
  let energy = 0;
  for (let bin = 1; bin < size / 2; bin++) {
    const frequency = (bin * sampleRate) / size;
    if (frequency < low || frequency > high) {
      continue;
    }
    let real = 0;
    let imaginary = 0;
    for (let n = 0; n < size; n++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
      const value = (samples[start + n] ?? 0) * window;
      real += value * Math.cos((2 * Math.PI * bin * n) / size);
      imaginary -= value * Math.sin((2 * Math.PI * bin * n) / size);
    }
    energy += real * real + imaginary * imaginary;
  }
  return 10 * Math.log10(energy + 1e-30);
};
for (const ipa of ['aː', 'sː', 'ʃː']) {
  const common = { ipa: true, seed: 1, solver: 'waveguide', sections: 12 };
  const direct = synthesize(ipa, { ...common, sampleRate: 8000 });
  const wide = synthesize(ipa, { ...common, sampleRate: 24000 });
  const reference = resample(wide.samples, 24000, 8000);
  show(`aliasing 12@8000 ${ipa}`, {
    samples: direct.samples.length,
    excessDb: Number(
      (
        bandLevel(direct.samples, 8000, 300, 3400) -
        bandLevel(reference, 8000, 300, 3400)
      ).toFixed(1)
    ),
  });
}

// 8. The present load-time benchmark (P16), in a fresh process so that the
// code is as cold as in a page that has just loaded. Three runs of
// `benchmarkAudioTiers` with the 0.08 s probe of the app's worker, then the
// wall time of one probe per tier (which includes building the voxel model).
const benchmarkSection = `
  import { performance } from 'node:perf_hooks';
  import { benchmarkAudioTiers, measureAudioTier, AUDIO_TIERS } from
    ${JSON.stringify(new globalThis.URL('../src/index.js', import.meta.url).href)};
  const round = (value) => Number(value.toFixed(2));
  for (let run = 1; run <= 3; run++) {
    const began = performance.now();
    const result = benchmarkAudioTiers({ seconds: 0.08 });
    console.log('benchmark run ' + run + ': ' + JSON.stringify({
      milliseconds: Math.round(performance.now() - began),
      selected: result.tier.name,
      loads: result.loads.map(round),
      measured: result.measured,
    }));
  }
  for (const tier of AUDIO_TIERS) {
    const began = performance.now();
    const load = measureAudioTier(tier, { seconds: 0.08, limit: 1.6 });
    console.log('probe ' + tier.name + ': ' + JSON.stringify({
      milliseconds: Math.round(performance.now() - began),
      load: round(load),
    }));
  }
`;
const { execFileSync } = await import('node:child_process');
process.stdout.write(
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', benchmarkSection],
    { encoding: 'utf8' }
  )
);

// 9. Level of the same utterance on neighbouring tiers (P17): a change of
// tier in the middle of an utterance must not change the loudness.
for (const tier of ['minimal', 'low', 'medium', 'high']) {
  const out = synthesize('həˈloʊ', { ipa: true, seed: 1, tier });
  let sum = 0;
  let peak = 0;
  for (const value of out.samples) {
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  show(`level ${tier}`, {
    sampleRate: out.sampleRate,
    rmsDb: Number((10 * Math.log10(sum / out.samples.length)).toFixed(1)),
    peak: Number(peak.toFixed(3)),
  });
}

// 10. How alike two tiers are during a crossfade (P17): the same sound and
// seed on two tiers, both at 48 kHz, compared over 25 ms from 0.15 s. `r` is
// the normalized correlation at lag 0, `lag` the lag (in samples at 48 kHz,
// searched within 2 ms) with the best correlation, and `bumpDb` the level
// rise in the middle of an equal-power crossfade, 10 * log10(1 + r).
const STREAM_RATE = 48000;
const atStreamRate = (ipa, tier) => {
  const out = synthesize(ipa, { ipa: true, seed: 1, tier });
  return resample(out.samples, out.sampleRate, STREAM_RATE);
};
for (const ipa of ['aː', 'sː']) {
  const reference = atStreamRate(ipa, 'medium');
  const from = Math.round(0.15 * STREAM_RATE);
  const count = Math.round(0.025 * STREAM_RATE);
  for (const tier of ['minimal', 'low', 'high']) {
    const other = atStreamRate(ipa, tier);
    const correlation = (lag) => {
      let cross = 0;
      let first = 0;
      let second = 0;
      for (let index = from; index < from + count; index++) {
        cross += reference[index] * other[index + lag];
        first += reference[index] ** 2;
        second += other[index + lag] ** 2;
      }
      return cross / Math.sqrt(first * second);
    };
    let lag = 0;
    for (let candidate = -96; candidate <= 96; candidate++) {
      if (correlation(candidate) > correlation(lag)) {
        lag = candidate;
      }
    }
    const r = correlation(0);
    show(`crossfade ${ipa} medium to ${tier}`, {
      r: Number(r.toFixed(3)),
      lag,
      bumpDb: Number((10 * Math.log10(1 + Math.max(0, r))).toFixed(2)),
    });
  }
}
