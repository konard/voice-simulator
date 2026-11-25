#!/usr/bin/env node
/**
 * Recognition quality baseline in noise (issue 170): synthesizes fixed
 * round-trip sentences, lays each kind of noise over them at several
 * signal-to-noise ratios and scores the recognized words; then measures how
 * much text noise alone produces, with and without the speech gate.
 *
 *   node scripts/noise-baseline.mjs [--languages en,ru,hi,zh] [--sentences 2]
 *     [--types white,pink,...] [--snr 20,10,0] [--tier telephone]
 *     [--out docs/reports]
 *
 * Writes noise-baseline.md and noise-baseline.json to --out.
 * Unlicense.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import {
  addNoise,
  createNoise,
  createRecognizer,
  errorRate,
  levelForTier,
  NOISE_TYPES,
  recognize,
  synthesize,
} from '../src/index.js';

const { values } = parseArgs({
  options: {
    languages: { type: 'string', default: 'en,ru,hi,zh' },
    sentences: { type: 'string', default: '2' },
    types: { type: 'string', default: NOISE_TYPES.join(',') },
    snr: { type: 'string', default: '20,10,0' },
    tier: { type: 'string', default: 'telephone' },
    out: { type: 'string', default: 'docs/reports' },
  },
});

const languages = values.languages.split(',');
const types = values.types.split(',');
const ratios = values.snr.split(',').map(Number);
const count = Number(values.sentences);
const { tier } = values;
const level = levelForTier(tier);
const sentences = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/roundtrip/sentences.json', import.meta.url),
    'utf8'
  )
);

const percent = (value) => `${(100 * value).toFixed(1)}%`;
const mean = (list) => list.reduce((sum, x) => sum + x, 0) / list.length;

function score(lang, text, spoken, heard) {
  return {
    per: errorRate(spoken.ipa, heard.ipa, 'phone').rate,
    // Mandarin has no spaces between words: score its characters.
    wer: errorRate(text, heard.text, lang === 'zh' ? 'char' : 'word').rate,
  };
}

/** Streams samples in 128-sample chunks, like the app's audio worklet. */
function streamText(samples, sampleRate, options) {
  const recognizer = createRecognizer({ ...options, sampleRate });
  const texts = [];
  let error = null;
  recognizer.on('final', ({ text }) => texts.push(text));
  recognizer.on('error', (failure) => {
    error = failure.code ?? failure.message;
  });
  try {
    for (let i = 0; i < samples.length && !error; i += 128) {
      recognizer.push(samples.subarray(i, i + 128));
    }
    if (!error) {
      recognizer.flush();
    }
  } catch (failure) {
    error = failure.code ?? failure.message;
  }
  return { text: texts.join(' ').trim(), error };
}

function batchText(samples, sampleRate, options) {
  try {
    const result = recognize(samples, sampleRate, options);
    return { text: result.text, result, error: null };
  } catch (failure) {
    return { text: '', result: null, error: failure.code ?? failure.message };
  }
}

const started = performance.now();
const speech = [];
for (const lang of languages) {
  const options = { languages: [lang], level, modes: false };
  for (const [index, text] of sentences[lang].slice(0, count).entries()) {
    const spoken = synthesize(text, { lang, tier, seed: index + 1 });
    const { samples, sampleRate } = spoken;
    const run = (type, snr) => {
      const noisy =
        type === 'clean'
          ? samples
          : addNoise(samples, sampleRate, { type, snr, seed: index + 1 });
      const begin = performance.now();
      const {
        text: heard,
        result: answer,
        error,
      } = batchText(noisy, sampleRate, options);
      const seconds = (performance.now() - begin) / 1000;
      const result = error
        ? { per: 1, wer: 1 }
        : score(lang, text, spoken, answer);
      speech.push({ lang, index, type, snr, heard, error, seconds, ...result });
      console.log(
        `${lang} ${index} ${type} ${snr ?? ''}: ${error ?? JSON.stringify(heard)} WER ${percent(result.wer)} PER ${percent(result.per)}`
      );
    };
    run('clean', null);
    for (const type of types) {
      for (const snr of ratios) {
        run(type, snr);
      }
    }
  }
}

// Noise alone: three seconds at -40 dBFS, the level of a quiet room picked
// up by a phone microphone with automatic gain control off.
const silence = [];
const rate = 16000;
for (const type of types) {
  const noise = createNoise(type, 3 * rate, rate, { seed: 7, level: -40 });
  const options = { languages, level: 'low', modes: false };
  const entry = {
    type,
    stream: streamText(noise, rate, options),
    ungatedStream: streamText(noise, rate, { ...options, minVoiced: 0 }),
    batch: batchText(noise, rate, options),
    gatedBatch: batchText(noise, rate, { ...options, minVoiced: 0.1 }),
  };
  for (const key of ['batch', 'gatedBatch']) {
    delete entry[key].result;
  }
  silence.push(entry);
  console.log(`noise ${type}: ${JSON.stringify(entry)}`);
}

function speechTable(lang) {
  const header = ['Noise', ...ratios.map((snr) => `${snr} dB`)];
  const rows = [];
  const cell = (list) =>
    list.length
      ? `${percent(mean(list.map((r) => r.wer)))} / ${percent(mean(list.map((r) => r.per)))}`
      : '';
  const clean = speech.filter((r) => r.lang === lang && r.type === 'clean');
  rows.push(['clean', ...ratios.map(() => cell(clean))]);
  for (const type of types) {
    rows.push([
      type,
      ...ratios.map((snr) =>
        cell(
          speech.filter(
            (r) => r.lang === lang && r.type === type && r.snr === snr
          )
        )
      ),
    ]);
  }
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function shown({ text, error }) {
  const count = [...text.replace(/\s/g, '')].length;
  const chars = `${count} ${count === 1 ? 'char' : 'chars'}`;
  if (!error) {
    return chars;
  }
  return count ? `${chars}, then \`${error}\`` : `error \`${error}\``;
}
const unit = (lang) => (lang === 'zh' ? 'CER' : 'WER');
const noiseRow = (r) =>
  `| ${r.type} | ${shown(r.stream)} | ${shown(r.ungatedStream)} | ${shown(r.batch)} | ${shown(r.gatedBatch)} |`;
const markdown = `# Recognition in noise

Measured ${new Date().toISOString().slice(0, 10)} by
\`node scripts/noise-baseline.mjs --languages ${values.languages} --sentences ${count} --snr ${values.snr} --tier ${tier}\`
in ${((performance.now() - started) / 60000).toFixed(1)} minutes (issue 170).

Each of the first ${count} round-trip sentences per language
([tests/fixtures/roundtrip/sentences.json](../../tests/fixtures/roundtrip/sentences.json))
is synthesized at tier \`${tier}\` (seed = sentence number), mixed with
\`addNoise(samples, rate, { type, snr, seed })\` and read by
\`recognize(samples, rate, { languages: [lang], level: '${level}', modes: false })\`
with the default word decoder. The SNR is the RMS of the whole sentence over
the RMS of the noise. Cells are the mean ${languages.includes('zh') ? 'WER (CER for Mandarin)' : 'WER'}
and the mean phone error rate (PER). Since issue 170 the streaming recognizer
commits the same words as \`recognize()\`, so these rates also describe the
app's live recognition.

${languages.map((lang) => `## ${lang} (${unit(lang)} / PER)\n\n${speechTable(lang)}`).join('\n\n')}

## Noise without speech

Three seconds of each noise at -40 dBFS, 16 kHz, all of the languages
${languages.join(', ')}, level \`low\`. The stream uses its default speech gate
(\`minVoiced: 0.1\`: a phrase needs 0.1 s of pitch-voiced speech);
"ungated" sets \`minVoiced: 0\`, the behaviour before issue 170. Batch
\`recognize()\` keeps no gate by default. \`too-noisy\` is the error of a
steady noise with too little energy contrast.

| Noise | Stream | Stream, ungated | Batch | Batch, \`minVoiced: 0.1\` |
| --- | --- | --- | --- | --- |
${silence.map(noiseRow).join('\n')}

Recognition is trained on the simulator's own speech only (see
[RECOGNIZER.md](../RECOGNIZER.md)); these figures are a synthetic
baseline, not the accuracy for real voices.
`;

mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, 'noise-baseline.md'), markdown);
writeFileSync(
  join(values.out, 'noise-baseline.json'),
  `${JSON.stringify({ tier, level, languages, types, ratios, speech, silence }, null, 2)}\n`
);
console.log(`wrote ${join(values.out, 'noise-baseline.md')}`);
