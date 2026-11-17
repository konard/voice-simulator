/**
 * Heavy check (issue 60): the formant tracker of the recognizer on the
 * golden set of real speech (tests/fixtures/golden/, issue 17). Per
 * utterance, over the voiced speech frames (speech in the frame set, f0
 * above 0 in trackPitch): the share of frames with F1, F2 and F3 all valid
 * (target 95 %) and the share of steps between adjacent voiced frames with
 * F2 valid on both sides where F2 jumps by more than 300 Hz (target below
 * 2 %). Targets to be measured, not gates. The golden set has no formant
 * reference; the VTR database of hand-checked formants (Deng et al. 2006)
 * is refused by the licence policy of docs/CONTRIBUTING.md
 * (datasets/refused.json), so no error per formant is reported. Run with
 * `npm run test:heavy -- --suite recognition`; HEAVY_LIMIT limits the
 * utterances per language.
 */

import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'test-anywhere';
import { analyzeFrames, trackFormants, trackPitch } from '../../src/index.js';
import { loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const LANGUAGES = Object.freeze(['en', 'ru', 'hi', 'zh']);
/** Targets of issue 60 (shares, not gates). */
const VALID_TARGET = 0.95;
const JUMP_TARGET = 0.02;
/** An F2 step above this (Hz) between adjacent frames is a jump. */
const JUMP_HZ = 300;
const VTR_URL = 'https://www.seas.ucla.edu/spapl/VTRFormants.html';

const limit = heavyLimit(Infinity);
const refused = JSON.parse(
  readFileSync(new URL('../../datasets/refused.json', import.meta.url), 'utf8')
);
const vtr = refused.find((item) => item.url === VTR_URL) ?? null;

/** Counts of one utterance: voiced frames, of them valid, F2 steps, jumps. */
function measure(item) {
  const frames = analyzeFrames(item.samples, item.sampleRate);
  const pitch = trackPitch(frames);
  const track = trackFormants(frames, { pitch });
  let voiced = 0;
  let valid = 0;
  let steps = 0;
  let jumps = 0;
  let previous = NaN;
  for (let t = 0; t < track.count; t++) {
    if (!(frames.speech[t] === 1 && pitch.f0[t] > 0)) {
      previous = NaN;
      continue;
    }
    voiced += 1;
    const base = t * 4;
    if (track.valid[base] && track.valid[base + 1] && track.valid[base + 2]) {
      valid += 1;
    }
    const f2 = track.valid[base + 1] ? track.frequency[base + 1] : NaN;
    if (Number.isFinite(f2) && Number.isFinite(previous)) {
      steps += 1;
      jumps += Math.abs(f2 - previous) > JUMP_HZ ? 1 : 0;
    }
    previous = f2;
  }
  return {
    id: item.id,
    lang: item.lang,
    rate: frames.rate,
    vocalTractLength: Number(track.vocalTractLength.toFixed(2)),
    voiced,
    valid,
    steps,
    jumps,
  };
}

/** Shares of a list of counts. */
function shares(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const voiced = sum('voiced');
  const steps = sum('steps');
  return {
    utterances: rows.length,
    voiced,
    validShare: voiced > 0 ? sum('valid') / voiced : null,
    steps,
    jumpShare: steps > 0 ? sum('jumps') / steps : null,
  };
}

const percent = (value) =>
  value === null ? 'n/a' : `${(100 * value).toFixed(1)} %`;

const rows = [];

describe('recognition formants on the golden set', () => {
  for (const lang of LANGUAGES) {
    it(`tracks the formants of the ${lang} utterances`, () => {
      const items = loadGolden({ lang }).slice(0, limit);
      for (const item of items) {
        const row = measure(item);
        console.error(
          `formants golden ${row.id}: voiced ${row.voiced} valid ` +
            `${percent(row.valid / row.voiced)} F2 jumps ` +
            `${percent(row.jumps / row.steps)} L ${row.vocalTractLength}`
        );
        expect(row.voiced).toBeGreaterThan(0);
        expect(row.valid <= row.voiced).toBe(true);
        rows.push(row);
      }
    });
  }

  it('writes the report', () => {
    expect(rows.length).toBeGreaterThan(0);
    const total = shares(rows);
    const byLanguage = LANGUAGES.map((lang) => ({
      lang,
      ...shares(rows.filter((row) => row.lang === lang)),
    })).filter((entry) => entry.utterances > 0);
    const met = (value, ok) => (value === null ? 'n/a' : ok ? 'yes' : 'no');
    const markdown = [
      '## Formant tracker on the golden set (issue 60)',
      '',
      '`trackFormants` (tract length estimated, f0 of `trackPitch`) on the',
      'golden recordings of tests/fixtures/golden/, over the voiced speech',
      'frames (speech in the frame set, f0 above 0). Valid: F1, F2 and F3',
      `all valid (target ${percent(VALID_TARGET)}). F2 jumps: steps between`,
      'adjacent voiced frames with F2 valid on both sides where F2 moves by',
      `more than ${JUMP_HZ} Hz (target below ${percent(JUMP_TARGET)}).`,
      'Targets to be measured, not gates. Command:',
      '`npm run test:heavy -- --suite recognition`.',
      '',
      '| Language | Utterances | Voiced frames | Valid | F2 steps | F2 jumps |',
      '| -------- | ---------- | ------------- | ----- | -------- | -------- |',
      ...[...byLanguage, { lang: 'all', ...total }].map(
        (entry) =>
          `| ${entry.lang} | ${entry.utterances} | ${entry.voiced} | ` +
          `${percent(entry.validShare)} | ${entry.steps} | ` +
          `${percent(entry.jumpShare)} |`
      ),
      '',
      `Valid target met: ${met(total.validShare, total.validShare >= VALID_TARGET)}.`,
      `F2 jump target met: ${met(total.jumpShare, total.jumpShare < JUMP_TARGET)}.`,
      '',
      '| Utterance | Rate (Hz) | Tract length (cm) | Voiced frames | Valid | F2 jumps |',
      '| --------- | --------- | ----------------- | ------------- | ----- | -------- |',
      ...rows.map(
        (row) =>
          `| ${row.id} | ${row.rate} | ${row.vocalTractLength} | ` +
          `${row.voiced} | ${percent(row.valid / row.voiced)} | ` +
          `${percent(row.steps > 0 ? row.jumps / row.steps : null)} |`
      ),
      '',
      'The golden set has no formant reference, so the error per formant is',
      `not measured. The [VTR Formants Database](${VTR_URL}) (Deng et`,
      'al. 2006) of hand-checked formants is refused by the licence policy',
      `of docs/CONTRIBUTING.md (datasets/refused.json): ${vtr?.licence};`,
      `${vtr?.reason}.`,
      '',
    ].join('\n');
    writeReport('recognition-formants', markdown, {
      targets: { valid: VALID_TARGET, jumps: JUMP_TARGET, jumpHz: JUMP_HZ },
      total,
      byLanguage,
      rows,
      vtr,
    });
    expect(vtr).not.toBe(null);
    expect(total.validShare >= 0 && total.validShare <= 1).toBe(true);
    expect(total.jumpShare >= 0 && total.jumpShare <= 1).toBe(true);
  });
});
