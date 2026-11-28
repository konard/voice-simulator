/** Build the optional cold-start data for the recognition command. Unlicense. */
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import {
  hmmNetworkFile,
  hmmNetworkVersion,
  packLanguageModel,
  recognitionDataFile,
  recognitionModelVersion,
  wordTransitionFile,
  wordTransitionVersion,
} from '../src/recognition/node-models.js';
import { LANGUAGES } from '../src/g2p/index.js';
import { packWordTransitions } from '../src/recognition/data/index.js';
import { getLanguageModel } from '../src/recognition/language-model.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { packHmmArchive } from '../src/recognition/hmm-archive.js';
import { packHmmNetwork } from '../src/recognition/hmm-network.js';
import { serializeLexicon } from '../src/recognition/prepared-lexicon.js';
import { buildRecognitionCodebook } from './build-recognition-codebook.mjs';

function writeAsset(file, bytes) {
  const asset = gzipSync(bytes);
  writeFileSync(file, asset);
  console.log(`${file.pathname.split('/').at(-1)}: ${asset.length} bytes`);
}

function write(file, rows) {
  writeAsset(
    file,
    Buffer.from(JSON.stringify([recognitionModelVersion, rows]))
  );
}

function writeWordTransitions(language) {
  const [offsets, pairs] = packWordTransitions(language);
  const bytes = Buffer.alloc((2 + offsets.length + pairs.length) * 4);
  let offset = bytes.writeUInt32LE(wordTransitionVersion, 0);
  offset = bytes.writeUInt32LE(offsets.length, offset);
  for (const row of [offsets, pairs]) {
    for (const value of row) {
      offset = bytes.writeUInt32LE(value, offset);
    }
  }
  const asset = gzipSync(bytes);
  const file = wordTransitionFile(language);
  writeFileSync(file, asset);
  console.log(`${file.pathname.split('/').at(-1)}: ${asset.length} bytes`);
}

const hmmSizes = {};
const models = Object.keys(LANGUAGES).map((language) => {
  const lexicon = getLexicon(language);
  writeAsset(
    recognitionDataFile(language),
    serialize([recognitionModelVersion, serializeLexicon(lexicon, language)])
  );
  const hmm = packHmmNetwork(language);
  writeAsset(
    hmmNetworkFile(language),
    packHmmArchive(hmm, hmmNetworkVersion, serialize)
  );
  hmmSizes[language] = {
    nodes: hmm.nodes.first.length,
    states: hmm.emit.length,
    links: hmm.wordId.length,
  };
  writeWordTransitions(language);
  return [language, packLanguageModel(getLanguageModel(language))];
});
writeAsset(
  hmmNetworkFile('index'),
  Buffer.from(JSON.stringify([hmmNetworkVersion, hmmSizes]))
);
write(recognitionDataFile('models'), models);
buildRecognitionCodebook();
