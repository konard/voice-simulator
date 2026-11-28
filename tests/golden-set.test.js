/**
 * Tests for the golden set of tests/fixtures/golden/ (issue 17): 24 short
 * public-domain LibriVox sentences (6 each of English, Russian, Hindi and
 * Mandarin) with text and hand-written IPA, and scripts/golden.mjs, which
 * cut them and checks them. Every check runs on the committed files and on
 * a broken copy of the manifest, so a check that never fails is noticed.
 */

import { describe, expect, it } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  audioProblems,
  countUnits,
  countWords,
  cutUtterance,
  fileProblems,
  findPauses,
  GOLDEN_DIR,
  ipaProblems,
  LANGUAGES,
  licenceProblems,
  loadManifest,
  main,
  manifestProblems,
  MAX_TOTAL_BYTES,
  PEAK,
  peakOf,
  sizeProblems,
  textProblems,
  textWords,
} from '../scripts/golden.mjs';
import { loadRegistry } from '../scripts/datasets.mjs';
import { decodeFlac } from '../src/audio/flac.js';
import { encodeWav } from '../src/audio/wav.js';
import { parseIpa } from '../src/ipa/parse.js';
import { goldenRecordings, isReviewed, loadGolden } from './helpers/golden.js';
import { itUnless, sandboxed } from './helpers/skip.js';

const manifest = loadManifest();
const copy = () => JSON.parse(JSON.stringify(manifest));
const first = (value) => value.utterances[0];
const SR = 16000;

/** A tone of `seconds` at `amplitude`, then `gap` seconds of silence, twice. */
function toneGapTone(seconds, gap, amplitude = 0.3) {
  const length = Math.round((2 * seconds + gap) * SR);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    const inGap = t >= seconds && t < seconds + gap;
    samples[i] = inGap ? 0 : amplitude * Math.sin(2 * Math.PI * 220 * t);
  }
  return samples;
}

it('reads the same golden recordings in manifest order with reusable storage', async () => {
  const options = { lang: 'en', limit: 2 };
  const expected = loadGolden(options);
  const storage = new Float32Array(
    Math.max(...expected.map(({ samples }) => samples.length))
  );
  let i = 0;
  for await (const item of goldenRecordings({
    ...options,
    storage: (length) => storage.subarray(0, length),
  })) {
    expect(item.samples.buffer).toBe(storage.buffer);
    expect(item).toEqual(expected[i++]);
  }
  expect(i).toBe(expected.length);
});

describe('golden set', () => {
  it('manifest is complete', () => {
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest.tool).toBe('ffmpeg 7.0.2');
    for (const lang of LANGUAGES) {
      expect(manifest.utterances.filter((u) => u.lang === lang).length).toBe(6);
    }
    // No agent may confirm a review: everything starts unreviewed.
    for (const item of manifest.utterances) {
      expect(item.review).toEqual({
        text: 'unreviewed',
        ipa: 'unreviewed',
        by: null,
      });
      expect(item.speaker.sex).toBe('unknown');
    }
    const broken = copy();
    delete first(broken).speaker;
    first(broken).review = { text: 'confirmed', ipa: 'unreviewed', by: null };
    broken.utterances[1].id = 'en-1';
    const problems = manifestProblems(broken).join('\n');
    expect(problems).toContain('en-01: speaker must be an object');
    expect(problems).toContain('review.by must be the GitHub name');
    expect(problems).toContain('id must match');
  });

  it('files match the manifest', () => {
    expect(fileProblems(manifest)).toEqual([]);
    const broken = copy();
    first(broken).sha256 = '0'.repeat(64);
    broken.utterances.pop();
    const problems = fileProblems(broken).join('\n');
    expect(problems).toContain('en-01: the SHA-256 of en-01.flac');
    expect(problems).toContain('zh-06.flac: not listed in manifest.json');
  });

  it('audio format', () => {
    expect(audioProblems(manifest)).toEqual([]);
    const { sampleRate, channels, bitDepth } = decodeFlac(
      new Uint8Array(readFileSync(path.join(GOLDEN_DIR, 'hi-01.flac')))
    );
    expect([sampleRate, channels, bitDepth]).toEqual([16000, 1, 16]);
    const broken = copy();
    first(broken).duration += 0.5;
    expect(audioProblems(broken).join('\n')).toContain(
      'en-01: lasts 3.115 s, manifest says 3.615'
    );
  });

  it('size limit', () => {
    expect(sizeProblems(manifest)).toEqual([]);
    const total = manifest.utterances
      .map((item) => readFileSync(path.join(GOLDEN_DIR, item.file)).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(MAX_TOTAL_BYTES).toBe(2000000);
  });

  it('licences', () => {
    const registry = loadRegistry();
    expect(licenceProblems(manifest, registry)).toEqual([]);
    const broken = copy();
    first(broken).source.licence = 'CC-BY-4.0';
    broken.utterances[1].source.dataset = 'common-voice';
    const problems = licenceProblems(broken, registry).join('\n');
    expect(problems).toContain('en-01: source.licence "CC-BY-4.0" is not');
    expect(problems).toContain('"common-voice" is not in');
    const noRedistribution = {
      datasets: registry.datasets.map((entry) => ({
        ...entry,
        redistribution: false,
      })),
    };
    expect(licenceProblems(manifest, noRedistribution).length).toBe(24);
  });

  it('text is plausible', () => {
    expect(textProblems(manifest)).toEqual([]);
    expect(countUnits('Persuasion is better than force.', 'en')).toBe(9);
    expect(countUnits('Старый больной лев', 'ru')).toBe(5);
    expect(countUnits('ईश्वर को', 'hi')).toBe(4);
    expect(countUnits('读书法，有三到', 'zh')).toBe(6);
    const broken = copy();
    first(broken).duration = 10;
    broken.utterances[1].text = 'It cost 5 pence.';
    const problems = textProblems(broken).join('\n');
    expect(problems).toContain('en-01: 9 units in 10 s is 0.90 per second');
    expect(problems).toContain('en-02: 3 words, not 5 to 16');
    expect(problems).toContain('en-02: text has a digit');
  });

  it('ipa is readable', () => {
    expect(ipaProblems(manifest)).toEqual([]);
    for (const item of manifest.utterances) {
      expect(parseIpa(item.ipa).unknown).toEqual([]);
      const han = (item.text.match(/\p{Script=Han}/gu) ?? []).length;
      expect(countWords(item.ipa)).toBe(
        item.lang === 'zh' ? han : countWords(item.text)
      );
      expect(textWords(item.text, item.lang)).toBe(countWords(item.ipa));
    }
    const broken = copy();
    first(broken).ipa = 'pɚˈsweɪʒən ɪz ˈbɛɾɚ ðən';
    broken.utterances[1].ipa += ' Ж';
    const problems = ipaProblems(broken).join('\n');
    expect(problems).toContain('en-01: the IPA has 4 words, the text 5');
    expect(problems).toContain('en-02: unknown IPA symbols Ж');
  });

  it('findPauses finds a gap', () => {
    // A 1 s tone, 0.4 s of silence and a 1 s tone: one pause, 1.0 to 1.4 s.
    const pauses = findPauses(toneGapTone(1, 0.4), SR);
    expect(pauses.length).toBe(1);
    expect(Math.abs(pauses[0].start - 1)).toBeLessThan(0.02);
    expect(Math.abs(pauses[0].end - 1.4)).toBeLessThan(0.02);
    // A gap shorter than --min is not a pause.
    expect(findPauses(toneGapTone(0.5, 0.1), SR)).toEqual([]);
    expect(findPauses(toneGapTone(0.5, 0.1), SR, { min: 0.05 }).length).toBe(1);
  });

  it('cutUtterance fades and scales', () => {
    const samples = toneGapTone(1, 0, 0.2);
    const cut = cutUtterance(samples, SR, 0.25, 1.25);
    expect(cut.length).toBe(16000);
    expect(cut[0]).toBe(0);
    expect(cut[cut.length - 1]).toBe(0);
    expect(Math.abs(peakOf(cut) - 0.708)).toBeLessThan(0.001);
    expect(PEAK).toBe(0.708);
    // The fade is 10 ms: sample 80 of 160 is scaled by half.
    const scale = PEAK / peakOf(samples.subarray(4000, 20000));
    expect(Math.abs(cut[80] - 0.5 * samples[4080] * scale)).toBeLessThan(1e-6);
    expect(Math.abs(cut[400] - samples[4400] * scale)).toBeLessThan(1e-6);
    expect(() => cutUtterance(new Float32Array(SR), SR, 0, 0.5)).toThrow();
  });
});

describe('golden helper and command line', () => {
  it('loadGolden decodes the files of one language', () => {
    const items = loadGolden({ lang: 'ru' });
    expect(items.map((item) => item.id)).toEqual([
      'ru-01',
      'ru-02',
      'ru-03',
      'ru-04',
      'ru-05',
      'ru-06',
    ]);
    for (const item of items) {
      expect(item.sampleRate).toBe(16000);
      expect(Object.keys(item).sort()).toEqual([
        'id',
        'ipa',
        'lang',
        'review',
        'sampleRate',
        'samples',
        'speaker',
        'text',
      ]);
    }
    expect(loadGolden().length).toBe(24);
    // Nothing is confirmed by a person yet.
    expect(loadGolden({ reviewedOnly: true })).toEqual([]);
    expect(
      isReviewed({ review: { text: 'confirmed', ipa: 'confirmed', by: 'x' } })
    ).toBe(true);
  });

  it('verify exits 0 and prints nothing', () => {
    const lines = [];
    const out = { log: (l) => lines.push(l), error: (l) => lines.push(l) };
    expect(main(['verify'], out)).toBe(0);
    expect(lines).toEqual([]);
    expect(main(['frobnicate'], out)).toBe(2);
    expect(main(['--help'], out)).toBe(0);
  });

  itUnless(sandboxed)('cut writes a FLAC that pauses can read back', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'golden-'));
    try {
      const wav = path.join(dir, 'source.wav');
      writeFileSync(wav, encodeWav(toneGapTone(1.2, 0.5), SR));
      const lines = [];
      const out = { log: (l) => lines.push(l), error: (l) => lines.push(l) };
      const argv = ['cut', '--source', wav, '--start', '0.2', '--end', '2.6'];
      expect(main([...argv, '--id', 'en-01', '--dir', dir], out)).toBe(0);
      expect(lines[0]).toMatch(/^en-01 2\.400 s \d+ bytes [0-9a-f]{64}$/);
      const flac = decodeFlac(
        new Uint8Array(readFileSync(path.join(dir, 'en-01.flac')))
      );
      expect(flac.samples.length).toBe(2.4 * SR);
      lines.length = 0;
      expect(main(['pauses', wav], out)).toBe(0);
      expect(lines).toEqual(['1.200 1.700']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
