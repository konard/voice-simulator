/** Compare golden IPA accuracy using different inversion codebooks. Unlicense. */
import {
  buildCodebook,
  errorRate,
  invertArticulation,
  parseIpa,
} from '../src/index.js';
import { phoneClass } from '../src/recognition/decode-model.js';
import {
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { goldenCases } from './issue-153-golden.mjs';

const size = Number(process.argv[2] ?? 1024);
const options = [{ candidates: 16 }, { candidates: 32 }];
const totals = options.map(() => ({ phone: 0, broad: 0, count: 0 }));

function phones(ipa) {
  return parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
}

let currentSpeaker;
let codebook;
for (const { speaker, ipa, analysis, settings } of goldenCases(
  process.argv[3]
)) {
  const { voice, frames, tracks } = analysis;
  if (speaker !== currentSpeaker) {
    codebook = buildCodebook(voice, { size, cache: new Map() });
    currentSpeaker = speaker;
    console.log('codebook', speaker, size);
  }
  const reference = phones(ipa);
  for (const [i, option] of options.entries()) {
    const articulation = invertArticulation(frames, {
      voice,
      codebook,
      pitch: tracks.pitch,
      formants: tracks.formants,
      ...option,
    });
    const updated = { ...analysis, tracks: { ...tracks, articulation } };
    const { prepared, templates } = prepareIpaDecode(updated, settings);
    const search = decodeSearch(prepared, settings.language, {
      ...settings,
      lattice: false,
    });
    const decoded = resultOf(updated, settings, prepared, templates, search);
    const actual = decoded.segments
      .filter(({ kind }) => kind !== 'pause')
      .map(({ ipa: symbol }) => parseIpa(symbol).tokens[0]);
    totals[i].phone += errorRate(
      reference.map(({ symbol }) => symbol),
      decoded.ipa,
      'phone'
    ).rate;
    totals[i].broad += errorRate(
      reference.map(phoneClass),
      actual.map(phoneClass),
      'phone'
    ).rate;
    totals[i].count++;
  }
}

console.log('Rows | Candidates | Phone error | Broad-class error');
for (const [i, { phone, broad, count }] of totals.entries()) {
  console.log(
    size,
    options[i].candidates,
    ((100 * phone) / count).toFixed(2),
    ((100 * broad) / count).toFixed(2)
  );
}
