/** Build the optional cold-start data for the recognition command. Unlicense. */
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  recognitionModelsFile,
  recognitionModelVersion,
} from '../bin/recognition-models.js';
import { LANGUAGES } from '../src/g2p/index.js';
import { getLanguageModel } from '../src/recognition/language-model.js';

const models = Object.keys(LANGUAGES).map((language) => {
  const { singles, pairs, triples, total } = getLanguageModel(language);
  return [language, [...singles], [...pairs], [...triples], total];
});
const asset = gzipSync(
  Buffer.from(JSON.stringify([recognitionModelVersion, models]))
);
writeFileSync(recognitionModelsFile, asset);
console.log(`Recognition language models: ${asset.length} bytes`);
