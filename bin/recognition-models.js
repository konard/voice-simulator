/** The optional pronunciation statistics built from the shipped lexicons. Unlicense. */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { installLanguageModels } from '../src/recognition/language-model.js';

export const recognitionModelsFile = new URL(
  '../src/engine/voice-simulator-recognition-models.json.gz',
  import.meta.url
);
export const recognitionModelVersion = 1;

export function loadRecognitionModels(file = recognitionModelsFile) {
  try {
    const [version, rows] = JSON.parse(
      gunzipSync(readFileSync(file)).toString()
    );
    if (version !== recognitionModelVersion) {
      return;
    }
    installLanguageModels(
      new Map(
        rows.map(([language, singles, pairs, triples, total]) => [
          language,
          {
            singles: new Map(singles),
            pairs: new Map(pairs),
            triples: new Map(triples),
            total,
          },
        ])
      )
    );
  } catch {
    // Development and source installations can derive exactly the same
    // statistics on demand when this optional build output is unavailable.
  }
}
