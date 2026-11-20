/** Measure the cost of reading a previously packed word trie. Unlicense. */
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getLexicon } from '../src/recognition/lexicon.js';
import {
  openPreparedLexicon,
  serializeLexicon,
} from '../src/recognition/prepared-lexicon.js';

const language = process.argv[2] ?? 'ru';
const started = performance.now();
const lexicon = getLexicon(language);
const rows = serializeLexicon(lexicon, language);
const built = performance.now();
const snapshot = gzipSync(Buffer.from(JSON.stringify(rows)));
const reading = performance.now();
const { table } = openPreparedLexicon(
  JSON.parse(gunzipSync(snapshot).toString()),
  language,
  lexicon.words
);
console.log({
  language,
  nodes: table.feature.length,
  buildMs: built - started,
  loadMs: performance.now() - reading,
  compressedBytes: snapshot.length,
});
