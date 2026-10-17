// Cross-check the pure-JS FLAC encoder against libFLAC (issue 5).
//
// No ffmpeg/sox/flac binaries are needed: @wasm-audio-decoders/flac (MIT)
// is libFLAC compiled to WebAssembly. Install it outside the repository:
//   npm install --prefix /tmp/flac-deps --no-save --ignore-scripts \
//     @wasm-audio-decoders/flac@0.2.11
//   node experiments/issue-5-flac-crosscheck.mjs /tmp/flac-deps
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { encodeFlac } from '../src/audio/flac.js';
import { quantize } from '../src/audio/pcm.js';

// libFLAC.js scales samples by 1 / (2^(bits-1) - 1).
const libflacScale = (bitDepth) => 2 ** (bitDepth - 1) - 1;

const CRC16 = Array.from({ length: 256 }, (_, byte) => {
  let crc = byte << 8;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
});

function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ byte];
  }
  return crc;
}

/**
 * Split a FLAC stream into frames without the encoder's knowledge: a frame
 * ends right before a sync code where the bytes so far have CRC-16 zero
 * (the frame footer makes the CRC of the whole frame zero).
 */
function splitFrames(bytes) {
  let start = 4;
  while (
    start < bytes.length &&
    !(bytes[start] === 0xff && bytes[start + 1] === 0xf8)
  ) {
    start++;
  }
  const frames = [];
  for (let end = start + 2; end <= bytes.length; end++) {
    const atSync =
      end === bytes.length ||
      (bytes[end] === 0xff && (bytes[end + 1] & 0xfe) === 0xf8);
    if (atSync && crc16(bytes.subarray(start, end)) === 0) {
      frames.push(bytes.subarray(start, end));
      start = end;
    }
  }
  return frames;
}

const deps = process.argv[2] ?? '/tmp/flac-deps';
const entry = join(deps, 'node_modules/@wasm-audio-decoders/flac/index.js');
const { FLACDecoder } = await import(pathToFileURL(entry).href);

function signal(length, seed) {
  let state = seed;
  return Float32Array.from({ length }, (_, index) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    const noise = (state / 2147483648 - 0.5) * 0.02;
    return 0.5 * Math.sin(index / 9) + 0.3 * Math.sin(index / 2.1) + noise;
  });
}

const cases = [
  { name: 'mono 16-bit 4096*3+5', channels: 1, length: 4096 * 3 + 5 },
  { name: 'mono 24-bit short', channels: 1, length: 100, bitDepth: 24 },
  { name: 'mono 8-bit', channels: 1, length: 9000, bitDepth: 8 },
  { name: 'stereo 16-bit', channels: 2, length: 20000 },
  { name: 'silence (constant)', channels: 1, length: 5000, silent: true },
  { name: '6 channels 16-bit', channels: 6, length: 7000 },
  { name: '1 sample', channels: 1, length: 1 },
  { name: 'odd rate 11111 Hz', channels: 1, length: 3000, rate: 11111 },
  {
    name: 'many frames (UTF-8 frame numbers)',
    channels: 1,
    length: 4096 * 300,
  },
];

let failures = 0;
for (const testCase of cases) {
  const bitDepth = testCase.bitDepth ?? 16;
  const rate = testCase.rate ?? 22050;
  const channels = Array.from({ length: testCase.channels }, (_, index) =>
    testCase.silent
      ? new Float32Array(testCase.length)
      : signal(testCase.length, index + 1)
  );
  const bytes = encodeFlac(channels, rate, { bitDepth });
  const decoder = new FLACDecoder();
  await decoder.ready;
  // decodeFile() goes through codec-parser, which drops a tiny final frame
  // (a few bytes) of multi-frame streams; feed libFLAC the frames directly.
  const whole = await decoder.decodeFile(bytes);
  const result = await decoder.decodeFrames(splitFrames(bytes));
  decoder.free();
  let mismatches = 0;
  channels.forEach((channel, index) => {
    const decoded = result.channelData[index] ?? new Float32Array();
    if (decoded.length !== channel.length) {
      mismatches += Math.abs(decoded.length - channel.length);
    }
    for (let sample = 0; sample < channel.length; sample++) {
      const expected = quantize(channel[sample], bitDepth);
      const actual = Math.round(decoded[sample] * libflacScale(bitDepth));
      if (expected !== actual) {
        mismatches++;
      }
    }
  });
  const ok =
    mismatches === 0 &&
    result.errors.length === 0 &&
    result.sampleRate === rate &&
    result.bitDepth === bitDepth;
  failures += ok ? 0 : 1;
  console.log(
    ok ? 'OK  ' : 'FAIL',
    testCase.name,
    `bytes=${bytes.length}`,
    `ratio=${(bytes.length / (testCase.length * testCase.channels * (bitDepth / 8))).toFixed(3)}`,
    `rate=${result.sampleRate} bits=${result.bitDepth}`,
    `samples=${result.samplesDecoded} mismatches=${mismatches}`,
    `errors=${JSON.stringify(result.errors)}`,
    `decodeFile-samples=${whole.samplesDecoded}`
  );
}
process.exitCode = failures ? 1 : 0;
