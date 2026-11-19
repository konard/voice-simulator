/** Synthetic-to-real generalization for acoustic inversion. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  analyzeFrames,
  articulationPlan,
  buildCodebook,
  constantCepstrumDistortion,
  fitVoice,
  invertArticulation,
  melCepstralDistortion,
  renderPlan,
} from '../../src/index.js';
import { checkBlockedGate } from '../helpers/blocked-gate.js';
import { isReviewed, loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';

function joinedSpeech(items) {
  const silence = Math.round(0.25 * items[0].sampleRate);
  const length = items.reduce((sum, item) => sum + item.samples.length, 0);
  const samples = new Float32Array(length + silence * (items.length - 1));
  let at = 0;
  for (const item of items) {
    samples.set(item.samples, at);
    at += item.samples.length + silence;
  }
  return samples;
}

/** Research target of the golden-set render-back MCD (issue 150). */
const TARGET_DB = 9;

function mean(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

function summary(rows) {
  const mcd = mean(rows, 'mcd');
  return {
    target: TARGET_DB,
    mean: mcd,
    gap: mcd - TARGET_DB,
    constant: mean(rows, 'constant'),
    belowConstant: rows.filter((row) => row.mcd < row.constant).length,
    belowTarget: rows.filter((row) => row.mcd <= TARGET_DB).length,
    count: rows.length,
  };
}

function report(rows) {
  const totals = summary(rows);
  const markdown = [
    '# Golden-set articulation render-back',
    '',
    'Each head is fitted on all available utterances by that speaker without a transcript, using pass 1 without its optional refinement. Inversion uses a 5,000-row codebook. The distortion uses the original and rendered signals on the same time grid.',
    '',
    `The research target is ${TARGET_DB} dB ([issue 150](https://github.com/konard/voice-simulator/issues/150)). *Gap* is the MCD minus the target. *Constant* is the MCD of the recording from its own mean cepstrum (\`constantCepstrumDistortion\`): the score of a render whose spectrum never changes but has the mean shape of the recording. A render-back above it has not followed the spectral changes of the recording.`,
    '',
    '| Utterance | Language | Speaker | Reviewed | MCD (dB) | Gap (dB) | Constant (dB) |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
    ...rows.map(
      ({ id, lang, speaker, reviewed, mcd, constant }) =>
        `| ${id} | ${lang} | ${speaker} | ${reviewed ? 'yes' : 'pending'} | ${mcd.toFixed(3)} | ${(mcd - TARGET_DB).toFixed(3)} | ${constant.toFixed(3)} |`
    ),
    '',
    `Mean **${totals.mean.toFixed(3)} dB** across ${totals.count} utterances: ${totals.gap.toFixed(3)} dB above the ${TARGET_DB} dB research target, ${totals.belowTarget} of ${totals.count} utterances at or below it. The constant-spectrum reference averages ${totals.constant.toFixed(3)} dB; ${totals.belowConstant} of ${totals.count} render-backs are below their reference.`,
    '',
    `This cepstrum is the orthonormal DCT of the natural logarithm of 26 mel filter powers. Its coefficients are about 2 sqrt(2 × 26) ≈ 14 times the cepstral coefficients of the log amplitude spectrum that conventional mel-cepstral distortion uses. A ±3 dB linear spectral tilt measures 11.3 dB here and 0.87 dB conventionally (\`node experiments/issue-150-metric-scale.mjs\`). See [the issue 150 case study](https://github.com/konard/voice-simulator/blob/main/docs/case-studies/issue-150/README.md).`,
    '',
    'Reproduce with `node --test tests/heavy/recognition-inversion.test.js`.',
  ].join('\n');
  writeReport('recognition-inversion', markdown, { ...totals, rows });
  return totals;
}

it('fits golden speakers and measures every render-back', () => {
  const items = loadGolden();
  const selected = items.slice(0, heavyLimit(Infinity));
  const rows = [];
  let previousSpeaker;
  let head;
  let codebook;
  for (const item of [...selected].sort((a, b) =>
    a.speaker.id.localeCompare(b.speaker.id)
  )) {
    const { id, lang, samples, sampleRate, speaker } = item;
    if (previousSpeaker !== speaker.id) {
      const speakerItems = items.filter(
        (other) => other.speaker.id === speaker.id
      );
      head = fitVoice(joinedSpeech(speakerItems), sampleRate, {
        language: lang,
        refine: false,
      }).head;
      codebook = buildCodebook(head, { size: 5000, cache: new Map() });
      previousSpeaker = speaker.id;
    }
    const track = invertArticulation(analyzeFrames(samples, sampleRate), {
      voice: head,
      codebook,
    });
    const rendered = renderPlan(articulationPlan(track), {
      sampleRate,
      solver: 'waveguide',
      engine: 'js',
      seed: 1,
    });
    const mcd = melCepstralDistortion(samples, rendered, sampleRate);
    const constant = constantCepstrumDistortion(samples, sampleRate);
    assert.ok(Number.isFinite(mcd));
    rows.push({
      id,
      lang,
      speaker: speaker.id,
      reviewed: isReviewed(item),
      mcd,
      constant,
    });
    console.log('inversion golden', id, mcd, 'constant', constant);
    report(rows);
  }
  assert.equal(rows.length, selected.length);
  const totals = summary(rows);
  checkBlockedGate({
    criterion: `golden-set render-back MCD at most ${TARGET_DB} dB (issue 150)`,
    passed: totals.mean <= TARGET_DB,
    measured:
      `mean ${totals.mean.toFixed(3)} dB over ${totals.count} utterances, ` +
      `${totals.gap.toFixed(3)} dB above the target; a constant spectrum ` +
      `scores ${totals.constant.toFixed(3)} dB`,
    action:
      'the issue author decides whether the 9 dB target applies to this ' +
      'metric scale (about 13 times conventional MCD, ' +
      'docs/case-studies/issue-150) or to a conventional MCD, and which ' +
      'model change (rendered-template codebook, source model) to fund',
  });
});
