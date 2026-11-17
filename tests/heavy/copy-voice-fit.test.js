/** Full issue 63 gates and real-speaker report. Unlicense. */
import { describe, it, expect } from 'test-anywhere';
import {
  fitVoice,
  synthesize,
  createRandom,
  DEFAULT_HEAD,
} from '../../src/index.js';
import {
  nearestPreset,
  featureVector,
  vectorDistance,
  alignedMcd,
} from '../../src/analysis/voice-fit.js';
import {
  accumulate,
  emptyState,
} from '../../src/analysis/voice-fit-statistics.js';
import { loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const median = (x) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
const errors = (head, truth) =>
  Object.fromEntries(
    ['vocalTractLength', 'pitch', 'speechRate', 'tenseness', 'breathiness'].map(
      (key) => [
        key,
        Math.abs(head[key] - truth[key]) /
          (key === 'tenseness' || key === 'breathiness' ? 1 : truth[key]),
      ]
    )
  );
const synthetic = [],
  golden = [];
function render(text, head, lang) {
  return synthesize(text, {
    head,
    lang,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
}
function report() {
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
  const markdown = [
    '# Voice configuration fit (issue 63)',
    '',
    'Command: `npm run test:heavy -- --suite copy`. Seed 1, maxRenders 40.',
    'All fitted uncertainties are rough indicators, not confidence intervals.',
    'Golden transcripts and IPA retain their manifest review status. No audio is replayed.',
    '',
    '| Seed | Transcript | Tract error | Pitch error | Rate error | Tenseness error | Breathiness error | Tract 3 SD covers truth |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...synthetic.map(
      (r) =>
        `| ${r.seed} | ${r.transcript} | ${fmt(r.errors.vocalTractLength)} | ${fmt(r.errors.pitch)} | ${fmt(r.errors.speechRate)} | ${fmt(r.errors.tenseness)} | ${fmt(r.errors.breathiness)} | ${r.covered} |`
    ),
    '',
    '| Recording | Speaker | Sex | Transcript | Tract (cm ± SD) | Distance | Preset distance | MCD (dB) | Preset MCD (dB) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...golden.map(
      (r) =>
        `| ${r.id} | ${r.speaker.id} | ${r.speaker.sex} | ${r.transcript} | ${fmt(r.parameters.vocalTractLength.value)} ± ${fmt(r.parameters.vocalTractLength.sd)} | ${fmt(r.distance)} | ${fmt(r.presetDistance)} | ${fmt(r.mcd)} | ${fmt(r.presetMcd)} |`
    ),
    '',
    'All fitted values and SDs are in the JSON report. Plausibility reference:',
    'female tract 14–15 cm; male tract 16–18 cm. These are descriptive references, not gates.',
    'Ungated targets: distance at most half the preset for 80% of recordings;',
    'MCD at least 0.5 dB better than the preset.',
    `Measured half-distance share: ${fmt(golden.filter((r) => r.distance <= 0.5 * r.presetDistance).length / Math.max(1, golden.length))}.`,
    `Measured MCD improvement share: ${fmt(golden.filter((r) => r.presetMcd - r.mcd >= 0.5).length / Math.max(1, golden.length))}.`,
  ].join('\n');
  writeReport('copy-voice-fit', markdown, { synthetic, golden });
}
describe('voice copy fit', () => {
  it('recovers twenty seeded heads with and without transcripts', () => {
    for (let seed = 1; seed <= Math.min(20, heavyLimit(20)); seed++) {
      const random = createRandom(seed),
        range = (a, b) => a + (b - a) * random();
      const truth = {
        ...DEFAULT_HEAD,
        vocalTractLength: range(12, 19),
        pitch: range(90, 260),
        tenseness: range(0.3, 0.9),
        speechRate: range(0.8, 1.25),
        breathiness: range(0.1, 0.9),
      };
      const audio = render(TEXT, truth, 'en');
      for (const transcript of [true, false]) {
        const result = fitVoice(audio.samples, audio.sampleRate, {
          transcript: transcript ? TEXT : undefined,
          maxRenders: 40,
        });
        const p = result.parameters.vocalTractLength;
        const row = {
          seed,
          transcript,
          truth,
          head: result.head,
          parameters: result.parameters,
          errors: errors(result.head, truth),
          covered: Math.abs(p.value - truth.vocalTractLength) <= 3 * p.sd,
        };
        synthetic.push(row);
        console.log('voice fit synthetic', seed, transcript, row.errors);
        report();
      }
    }
    for (const transcript of [true, false]) {
      const rows = synthetic.filter((r) => r.transcript === transcript);
      for (const [key, gate] of Object.entries({
        vocalTractLength: transcript ? 0.04 : 0.06,
        pitch: 0.02,
        speechRate: 0.08,
        tenseness: 0.15,
        breathiness: 0.2,
      })) {
        const measured = median(rows.map((r) => r.errors[key]));
        console.log('voice fit gate', transcript, key, measured, gate);
        expect(measured <= gate).toBe(true);
      }
      expect(
        Math.max(...rows.map((r) => r.errors.vocalTractLength)) <= 0.1
      ).toBe(true);
      expect(
        rows.filter((r) => r.covered).length >= Math.ceil(rows.length * 0.8)
      ).toBe(true);
    }
  });
  it('fits every golden speaker at least as closely as its nearest preset', () => {
    for (const item of loadGolden().slice(0, heavyLimit(Infinity))) {
      for (const transcript of [true, false]) {
        const options = {
          language: item.lang,
          transcript: transcript ? item.text : undefined,
          maxRenders: 40,
        };
        const fit = fitVoice(item.samples, item.sampleRate, options);
        const preset = nearestPreset(fit.head).head;
        const before = render(
          transcript
            ? item.text
            : 'Please call Stella and ask her to bring these things with her.',
          preset,
          transcript ? item.lang : 'en'
        );
        const after = render(
          transcript
            ? item.text
            : 'Please call Stella and ask her to bring these things with her.',
          fit.head,
          transcript ? item.lang : 'en'
        );
        const target = featureVector(fit.state),
          candidate = featureVector(
            accumulate(emptyState(), before.samples, 16000)
          );
        const presetMcd = alignedMcd(item.samples, before.samples, 16000),
          mcd = alignedMcd(item.samples, after.samples, 16000);
        const presetDistance = vectorDistance(
          target,
          candidate,
          transcript,
          transcript ? presetMcd : null
        );
        const row = {
          id: item.id,
          speaker: item.speaker,
          review: item.review,
          transcript,
          parameters: fit.parameters,
          distance: fit.distance,
          presetDistance,
          mcd,
          presetMcd,
        };
        golden.push(row);
        console.log(
          'voice fit golden',
          row.id,
          transcript,
          row.distance,
          presetDistance
        );
        report();
      }
    }
    expect(golden.length > 0).toBe(true);
    for (const row of golden) {
      expect(row.distance <= row.presetDistance).toBe(true);
    }
  });
});
