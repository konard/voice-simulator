/** Generate the default native recognizer's numeric planner and codebook tables. Unlicense. */
import { writeFileSync } from 'node:fs';
import { CHANNELS } from '../src/articulation/plan.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { LANGUAGES } from '../src/g2p/index.js';
import { mfcc } from '../src/metrics/spectrum.js';
import { synthesize } from '../src/synthesize.js';
import { GRID } from '../src/recognition/codebook-features.js';
import { CODEBOOK_CHANNELS } from '../src/recognition/codebook.js';
import { decoderCodebook } from '../src/recognition/decode-pipeline.js';
import {
  decoderLanguage,
  decoderTemplates,
} from '../src/recognition/decode-model.js';
import { SOURCE_CHANNEL_MAPS } from '../src/recognition/source-channel-maps.js';
import { LANDMARK_THRESHOLDS } from '../src/recognition/landmark-thresholds.js';

const head = DEFAULT_HEAD;
const rate = 16000;
const language = decoderLanguage({ languages: Object.keys(LANGUAGES) });
const templates = decoderTemplates(head, language.symbols);
const book = decoderCodebook(head);
const chunks = [];

function add(type, values) {
  const array = type.from(values);
  const bytes = Buffer.alloc(array.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method =
    type === Uint8Array
      ? 'setUint8'
      : type === Uint32Array
        ? 'setUint32'
        : type === Float32Array
          ? 'setFloat32'
          : 'setFloat64';
  array.forEach((value, i) =>
    view[method](i * type.BYTES_PER_ELEMENT, value, true)
  );
  chunks.push(bytes);
}

add(Uint32Array, [book.tree.length / 4, templates.length]);
add(Uint32Array, book.tree);
add(Float32Array, book.key);
add(Uint8Array, book.envelope);
add(Uint8Array, book.articulation);
add(Float64Array, [
  ...GRID,
  ...CODEBOOK_CHANNELS.flatMap(({ name, min, max }) => [
    min,
    max - min,
    CHANNELS[name],
    CHANNELS[name] ? head.articulationSpeed : 1,
  ]),
  ...CODEBOOK_CHANNELS.map(
    ({ name, min, max }) => head[name] ?? (min + max) / 2
  ),
  ...Object.values(LANDMARK_THRESHOLDS),
  ...language.costs,
  ...[8000, 16000].flatMap((rate) =>
    Object.values(SOURCE_CHANNEL_MAPS[rate]).flat()
  ),
  CHANNELS.voicing,
  head.f0 ?? 120,
]);
for (const template of templates) {
  const symbol = Buffer.from(template.ipa);
  add(Uint32Array, [
    symbol.length,
    template.classMask,
    template.compared.length,
    Number(language.long.has(template.ipa)),
  ]);
  chunks.push(symbol);
  add(Float64Array, [
    template.duration,
    ...template.compared.flatMap((cell) => [cell, template.values[cell]]),
  ]);
  const sound = synthesize(`ə${template.ipa}ə`, {
    head,
    ipa: true,
    engine: 'js',
    tier: 'minimal',
    sampleRate: rate,
    seed: 1,
  });
  const rows = mfcc(sound.samples, sound.sampleRate);
  const central = rows[Math.floor(rows.length / 2)];
  add(Float64Array, central.subarray(1, 13));
}

writeFileSync(
  new globalThis.URL(
    '../crates/voice-simulator-cli/src/recognition-model.bin',
    import.meta.url
  ),
  Buffer.concat(chunks)
);
