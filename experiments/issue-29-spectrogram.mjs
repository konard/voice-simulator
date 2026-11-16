#!/usr/bin/env node

/**
 * Issue 29: a spectrogram of one tier switch in a recording of the app.
 *
 *   node experiments/issue-29-spectrogram.mjs <in.wav> <switch seconds>
 *     <out.png> [--span 0.8] [--max-frequency 12000] [--fade 0.03,0.025]
 *
 * <switch seconds> is the `wav` time of a switch printed by
 * experiments/issue-27-latency.mjs (the `at` of the worker's `tier`
 * message on the time line of the WAV). The image shows --span seconds
 * centred on it (Hann window of 1024 samples, hop 64, 90 dB of range);
 * the white lines mark `at`, the yellow ones the crossfade, which starts
 * the preroll later (`--fade` start and length, 30 ms and 25 ms in
 * AdaptiveStream). The RMS level of the 25 ms before the crossfade, of
 * the crossfade and of the 25 ms after it is printed.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

const [input, center, output] = process.argv.slice(2);
if (!input || !center || !output) {
  console.error(
    'usage: issue-29-spectrogram.mjs <in.wav> <seconds> <out.png> [--span s]'
  );
  process.exit(2);
}
const span = Number(option('span', 0.8));
const maxFrequency = Number(option('max-frequency', 12000));
const [fadeStart, fadeLength] = String(option('fade', '0.03,0.025'))
  .split(',')
  .map(Number);

/** Mono 16-bit PCM WAV, as experiments/issue-27-latency.mjs writes it. */
function readWav(file) {
  const data = fs.readFileSync(file);
  const rate = data.readUInt32LE(24);
  let offset = 12;
  while (data.toString('latin1', offset, offset + 4) !== 'data') {
    offset += 8 + data.readUInt32LE(offset + 4);
  }
  const length = data.readUInt32LE(offset + 4) / 2;
  const samples = new Float64Array(length);
  for (let index = 0; index < length; index++) {
    samples[index] = data.readInt16LE(offset + 8 + index * 2) / 32768;
  }
  return { rate, samples };
}

/** In-place radix-2 FFT of `re` and `im`. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(step * k);
        const sin = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cos - im[b] * sin;
        const ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Dark blue - red - yellow ramp for 0..1. */
function color(value) {
  const v = Math.max(0, Math.min(1, value));
  return [
    Math.round(255 * Math.min(1, v * 2)),
    Math.round(255 * Math.max(0, v * 2 - 1)),
    Math.round(255 * Math.max(0, 0.5 - Math.abs(v - 0.25)) * 1.2),
  ];
}

const { rate, samples } = readWav(input);
const SIZE = 1024;
const HOP = 64;
const switchSample = Math.round(Number(center) * rate);
const first = Math.max(0, switchSample - Math.round((span / 2) * rate));
const columns = Math.floor((span * rate) / HOP);
const bins = Math.min(SIZE / 2, Math.round((maxFrequency / rate) * SIZE));
const window = Float64Array.from(
  { length: SIZE },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1))
);
const levels = new Float64Array(columns * bins);
let top = -Infinity;
for (let column = 0; column < columns; column++) {
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  const start = first + column * HOP - SIZE / 2;
  for (let i = 0; i < SIZE; i++) {
    re[i] = (samples[start + i] ?? 0) * window[i];
  }
  fft(re, im);
  for (let bin = 0; bin < bins; bin++) {
    const level = 10 * Math.log10(re[bin] ** 2 + im[bin] ** 2 + 1e-20);
    levels[column * bins + bin] = level;
    top = Math.max(top, level);
  }
}

const PIXEL = 2;
const width = columns;
const height = bins * PIXEL;
const rgb = Buffer.alloc(width * height * 3);
const mark = (sample, paint) => {
  const x = Math.round((sample - first) / HOP);
  if (x >= 0 && x < width) {
    for (let y = 0; y < height; y += y % 8 < 5 ? 1 : 4) {
      rgb.set(paint, (y * width + x) * 3);
    }
  }
};
for (let column = 0; column < columns; column++) {
  for (let bin = 0; bin < bins; bin++) {
    const paint = color((levels[column * bins + bin] - top + 90) / 90);
    for (let p = 0; p < PIXEL; p++) {
      const y = height - 1 - (bin * PIXEL + p);
      rgb.set(paint, (y * width + column) * 3);
    }
  }
}
const fadeFrom = switchSample + Math.round(fadeStart * rate);
const fadeTo = fadeFrom + Math.round(fadeLength * rate);
mark(switchSample, [255, 255, 255]);
mark(fadeFrom, [255, 255, 0]);
mark(fadeTo, [255, 255, 0]);
fs.writeFileSync(output, png(width, height, rgb));

const rms = (from, to) => {
  let sum = 0;
  for (let index = from; index < to; index++) {
    sum += samples[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, to - from));
};
const db = (value) => Math.round(20 * Math.log10(value + 1e-12) * 100) / 100;
const n = fadeTo - fadeFrom;
console.log(
  JSON.stringify({
    output,
    rate,
    width,
    height,
    seconds: [
      Math.round((first / rate) * 1000) / 1000,
      Math.round(((first + columns * HOP) / rate) * 1000) / 1000,
    ],
    maxFrequency: Math.round((bins / SIZE) * rate),
    rmsBeforeDb: db(rms(fadeFrom - n, fadeFrom)),
    rmsFadeDb: db(rms(fadeFrom, fadeTo)),
    rmsAfterDb: db(rms(fadeTo, fadeTo + n)),
  })
);
