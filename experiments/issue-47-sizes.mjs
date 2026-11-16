/**
 * Issue 47: raw and gzip sizes of the parts of the generated lexicons,
 * with and without byte-pair merges.
 *   node experiments/issue-47-sizes.mjs
 */
import { gzipSync } from 'node:zlib';
import { EN_LEXICON } from '../src/g2p/lexicon/en.js';
import { ZH_PHRASES, ZH_READINGS } from '../src/g2p/lexicon/zh.js';
import { decodeBlock, encodeVslex } from '../src/g2p/vslex.js';

function sizes(name, data) {
  const text = JSON.stringify(data);
  console.log(
    `${name}: ${Buffer.byteLength(text)} bytes, ${gzipSync(text, { level: 9 }).length} gzip`
  );
}

function entries(data) {
  return data.first.flatMap((_, index) => decodeBlock(data, index));
}

for (const [name, data] of Object.entries({ EN_LEXICON, ZH_READINGS, ZH_PHRASES })) {
  sizes(name, data);
  sizes(`${name} without merges`, encodeVslex(data.lang, entries(data), { merge: false }));
}
const multi = entries(ZH_READINGS).filter(([, variants]) => variants.length > 1);
console.log(`characters with more than one reading: ${multi.length}`);
