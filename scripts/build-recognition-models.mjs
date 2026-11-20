/** Build the optional cold-start data for the recognition command. Unlicense. */
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  recognitionDataFile,
  recognitionModelVersion,
} from '../src/recognition/node-models.js';
import { LANGUAGES } from '../src/g2p/index.js';
import { getLanguageModel } from '../src/recognition/language-model.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { serializeLexicon } from '../src/recognition/prepared-lexicon.js';

function write(file, rows) {
  const asset = gzipSync(
    Buffer.from(JSON.stringify([recognitionModelVersion, rows]))
  );
  writeFileSync(file, asset);
  console.log(`${file.pathname.split('/').at(-1)}: ${asset.length} bytes`);
}

const models = Object.keys(LANGUAGES).map((language) => {
  const { singles, pairs, triples, total } = getLanguageModel(language);
  write(
    recognitionDataFile(language),
    serializeLexicon(getLexicon(language), language)
  );
  return [language, [...singles], [...pairs], [...triples], total];
});
write(recognitionDataFile('models'), models);
