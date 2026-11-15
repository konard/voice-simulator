// Issue 26: the numbers behind tests/narrow-band.test.js.
//
//   node experiments/issue-26-narrow-band.mjs
//
// 1. F1-F3 of aː, iː, uː at each narrow-band tier against waveguide
//    44 sections at 48 kHz (worst relative difference per tier).
// 2. Aliasing at `telephone`: the level of 300-3400 Hz against the same
//    solver rendered at 24 kHz without a band limit and resampled to 8 kHz
//    (the method of section 7 of experiments/issue-11-audit-m1.mjs).
// 3. Band limit: level above bandLimit * 1.1 below the level of
//    300 Hz..bandLimit, for sː.
// 4. analyzeVoice at 8 kHz for the pangram.
import { AUDIO_TIERS, analyzeVoice, synthesize } from '../src/index.js';
import { resample } from '../src/audio/resample.js';

const REFERENCE = { solver: 'waveguide', sections: 44, sampleRate: 48000 };
const NARROW = AUDIO_TIERS.filter((tier) => tier.bandLimit);

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

const vowelFormants = (ipa, options) => {
  const result = synthesize(ipa, { ipa: true, seed: 1, ...options });
  return analyzeVoice(result.samples, result.sampleRate).formants.slice(0, 3);
};

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);

// 1. Formants.
const references = {};
for (const ipa of ['aː', 'iː', 'uː']) {
  references[ipa] = vowelFormants(ipa, REFERENCE);
  show(`reference ${ipa}`, references[ipa].map(Math.round));
}
for (const tier of NARROW) {
  let worst = { difference: 0 };
  for (const ipa of ['aː', 'iː', 'uː']) {
    const formants = vowelFormants(ipa, { tier: tier.name });
    show(`${tier.name} ${ipa}`, formants.map(Math.round));
    formants.forEach((value, order) => {
      const difference = Math.abs(value / references[ipa][order] - 1);
      if (difference > worst.difference) {
        worst = { difference, ipa, formant: `F${order + 1}` };
      }
    });
  }
  show(`worst ${tier.name}`, {
    ...worst,
    difference: `${(100 * worst.difference).toFixed(1)} %`,
  });
}

// 2. Aliasing at telephone.
const telephone = AUDIO_TIERS.find((tier) => tier.name === 'telephone');
for (const ipa of ['aː', 'sː', 'ʃː']) {
  const common = {
    ipa: true,
    seed: 1,
    solver: telephone.solver,
    sections: telephone.sections,
    blockSize: telephone.blockSize,
  };
  const direct = synthesize(ipa, { ...common, tier: 'telephone' });
  const wide = synthesize(ipa, { ...common, sampleRate: 24000 });
  const reference = resample(wide.samples, 24000, 8000);
  const unfiltered = synthesize(ipa, { ...common, sampleRate: 8000 });
  show(`aliasing telephone ${ipa}`, {
    excessDb: Number(
      (
        bandLevel(direct.samples, 8000, 300, 3400) -
        bandLevel(reference, 8000, 300, 3400)
      ).toFixed(2)
    ),
    withoutBandLimitDb: Number(
      (
        bandLevel(unfiltered.samples, 8000, 300, 3400) -
        bandLevel(reference, 8000, 300, 3400)
      ).toFixed(2)
    ),
  });
}

// 3. Band limit.
for (const tier of NARROW) {
  const { samples, sampleRate } = synthesize('sː', {
    ipa: true,
    seed: 1,
    tier: tier.name,
  });
  const pass = bandLevel(samples, sampleRate, 300, tier.bandLimit);
  const stop = bandLevel(samples, sampleRate, tier.bandLimit * 1.1, Infinity);
  show(`band limit ${tier.name} sː`, {
    passDb: Number(pass.toFixed(1)),
    stopDb: Number(stop.toFixed(1)),
    rejectionDb: Number((pass - stop).toFixed(1)),
  });
}

// 4. Analysis at 8 kHz.
const SENTENCE = 'The quick brown fox jumps over the lazy dog.';
const narrow = synthesize(SENTENCE, { seed: 1, tier: 'telephone' });
const wide = synthesize(SENTENCE, { seed: 1, ...REFERENCE });
const atEight = analyzeVoice(narrow.samples, narrow.sampleRate);
const reference = analyzeVoice(wide.samples, wide.sampleRate);
const referenceThree = analyzeVoice(wide.samples, wide.sampleRate, {
  formantCount: 3,
});
show('analysis telephone', {
  formants: atEight.formants.map(Math.round),
  f0: Number(atEight.f0.toFixed(1)),
  vocalTractLength: Number(atEight.vocalTractLength.toFixed(4)),
});
show('analysis reference', {
  formants: reference.formants.map(Math.round),
  f0: Number(reference.f0.toFixed(1)),
  vocalTractLength: Number(reference.vocalTractLength.toFixed(4)),
});
show('analysis reference formantCount 3', {
  formants: referenceThree.formants.map(Math.round),
  vocalTractLength: Number(referenceThree.vocalTractLength.toFixed(4)),
});
show('analysis differences', {
  f0: `${(100 * Math.abs(atEight.f0 / reference.f0 - 1)).toFixed(2)} %`,
  vocalTractLength: `${(
    100 *
    Math.abs(atEight.vocalTractLength / referenceThree.vocalTractLength - 1)
  ).toFixed(2)} %`,
});
