/**
 * Sample conversion shared by the audio containers: float <-> integer PCM,
 * interleaving, mixdown, G.711 (mu-law / A-law) and byte-level readers and
 * writers for every sample encoding the containers use.
 *
 * Integer PCM uses the 2^(bits-1) scale with clipping, so decoding and
 * re-encoding a file gives back the same bytes.
 */

/** Integer bit depths every container can write. */
export const PCM_BIT_DEPTHS = Object.freeze([8, 16, 24, 32]);
/** Float bit depths for containers that support float samples. */
export const FLOAT_BIT_DEPTHS = Object.freeze([32, 64]);

/**
 * Validate and normalise `{bitDepth, float}` encoding options.
 * @param {{bitDepth?: number, float?: boolean}} [options]
 * @param {{float?: boolean, depths?: readonly number[]}} [allowed]
 * @returns {{bitDepth: number, float: boolean}}
 */
export function sampleFormat(options = {}, allowed = {}) {
  const float = Boolean(options.float);
  const bitDepth = Number(options.bitDepth ?? (float ? 32 : 16));
  const depths = float ? FLOAT_BIT_DEPTHS : (allowed.depths ?? PCM_BIT_DEPTHS);
  if (float && allowed.float === false) {
    throw new Error('This format has no float samples');
  }
  if (!depths.includes(bitDepth)) {
    throw new Error(
      `Unsupported ${float ? 'float' : 'integer'} bit depth ${options.bitDepth}`
    );
  }
  return { bitDepth, float };
}

/**
 * Accept one channel or an array of channels and return the channel list.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples
 * @returns {ArrayLike<number>[]}
 */
export function toChannels(samples) {
  if (Array.isArray(samples) && samples.length > 0 && samples[0]?.length >= 0) {
    const length = samples[0].length;
    if (samples.some((channel) => channel.length !== length)) {
      throw new Error('All channels must have the same length');
    }
    return samples;
  }
  return [samples];
}

/**
 * Interleave channels into one array (frame-major).
 * @param {ArrayLike<number>[]} channels
 */
export function interleave(channels) {
  const count = channels.length;
  const frames = channels[0].length;
  const result = new Float64Array(frames * count);
  for (let channel = 0; channel < count; channel++) {
    const source = channels[channel];
    for (let frame = 0; frame < frames; frame++) {
      result[frame * count + channel] = source[frame];
    }
  }
  return result;
}

/**
 * Average interleaved channels into mono.
 * @param {ArrayLike<number>} interleaved
 * @param {number} channels
 * @returns {Float32Array}
 */
export function mixdown(interleaved, channels) {
  const frames = Math.floor(interleaved.length / channels);
  const result = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += interleaved[frame * channels + channel];
    }
    result[frame] = sum / channels;
  }
  return result;
}

/**
 * Float sample in [-1, 1] to a signed integer of `bits` bits (clipped).
 * @param {number} value
 * @param {number} bits
 */
export function quantize(value, bits) {
  const scale = 2 ** (bits - 1);
  const scaled = Math.round((Number.isFinite(value) ? value : 0) * scale);
  return Math.max(-scale, Math.min(scale - 1, scaled));
}

/** Signed integer of `bits` bits to a float in [-1, 1). */
export function dequantize(value, bits) {
  return value / 2 ** (bits - 1);
}

/**
 * Write one sample. `kind` is 'int', 'uint8' (WAV 8-bit) or 'float'.
 * @param {DataView} view
 * @param {number} offset
 * @param {number} value Float sample.
 * @param {{bitDepth: number, kind: string, little: boolean}} format
 */
export function writeSample(view, offset, value, format) {
  const { bitDepth, kind, little } = format;
  if (kind === 'float') {
    if (bitDepth === 64) {
      view.setFloat64(offset, value, little);
    } else {
      view.setFloat32(offset, value, little);
    }
    return;
  }
  const integer = quantize(value, bitDepth);
  if (bitDepth === 8) {
    view.setUint8(offset, kind === 'uint8' ? integer + 128 : integer & 0xff);
  } else if (bitDepth === 16) {
    view.setInt16(offset, integer, little);
  } else if (bitDepth === 24) {
    const bytes = [
      integer & 0xff,
      (integer >> 8) & 0xff,
      (integer >> 16) & 0xff,
    ];
    for (let index = 0; index < 3; index++) {
      view.setUint8(offset + index, bytes[little ? index : 2 - index]);
    }
  } else {
    view.setInt32(offset, integer, little);
  }
}

const MULAW_BIAS = 0x84;

/** Decode one G.711 mu-law byte. */
export function mulawToFloat(byte) {
  const value = ~byte & 0xff;
  const exponent = (value >> 4) & 0x07;
  const magnitude = (((value & 0x0f) << 3) + MULAW_BIAS) << exponent;
  const sample = magnitude - MULAW_BIAS;
  return (value & 0x80 ? -sample : sample) / 32768;
}

/** Decode one G.711 A-law byte. */
export function alawToFloat(byte) {
  const value = byte ^ 0x55;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  const magnitude =
    exponent === 0
      ? (mantissa << 4) + 8
      : ((mantissa << 4) + 0x108) << (exponent - 1);
  return (value & 0x80 ? magnitude : -magnitude) / 32768;
}

/**
 * Read one sample as a float. `kind` adds 'mulaw' and 'alaw' to the kinds
 * of writeSample.
 * @param {DataView} view
 * @param {number} offset
 * @param {{bitDepth: number, kind: string, little: boolean}} format
 */
export function readSample(view, offset, format) {
  const { bitDepth, kind, little } = format;
  switch (kind) {
    case 'float':
      return bitDepth === 64
        ? view.getFloat64(offset, little)
        : view.getFloat32(offset, little);
    case 'mulaw':
      return mulawToFloat(view.getUint8(offset));
    case 'alaw':
      return alawToFloat(view.getUint8(offset));
    case 'uint8':
      return (view.getUint8(offset) - 128) / 128;
    default:
      break;
  }
  if (bitDepth === 8) {
    return view.getInt8(offset) / 128;
  }
  if (bitDepth === 16) {
    return view.getInt16(offset, little) / 32768;
  }
  if (bitDepth === 24) {
    const first = view.getUint8(offset);
    const middle = view.getUint8(offset + 1);
    const last = view.getUint8(offset + 2);
    const value = little
      ? first | (middle << 8) | (last << 16)
      : last | (middle << 8) | (first << 16);
    return ((value << 8) >> 8) / 8388608;
  }
  return view.getInt32(offset, little) / 2147483648;
}

/**
 * Encode channels as interleaved sample bytes.
 * @param {ArrayLike<number>[]} channels
 * @param {{bitDepth: number, kind: string, little: boolean}} format
 * @returns {Uint8Array}
 */
export function encodeSamples(channels, format) {
  const data = interleave(channels);
  const width = format.bitDepth / 8;
  const bytes = new Uint8Array(data.length * width);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < data.length; index++) {
    writeSample(view, index * width, data[index], format);
  }
  return bytes;
}

/**
 * Decode interleaved sample bytes to mono floats (channels are averaged).
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length Bytes available.
 * @param {number} channels
 * @param {{bitDepth: number, kind: string, little: boolean}} format
 * @returns {Float32Array}
 */
export function decodeSamples(bytes, offset, length, channels, format) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = format.bitDepth / 8;
  const frames = Math.floor(length / (width * channels));
  const values = new Float64Array(frames * channels);
  for (let index = 0; index < values.length; index++) {
    values[index] = readSample(view, offset + index * width, format);
  }
  return mixdown(values, channels);
}

/** Four-character code at `offset`. */
export function readTag(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** Write an ASCII string at `offset`. */
export function writeTag(bytes, offset, text) {
  for (let index = 0; index < text.length; index++) {
    bytes[offset + index] = text.charCodeAt(index);
  }
}
