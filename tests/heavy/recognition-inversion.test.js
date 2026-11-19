/** Synthetic-to-real generalization for acoustic inversion. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  analyzeFrames,
  articulationPlan,
  buildCodebook,
  fitVoice,
  invertArticulation,
  melCepstralDistortion,
  renderPlan,
} from '../../src/index.js';
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

function report(rows) {
  const mean = rows.reduce((sum, { mcd }) => sum + mcd, 0) / rows.length;
  const markdown = [
    '# Golden-set articulation render-back',
    '',
    'Each head is fitted on all available utterances by that speaker without a transcript, using pass 1 without its optional refinement. Inversion uses a 5,000-row codebook. The distortion uses the original and rendered signals on the same time grid.',
    '',
    '| Utterance | Language | Speaker | Reviewed | MCD (dB) |',
    '| --- | --- | --- | --- | ---: |',
    ...rows.map(
      ({ id, lang, speaker, reviewed, mcd }) =>
        `| ${id} | ${lang} | ${speaker} | ${reviewed ? 'yes' : 'pending'} | ${mcd.toFixed(3)} |`
    ),
    '',
    `Mean **${mean.toFixed(3)} dB** across ${rows.length} utterances. Research target 9 dB.`,
    '',
    'Reproduce with `node --test tests/heavy/recognition-inversion.test.js`.',
  ].join('\n');
  writeReport('recognition-inversion', markdown, { mean, rows });
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
    assert.ok(Number.isFinite(mcd));
    rows.push({
      id,
      lang,
      speaker: speaker.id,
      reviewed: isReviewed(item),
      mcd,
    });
    console.log('inversion golden', id, mcd);
    report(rows);
  }
  assert.equal(rows.length, selected.length);
});
