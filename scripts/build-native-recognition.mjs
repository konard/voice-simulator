/** Generate the default native recognizer's numeric planner and codebook tables. Unlicense. */
import { writeFileSync } from 'node:fs';
import { CHANNELS } from '../src/articulation/plan.js';
import { RENDERER_CONFIG } from '../src/engine/layout.js';
import { renderJob } from '../src/engine/rust-renderer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { LANGUAGES } from '../src/g2p/index.js';
import { prepareUtterance } from '../src/synthesize.js';
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

function renderPhones(ipa) {
  const { plan, renderOptions } = prepareUtterance(ipa, {
    head,
    ipa: true,
    tier: 'minimal',
    sampleRate: rate,
    seed: 1,
  });
  const { config, frames, frameCount } = renderJob(plan, renderOptions);
  return { plan, config, frames, stride: frames.length / frameCount };
}

function controlAt(rendered, seconds) {
  const { config, frames, stride } = rendered;
  const block = Math.floor(
    (seconds * rate) / config[RENDERER_CONFIG.BLOCK_SIZE]
  );
  return frames.subarray(block * stride, (block + 1) * stride);
}

const silence = renderPhones('ə | ə');
const pause = silence.plan.segments.find(({ kind }) => kind === 'pause');
add(Uint32Array, [silence.config.length, silence.stride]);
add(Float64Array, silence.config);
add(Float32Array, controlAt(silence, (pause.start + pause.end) / 2));
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
  const sound = renderPhones(`ə${template.ipa}ə`);
  const phone = sound.plan.segments.filter(({ kind }) => kind !== 'pause')[1];
  for (const phase of [0.2, 0.5, 0.8]) {
    add(
      Float32Array,
      controlAt(sound, phone.start + phase * (phone.end - phone.start))
    );
  }
}

writeFileSync(
  new globalThis.URL(
    '../crates/voice-simulator-cli/src/recognition-model.bin',
    import.meta.url
  ),
  Buffer.concat(chunks)
);
