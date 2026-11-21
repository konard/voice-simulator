/** The optional oral response table preserves generated codebooks. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { generateOralFeatureRows } from '../scripts/build-recognition-codebook.mjs';
import {
  buildCodebook,
  serializeCodebook,
} from '../src/recognition/codebook.js';
import {
  installOralCodebookReader,
  openOralFeatureRows,
} from '../src/recognition/codebook-data.js';
import { codebookSeeds } from '../src/recognition/codebook-seeds.js';

it('loads equivalent oral rows and computes custom geometry directly', () => {
  const referenceLength = 16.5;
  const fittedVoice = {
    vocalTractLength: 16.43,
    pitch: 150,
    tenseness: 0.41,
    breathiness: 0.24,
    speechRate: 0.94,
  };
  const customVoice = { ...fittedVoice, oralWidth: 1.2 };
  const build = (voice) =>
    serializeCodebook(buildCodebook(voice, { size: 256, cache: new Map() }));
  const expected = build(fittedVoice);
  const expectedCustom = build(customVoice);
  const bytes = generateOralFeatureRows(
    referenceLength,
    codebookSeeds().map(({ state }) => state)
  );
  const read = openOralFeatureRows(bytes);
  let hits = 0;
  installOralCodebookReader((length) => {
    assert.equal(length, referenceLength);
    return (index, envelope, formants) => {
      const found = read(index, envelope, formants);
      hits += Number(found);
      return found;
    };
  });
  try {
    assert.deepEqual(build(fittedVoice), expected);
    assert.ok(hits > 100);
    hits = 0;
    assert.deepEqual(build(customVoice), expectedCustom);
    assert.equal(hits, 0);
  } finally {
    installOralCodebookReader(undefined);
  }
});
