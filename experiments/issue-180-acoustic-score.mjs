/**
 * Compare the HMM search result and a forced reading of a telephone WAV.
 * Supply the reference text on stdin. The reference is used only after
 * decoding, so the two alignment scores measure acoustic preference.
 * node experiments/issue-180-acoustic-score.mjs <file.wav> < reference.txt
 * Unlicense.
 */
import { readFileSync } from 'node:fs';
import { decodeWav } from '../src/audio/wav.js';
import { textToIpa } from '../src/g2p/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { alignWords, decodeWords } from '../src/recognition/hmm-decode.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { pauseCuts } from '../src/recognition/recognizer-pauses.js';

const wav = process.argv[2];
if (!wav) {
  throw new Error('Pass a WAV file path and supply the expected text on stdin');
}
const { samples, sampleRate } = decodeWav(readFileSync(wav));
if (samples.length > 15 * sampleRate) {
  throw new RangeError('Use a recording of up to 15 seconds');
}

const model = getHmmModel();
const network = getNetwork(model, ['en']);
const { feats, frames } = hmmFeatures(samples, sampleRate, model.lda);
const decoded = decodeWords(network, feats, frames);
const reference = readFileSync(0, 'utf8').trim();
const { ipa } = textToIpa(reference, { lang: 'en', accent: 'en-US' });
const words = ipa
  .split(/[\s|.,?!]+/u)
  .filter(Boolean)
  .map((word) => {
    const tokens = parseIpa(word).tokens.filter(({ kind }) => kind !== 'pause');
    return { tokens, units: tokens.map(({ symbol }) => symbol) };
  });

function printAlignment(label, text, reading) {
  const options = {
    onScore: (score) => console.log({ label, score, text }),
  };
  alignWords(network, feats, frames, reading, options);
}

printAlignment(
  'decoded',
  decoded.words.map(({ word }) => word).join(' '),
  decoded.words
);
printAlignment('reference', reference, words);

const referenceWords = reference.toLowerCase().match(/[a-z']+/gu);
if (
  referenceWords?.length === words.length &&
  words.length === decoded.words.length
) {
  for (const [index, word] of decoded.words.entries()) {
    if (word.word !== referenceWords[index]) {
      const candidate = decoded.words.with(index, words[index]);
      printAlignment(
        'single substitution',
        {
          decoded: word.word,
          reference: referenceWords[index],
        },
        candidate
      );
    }
  }
}

const cuts = pauseCuts(samples, sampleRate);
if (cuts.length) {
  const parts = cuts.slice(1).map((end, i) => {
    const start = cuts[i];
    const features = hmmFeatures(
      samples.subarray(start, end),
      sampleRate,
      model.lda
    );
    return decodeWords(network, features.feats, features.frames)
      .words.map(({ word }) => word)
      .join(' ');
  });
  console.log({ label: 'decoded at quiet cuts', parts });
}
