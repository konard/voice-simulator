/**
 * Basic usage example: text -> IPA -> physically simulated speech -> WAV.
 *
 * Run with any runtime:
 * - Bun: bun examples/basic-usage.js
 * - Node.js: node examples/basic-usage.js
 * - Deno: deno run -A examples/basic-usage.js
 *
 * Writes hello-*.wav files into the current directory.
 */

import { writeFileSync } from 'node:fs';

import {
  LANGUAGES,
  encodeWav,
  randomHeadConfig,
  synthesize,
  synthesizeStream,
  textToIpa,
} from '../src/index.js';

console.log('Text to IPA:');
for (const language of Object.values(LANGUAGES)) {
  const { ipa } = textToIpa(language.sample, { lang: language.code });
  console.log(`  ${language.code}: ${language.sample}\n      /${ipa}/`);
}

// Every seed is a different person: tract length, pitch, mouth and nose.
const head = randomHeadConfig(42);
console.log(
  `\nRandom head: tract ${head.vocalTractLength} cm, pitch ${head.pitch} Hz`
);

const offline = synthesize('Hello world', { head, tier: 'medium', seed: 42 });
writeFileSync('hello-offline.wav', encodeWav(offline.samples, 48000));
console.log(
  `Offline: /${offline.ipa}/ ${offline.duration.toFixed(2)} s -> hello-offline.wav`
);

// Streaming: chunks arrive while the waves are being simulated.
const chunks = [];
for await (const chunk of synthesizeStream('Привет, мир!', { head })) {
  chunks.push(...chunk);
}
writeFileSync('hello-stream.wav', encodeWav(Float32Array.from(chunks), 48000));
console.log(`Streamed: ${chunks.length} samples -> hello-stream.wav`);

// The 3D FDTD solver propagates the wave through the voxelised head.
const fdtd = synthesize('ˈa', { head, ipa: true, tier: 'high' });
writeFileSync('hello-fdtd.wav', encodeWav(fdtd.samples, fdtd.sampleRate));
console.log(`3D FDTD: ${fdtd.duration.toFixed(2)} s -> hello-fdtd.wav`);
