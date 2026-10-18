/**
 * Audio format registry: one place to encode, decode, detect and stream
 * every supported container (WAV, AIFF/AIFF-C, AU, FLAC, headerless raw).
 */

import { decodeAiff, encodeAiff } from './aiff.js';
import { auHeader, auSampleFormat, decodeAu, encodeAu } from './au.js';
import { decodeFlac, encodeFlac, FLAC_BIT_DEPTHS, flacStart } from './flac.js';
import {
  decodeSamples,
  encodeSamples,
  FLOAT_BIT_DEPTHS,
  PCM_BIT_DEPTHS,
  readTag,
  sampleFormat,
  toChannels,
} from './pcm.js';
import { decodeWav, encodeWav, wavHeader, wavSampleFormat } from './wav.js';

/** Byte-level format of headerless samples: signed little-endian or float. */
function rawSampleFormat(options = {}) {
  const { bitDepth, float } = sampleFormat(options);
  return { bitDepth, kind: float ? 'float' : 'int', little: true };
}

/**
 * Encode headerless interleaved samples (s8, s16le, s24le, s32le, f32le or
 * f64le), the format `ffmpeg -f s16le` / `aplay -t raw` read.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples
 * @param {number} [_sampleRate] Unused; raw audio has no header.
 * @param {{bitDepth?: number, float?: boolean}} [options]
 * @returns {Uint8Array}
 */
export function encodeRaw(samples, _sampleRate, options = {}) {
  return encodeSamples(toChannels(samples), rawSampleFormat(options));
}

/**
 * Decode headerless samples; the caller has to know the layout.
 * @param {Uint8Array} bytes
 * @param {{sampleRate?: number, channels?: number, bitDepth?: number, float?: boolean}} [options]
 */
export function decodeRaw(bytes, options = {}) {
  const format = rawSampleFormat(options);
  const channels = options.channels ?? 1;
  return {
    sampleRate: options.sampleRate ?? 0,
    samples: decodeSamples(bytes, 0, bytes.length, channels, format),
    channels,
    bitDepth: format.bitDepth,
    float: format.kind === 'float',
  };
}

/**
 * Supported containers. `streamable` formats can be sent before the length
 * is known (`audioStreamEncoder`).
 */
export const AUDIO_FORMATS = Object.freeze({
  wav: Object.freeze({
    name: 'wav',
    label: 'WAV',
    extension: 'wav',
    extensions: Object.freeze(['wav', 'wave']),
    mimeType: 'audio/wav',
    bitDepths: PCM_BIT_DEPTHS,
    floatBitDepths: FLOAT_BIT_DEPTHS,
    lossless: true,
    streamable: true,
    encode: encodeWav,
    decode: decodeWav,
  }),
  flac: Object.freeze({
    name: 'flac',
    label: 'FLAC',
    extension: 'flac',
    extensions: Object.freeze(['flac']),
    mimeType: 'audio/flac',
    bitDepths: FLAC_BIT_DEPTHS,
    floatBitDepths: Object.freeze([]),
    lossless: true,
    streamable: false,
    encode: encodeFlac,
    decode: decodeFlac,
  }),
  aiff: Object.freeze({
    name: 'aiff',
    label: 'AIFF',
    extension: 'aiff',
    extensions: Object.freeze(['aiff', 'aif', 'aifc']),
    mimeType: 'audio/aiff',
    bitDepths: PCM_BIT_DEPTHS,
    floatBitDepths: FLOAT_BIT_DEPTHS,
    lossless: true,
    streamable: false,
    encode: encodeAiff,
    decode: decodeAiff,
  }),
  au: Object.freeze({
    name: 'au',
    label: 'Sun AU',
    extension: 'au',
    extensions: Object.freeze(['au', 'snd']),
    mimeType: 'audio/basic',
    bitDepths: PCM_BIT_DEPTHS,
    floatBitDepths: FLOAT_BIT_DEPTHS,
    lossless: true,
    streamable: true,
    encode: encodeAu,
    decode: decodeAu,
  }),
  raw: Object.freeze({
    name: 'raw',
    label: 'Raw PCM',
    extension: 'raw',
    extensions: Object.freeze(['raw', 'pcm']),
    mimeType: 'application/octet-stream',
    bitDepths: PCM_BIT_DEPTHS,
    floatBitDepths: FLOAT_BIT_DEPTHS,
    lossless: true,
    streamable: true,
    encode: encodeRaw,
    decode: decodeRaw,
  }),
});

/** Names of the supported formats. */
export const AUDIO_FORMAT_NAMES = Object.freeze(Object.keys(AUDIO_FORMATS));

/**
 * Look up a format by name, case-insensitively; throws for unknown names.
 * @param {string} [name] Default 'wav'.
 */
export function audioFormat(name = 'wav') {
  const format = AUDIO_FORMATS[String(name).toLowerCase()];
  if (!format) {
    throw new Error(
      `Unknown audio format "${name}" (use ${AUDIO_FORMAT_NAMES.join(', ')})`
    );
  }
  return format;
}

/**
 * Format of a file name from its extension, or null.
 * @param {string} fileName
 * @returns {string | null}
 */
export function formatFromFileName(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(String(fileName));
  if (!match) {
    return null;
  }
  const extension = match[1].toLowerCase();
  const format = Object.values(AUDIO_FORMATS).find((candidate) =>
    candidate.extensions.includes(extension)
  );
  return format ? format.name : null;
}

/**
 * Detect the container from the first bytes; null for unknown (or raw).
 * @param {Uint8Array} bytes
 * @returns {'wav' | 'aiff' | 'au' | 'flac' | null}
 */
export function detectAudioFormat(bytes) {
  const tag = readTag(bytes, 0);
  if (tag === 'RIFF' && readTag(bytes, 8) === 'WAVE') {
    return 'wav';
  }
  if (tag === 'FORM' && ['AIFF', 'AIFC'].includes(readTag(bytes, 8))) {
    return 'aiff';
  }
  if (tag === '.snd') {
    return 'au';
  }
  if (readTag(bytes, flacStart(bytes)) === 'fLaC') {
    return 'flac';
  }
  return null;
}

/**
 * Check `{format, bitDepth, float}` against what the format can store.
 * @param {{format?: string, bitDepth?: number | string, float?: boolean}} [options]
 * @returns {{format: object, bitDepth: number, float: boolean}}
 */
export function audioEncoding(options = {}) {
  const format = audioFormat(options.format);
  const float = Boolean(options.float);
  if (float && format.floatBitDepths.length === 0) {
    throw new Error(`${format.label} has no float samples`);
  }
  const { bitDepth } = sampleFormat(
    { bitDepth: options.bitDepth, float },
    { depths: format.bitDepths }
  );
  return { format, bitDepth, float };
}

/**
 * Encode samples in any supported format.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples One channel or a list of channels.
 * @param {number} sampleRate
 * @param {{format?: string, bitDepth?: number | string, float?: boolean}} [options]
 *   Default 16-bit WAV.
 * @returns {Uint8Array}
 */
export function encodeAudio(samples, sampleRate, options = {}) {
  const { format, bitDepth, float } = audioEncoding(options);
  return format.encode(samples, sampleRate, { bitDepth, float });
}

/**
 * Decode any supported file to mono floats, detecting the container.
 * Headerless data needs `{format: 'raw', sampleRate, bitDepth, ...}`.
 * @param {Uint8Array | ArrayBuffer} input
 * @param {{format?: string, sampleRate?: number, channels?: number, bitDepth?: number, float?: boolean}} [options]
 * @returns {{format: string, sampleRate: number, samples: Float32Array, channels: number, bitDepth: number, float: boolean}}
 */
export function decodeAudio(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const detected = detectAudioFormat(bytes);
  const name =
    detected ?? (options.format ? audioFormat(options.format).name : null);
  if (!name) {
    throw new Error(
      'Unknown audio format (expected WAV, AIFF, AU or FLAC; pass {format: "raw"} for headerless samples)'
    );
  }
  const decoded =
    name === 'raw'
      ? decodeRaw(bytes, options)
      : AUDIO_FORMATS[name].decode(bytes);
  return { format: name, ...decoded };
}

/**
 * Incremental encoder for streaming formats (WAV and AU with an open-ended
 * length, and raw): send `header` first, then `encode(chunk)` for each
 * chunk of mono samples.
 * @param {string} name 'wav', 'au' or 'raw'.
 * @param {number} sampleRate
 * @param {{bitDepth?: number | string, float?: boolean}} [options]
 * @returns {{format: string, mimeType: string, header: Uint8Array, encode: (samples: ArrayLike<number>) => Uint8Array}}
 */
export function audioStreamEncoder(name, sampleRate, options = {}) {
  const { format, bitDepth, float } = audioEncoding({
    ...options,
    format: name,
  });
  if (!format.streamable) {
    throw new Error(`${format.label} cannot be streamed (use wav, au or raw)`);
  }
  const encoding = { bitDepth, float };
  const headers = {
    wav: () => wavHeader(sampleRate, undefined, 1, encoding),
    au: () => auHeader(sampleRate, undefined, 1, encoding),
    raw: () => new Uint8Array(0),
  };
  const sampleFormats = {
    wav: wavSampleFormat,
    au: auSampleFormat,
    raw: rawSampleFormat,
  };
  const bytes = sampleFormats[format.name](encoding);
  return {
    format: format.name,
    mimeType: format.mimeType,
    header: headers[format.name](),
    encode: (samples) => encodeSamples([samples], bytes),
  };
}
