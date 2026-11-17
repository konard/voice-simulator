/** Issue 71: real recordings, downloaded MIT audio stays in .datasets. */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'test-anywhere';
import { decodeAudio, recognizeModes } from '../../src/index.js';
import { fetchDataset, readDataset } from '../../scripts/datasets.mjs';
import { loadGolden } from '../helpers/golden.js';
import { acousticIntervals, goldenWords } from '../helpers/mode-recordings.js';
import { heavyLimit, writeReport } from './helpers/report.js';

// RESD's seven labels -> simulator presets. Neutral has no emitted name.
const LABELS = Object.freeze({
  neutral: 'neutral',
  happiness: 'happy',
  sadness: 'sad',
  anger: 'angry',
  fear: 'afraid',
  disgust: 'disgusted',
  enthusiasm: 'surprised',
});
const SIGN = {
  neutral: 0,
  happy: 1,
  sad: -1,
  angry: 1,
  afraid: 1,
  disgusted: -1,
  surprised: 1,
};
const floors = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/reports/recognition-modes-baseline.json',
      import.meta.url
    ),
    'utf8'
  )
);
const rows = [],
  golden = [];

describe('real-recording mode recognition', () => {
  it('measures the first 100 RESD test rows', async () => {
    const count = Math.min(100, heavyLimit(100));
    await fetchDataset('resd-ru', { limit: count });
    const items = readDataset('resd-ru').slice(0, count);
    expect(items.length).toBe(count);
    for (const item of items) {
      const audio = decodeAudio(new Uint8Array(readFileSync(item.audioPath)));
      const truth = LABELS[item.text];
      if (!truth) {
        throw new Error(`Unmapped RESD label: ${item.text}`);
      }
      const input = {
        ...acousticIntervals(audio.samples, audio.sampleRate),
        language: 'ru',
      };
      const result = recognizeModes(audio.samples, audio.sampleRate, input, {
        voice: 'male',
      });
      const emotion = result.modes.find((s) => s.emotion)?.emotion;
      const actual = emotion?.name ?? 'neutral';
      const arousal = emotion?.arousal ?? 0;
      const activation =
        SIGN[truth] === 0 ? Math.abs(arousal) < 0.3 : arousal * SIGN[truth] > 0;
      rows.push({
        id: item.id,
        expected: truth,
        actual,
        arousal,
        activation,
        correct: actual === truth,
      });
    }
  });
  it('measures false alarms on all 24 golden sentences', () => {
    for (const item of loadGolden().slice(0, heavyLimit(24))) {
      const result = recognizeModes(item.samples, item.sampleRate, {
        words: goldenWords(item),
        ipa: item.ipa,
        language: item.lang,
      });
      const alarms = result.modes.filter(
        (s) => s.emotion || s.phonation?.whisper > 0
      );
      golden.push({ id: item.id, alarms });
    }
  });
  it('writes the measured report and enforces the initial ratchet', () => {
    const activation = rows.filter((r) => r.activation).length / rows.length;
    const names = rows.filter((r) => r.correct).length / rows.length;
    const falseAlarms = golden.filter((r) => r.alarms.length).length;
    const summary = {
      rows: rows.length,
      activation,
      names,
      golden: golden.length,
      falseAlarms,
    };
    const markdown = `# Speech-mode recognition measurements\n\nCommand: \`node --test --test-timeout=600000 tests/heavy/recognition-modes.test.js\`.\n\nRESD (Aniemore/resd, MIT metadata): first ${rows.length} rows of the test split.\nActivation accuracy: ${(activation * 100).toFixed(1)}%. Name accuracy: ${(names * 100).toFixed(1)}%.\nGolden false alarms (whisper or emotion): ${falseAlarms}/${golden.length}.\n\nThe committed baseline records the first complete measurement; gates are\nfive percentage points below it. Limited runs do not establish a new baseline.\n\nRESD has no transcripts. Its evaluation uses vowel-like periodic intervals\n(40–250 ms), not a speech-to-text system, and the generic male voice baseline.\nThe seven-label mapping is ${JSON.stringify(LABELS)}. Enthusiasm maps to\nsurprised as an activation proxy; no semantic valence inference is made.\nThe golden set uses its annotated IPA with proportional neutral phone timing,\nwithout a fitted speaker voice. These alignment and voice limitations apply\nto the reported figures; they are not an end-to-end recognition benchmark.\n\nPer-recording decisions are in the JSON artifact.\n`;
    writeReport('recognition-modes', markdown, {
      summary,
      rows,
      golden,
      labels: LABELS,
    });
    console.log(JSON.stringify(summary));
    expect(rows.length).toBeGreaterThan(0);
    expect(activation >= floors.activation).toBe(true);
    expect(names >= floors.names).toBe(true);
    expect(falseAlarms <= 1).toBe(true);
  });
});
