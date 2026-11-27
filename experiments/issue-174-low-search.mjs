/** Compare low word searches on sampled synthetic and natural speech. Unlicense. */
import { cpuUsage } from 'node:process';
import { resample } from '../src/audio/resample.js';
import { recognize, synthesize } from '../src/index.js';
import { HMM_LOW_SEARCH } from '../src/recognition/hmm-decode.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';
import {
  BENCHMARK,
  loadBenchmark,
  prepareReference,
  scoreUtterance,
} from '../tests/heavy/helpers/benchmark.js';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';

const rate = 8000;
const [sampleCount = '3', ...options] = process.argv.slice(2);
const count = Number(sampleCount);
const candidates = options.map((candidate) => {
  const [beam, languageBeam, maxActive] = candidate.split(',').map(Number);
  return [candidate, { beam, languageBeam, maxActive }];
});
const learn = (search) => (samples, sampleRate, options) =>
  recognize(samples, sampleRate, {
    ...options,
    stages: {
      audioToIpa: (input, inputRate, settings) =>
        hmmAudioToIpa(input, inputRate, { ...settings, search }),
    },
  });
const pool = (errors) =>
  errors.reduce((sum, error) => sum + (error.distance ?? error.errors), 0) /
  errors.reduce(
    (sum, error) => sum + (error.referenceLength ?? error.length),
    0
  );

const synthetic = Object.entries(sentences).flatMap(([lang, texts]) =>
  texts.slice(0, count).flatMap((text) =>
    ['male', 'female'].map((preset) => {
      const settings = {
        lang,
        tier: 'telephone',
        head: 'random',
        preset,
        seed: 1,
      };
      return { text, settings, spoken: synthesize(text, settings) };
    })
  )
);
const natural = (
  await Promise.all(
    BENCHMARK.sets.map((set) => loadBenchmark({ set, limit: count }))
  )
).flatMap((rows) =>
  rows.flatMap((row) => {
    const reference = prepareReference(row, row.language);
    return reference
      ? [
          {
            row,
            reference,
            samples: resample(row.samples, row.sampleRate, rate),
          },
        ]
      : [];
  })
);
learn(HMM_LOW_SEARCH)(synthetic[0].spoken.samples, rate, { level: 'low' });

for (const [name, search] of [['low', HMM_LOW_SEARCH], ...candidates]) {
  const recognize = learn(search);
  const errors = {};
  const start = cpuUsage();
  for (const { text, settings, spoken } of synthetic) {
    const { lang } = settings;
    const scored = roundTrip(text, { ...settings, spoken, recognize });
    (errors[lang] ??= []).push(lang === 'zh' ? scored.cer : scored.wer);
  }
  const synthCpu = cpuUsage(start);
  const synthSeconds = synthetic.reduce(
    (sum, { spoken }) => sum + spoken.samples.length / rate,
    0
  );
  const naturalStart = cpuUsage();
  const scores = natural.map(({ row, samples, reference }) =>
    scoreUtterance(
      row,
      recognize(samples, rate, { level: 'low' }),
      row.language,
      { reference }
    )
  );
  const naturalCpu = cpuUsage(naturalStart);
  const naturalSeconds = natural.reduce(
    (sum, { samples }) => sum + samples.length / rate,
    0
  );
  console.log(
    JSON.stringify({
      name,
      synthesis: {
        wer: pool(Object.values(errors).flat()),
        byLanguage: Object.fromEntries(
          Object.entries(errors).map(([lang, values]) => [lang, pool(values)])
        ),
        rtf: ((synthCpu.user + synthCpu.system) * 1e-6) / synthSeconds,
      },
      recognition: {
        per: pool(scores.map((value) => value.per)),
        wer: pool(scores.map((value) => value.wer ?? value.cer)),
        rtf: ((naturalCpu.user + naturalCpu.system) * 1e-6) / naturalSeconds,
      },
    })
  );
}
