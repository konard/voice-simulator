/** Optional recognition tables generated from the shipped lexicons. Unlicense. */
import { installLanguageModelReader } from './language-model.js';
import { installPreparedLexicons } from './lexicon.js';
import { openPreparedLexicon } from './prepared-lexicon.js';

export const recognitionModelVersion = 1;

export const recognitionDataFile = (kind) =>
  new globalThis.URL(
    `../engine/voice-simulator-recognition-${kind}.json.gz`,
    import.meta.url
  );

let configured = false;

export function configureNodeRecognitionModels() {
  if (configured) {
    return;
  }
  configured = true;
  const process = globalThis.process;
  const fs = process?.getBuiltinModule?.('node:fs');
  const zlib = process?.getBuiltinModule?.('node:zlib');
  if (!fs || !zlib) {
    return;
  }
  function read(kind) {
    const file = fs.readFileSync(recognitionDataFile(kind));
    const [version, rows] = JSON.parse(zlib.gunzipSync(file).toString());
    return version === recognitionModelVersion ? rows : undefined;
  }
  installPreparedLexicons((language, words) => {
    try {
      const rows = read(language);
      if (rows) {
        return openPreparedLexicon(rows, language, words);
      }
    } catch {
      // Source installations can build the same trie on demand.
    }
  });
  installLanguageModelReader(() => {
    try {
      const rows = read('models');
      return new Map(
        rows?.map(([language, singles, pairs, triples, total]) => [
          language,
          {
            singles: new Map(singles),
            pairs: new Map(pairs),
            triples: new Map(triples),
            total,
          },
        ])
      );
    } catch {
      // Source installations can count the same pronunciations on demand.
    }
  });
}
