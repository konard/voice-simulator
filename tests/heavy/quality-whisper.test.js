/**
 * Heavy check (issue 53): the formants of whispered vowels in the 3D
 * solver (tier high) against the voiced ones, and the CLI command of the
 * issue at its default tier. Run with
 * `npm run test:heavy -- --suite quality`; writes
 * reports/heavy/whisper-formants.md and .json.
 *
 * The formants are one LPC fit over the middle 60 % of the vowel: a 40 ms
 * frame of a noise-excited [i] misses its weak F1 about half the time
 * (experiments/issue-53-whisper-tuning.mjs prints both measures).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { runCli } from '../../bin/voice-simulator.js';
import {
  decodeAudio,
  estimateFormants,
  synthesize,
  voicedShare,
} from '../../src/index.js';
import { writeReport } from './helpers/report.js';

const OPTIONS = { tier: 'high', seed: 1, ipa: true, headroom: 20 };

/** F1..F3 (Hz) of the vowel of a one-vowel utterance. */
function vowelFormants(text) {
  const result = synthesize(text, OPTIONS);
  const vowel = result.plan.segments.find((s) => s.kind === 'vowel');
  const length = vowel.end - vowel.start;
  return estimateFormants(result.samples, result.sampleRate, {
    start: vowel.start + 0.2 * length,
    duration: 0.6 * length,
    count: 3,
  });
}

describe('whispered vowels in 3D', () => {
  it('have a higher F1 and keep F2', () => {
    const rows = [];
    for (const vowel of ['a', 'i', 'u']) {
      const voiced = vowelFormants(`ˈ${vowel}`);
      const whispered = vowelFormants(`{W ˈ${vowel} W}`);
      rows.push({ vowel, voiced, whispered });
    }
    const table = rows.map(
      ({ vowel, voiced, whispered }) =>
        `| ${vowel} | ${voiced.map(Math.round).join(', ')} | ${whispered
          .map(Math.round)
          .join(', ')} | ${Math.round(whispered[0] - voiced[0])} |`
    );
    writeReport(
      'whisper-formants',
      [
        '| Vowel | Voiced F1–F3 (Hz) | Whispered F1–F3 (Hz) | F1 rise (Hz) |',
        '| --- | --- | --- | --- |',
        ...table,
        '',
      ].join('\n'),
      { tier: OPTIONS.tier, rows }
    );
    for (const { vowel, voiced, whispered } of rows) {
      for (const formants of [voiced, whispered]) {
        expect(formants.length >= 2).toBe(true);
        expect(formants.slice(0, 2).every(Number.isFinite)).toBe(true);
      }
      const rise = whispered[0] - voiced[0];
      expect(rise >= 100 && rise <= 400).toBe(true);
      if (vowel === 'i') {
        expect(whispered[1] > 1800).toBe(true);
      }
    }
  });
});

describe('whisper from the CLI', () => {
  it('has no voiced frames at the default tier', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'whisper-'));
    const file = path.join(folder, 'w.wav');
    try {
      const code = await runCli(
        ['say', '--markup', '[whisper]Hello.[/whisper]', '--out', file],
        { stdout: () => {}, stderr: () => {} }
      );
      expect(code).toBe(0);
      const { samples, sampleRate } = decodeAudio(readFileSync(file));
      expect(voicedShare(samples, sampleRate) < 0.05).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
