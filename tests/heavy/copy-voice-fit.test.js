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
import { voiceFitGates, voiceFitMarkdown } from './helpers/voice-fit-report.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
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
  const data = { synthetic, golden };
  writeReport('copy-voice-fit', voiceFitMarkdown(data), {
    ...data,
    gates: voiceFitGates(data),
  });
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
    const gates = voiceFitGates({ synthetic, golden: [] });
    for (const gate of gates) {
      console.log('voice fit gate', gate);
    }
    expect(gates.filter((gate) => !gate.passed)).toEqual([]);
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
        const preset = nearestPreset(fit.head, fit.preset).head;
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
