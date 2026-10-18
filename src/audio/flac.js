/**
 * FLAC (Free Lossless Audio Codec) in pure JavaScript.
 *
 * The encoder writes fixed-blocksize frames with constant, verbatim or
 * fixed-predictor (order 0-4) subframes and partitioned Rice residuals;
 * that is FLAC's "fast" preset family and is typically about half the
 * size of 16-bit WAV for speech. The decoder reads every subframe type of
 * RFC 9639 (constant, verbatim, fixed, LPC, wasted bits, Rice and Rice2
 * with escapes, all stereo decorrelation modes) and checks each frame's
 * CRC-16. MD5 signatures are written as "unset" and not checked.
 */

import { mixdown, quantize, readTag, sampleFormat, toChannels } from './pcm.js';

/** Bit depths the FLAC encoder writes. */
export const FLAC_BIT_DEPTHS = Object.freeze([8, 16, 24]);
const BLOCK_SIZE = 4096;
const MAX_FIXED_ORDER = 4;
const MAX_PARTITION_ORDER = 8;

function crcTable(polynomial, width) {
  const top = 1 << (width - 1);
  const mask = (1 << width) - 1;
  return Uint16Array.from({ length: 256 }, (_, byte) => {
    let crc = byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & top ? ((crc << 1) ^ polynomial) & mask : (crc << 1) & mask;
    }
    return crc;
  });
}

const CRC8 = crcTable(0x07, 8);
const CRC16 = crcTable(0x8005, 16);

function crc8(bytes, start, end) {
  let crc = 0;
  for (let index = start; index < end; index++) {
    crc = CRC8[crc ^ bytes[index]];
  }
  return crc;
}

function crc16(bytes, start, end) {
  let crc = 0;
  for (let index = start; index < end; index++) {
    crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ bytes[index]];
  }
  return crc;
}

class BitWriter {
  constructor(capacity = 1 << 16) {
    this.bytes = new Uint8Array(capacity);
    this.length = 0;
    this.acc = 0;
    this.bits = 0;
  }

  #push(byte) {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }

  /** Write the low `count` bits of a non-negative integer. */
  write(value, count) {
    if (count > 24) {
      const low = count - 24;
      this.write(Math.floor(value / 2 ** low), 24);
      this.write(value % 2 ** low, low);
      return;
    }
    this.acc = this.acc * 2 ** count + (value % 2 ** count);
    this.bits += count;
    while (this.bits >= 8) {
      this.bits -= 8;
      const scale = 2 ** this.bits;
      const byte = Math.floor(this.acc / scale);
      this.#push(byte);
      this.acc -= byte * scale;
    }
  }

  /** Two's complement signed value in `count` bits. */
  writeSigned(value, count) {
    this.write(value < 0 ? value + 2 ** count : value, count);
  }

  /** `zeros` zero bits followed by a one. */
  writeUnary(zeros) {
    let left = zeros;
    while (left > 24) {
      this.write(0, 24);
      left -= 24;
    }
    this.write(1, left + 1);
  }

  align() {
    if (this.bits > 0) {
      this.write(0, 8 - this.bits);
    }
  }

  result() {
    return this.bytes.slice(0, this.length);
  }
}

class BitReader {
  constructor(bytes, position = 0) {
    this.bytes = bytes;
    this.position = position;
    this.bit = 0;
  }

  read(count) {
    let value = 0;
    let left = count;
    while (left > 0) {
      if (this.position >= this.bytes.length) {
        throw new Error('FLAC stream ended inside a frame');
      }
      const available = 8 - this.bit;
      const take = Math.min(left, available);
      const shift = available - take;
      const bits = (this.bytes[this.position] >> shift) & ((1 << take) - 1);
      value = value * 2 ** take + bits;
      left -= take;
      this.bit += take;
      if (this.bit === 8) {
        this.bit = 0;
        this.position++;
      }
    }
    return value;
  }

  readSigned(count) {
    if (count === 0) {
      return 0;
    }
    const value = this.read(count);
    return value >= 2 ** (count - 1) ? value - 2 ** count : value;
  }

  readUnary() {
    let zeros = 0;
    for (;;) {
      if (this.position >= this.bytes.length) {
        throw new Error('FLAC stream ended inside a frame');
      }
      const byte = (this.bytes[this.position] << this.bit) & 0xff;
      if (byte === 0) {
        zeros += 8 - this.bit;
        this.bit = 0;
        this.position++;
        continue;
      }
      const lead = Math.clz32(byte) - 24;
      zeros += lead;
      this.bit += lead + 1;
      if (this.bit === 8) {
        this.bit = 0;
        this.position++;
      }
      return zeros;
    }
  }

  align() {
    if (this.bit !== 0) {
      this.bit = 0;
      this.position++;
    }
  }
}

const RATE_CODES = new Map([
  [88200, 1],
  [176400, 2],
  [192000, 3],
  [8000, 4],
  [16000, 5],
  [22050, 6],
  [24000, 7],
  [32000, 8],
  [44100, 9],
  [48000, 10],
  [96000, 11],
]);
const RATES = [
  0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000,
  96000,
];
const SAMPLE_SIZE_CODES = new Map([
  [8, 1],
  [12, 2],
  [16, 4],
  [20, 5],
  [24, 6],
  [32, 7],
]);
const SAMPLE_SIZES = [0, 8, 12, 0, 16, 20, 24, 32];

function writeFrameNumber(writer, number) {
  if (number < 0x80) {
    writer.write(number, 8);
    return;
  }
  let bytes = 2;
  while (number >= 2 ** (5 * bytes + 1)) {
    bytes++;
  }
  const lead = 0xff00 >> bytes;
  writer.write((lead & 0xff) | Math.floor(number / 2 ** (6 * (bytes - 1))), 8);
  for (let index = bytes - 2; index >= 0; index--) {
    writer.write(0x80 | (Math.floor(number / 2 ** (6 * index)) & 0x3f), 8);
  }
}

/** Residual of the fixed predictor of `order` for samples[start..end). */
function fixedResidual(samples, order, out) {
  for (let index = order; index < samples.length; index++) {
    const s0 = samples[index];
    const s1 = samples[index - 1];
    const s2 = samples[index - 2];
    const s3 = samples[index - 3];
    const s4 = samples[index - 4];
    let value;
    if (order === 0) {
      value = s0;
    } else if (order === 1) {
      value = s0 - s1;
    } else if (order === 2) {
      value = s0 - 2 * s1 + s2;
    } else if (order === 3) {
      value = s0 - 3 * s1 + 3 * s2 - s3;
    } else {
      value = s0 - 4 * s1 + 6 * s2 - 4 * s3 + s4;
    }
    out[index - order] = value;
  }
  return out.subarray(0, samples.length - order);
}

function zigzag(value) {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

/** Best Rice parameter and its cost in bits for residual[start..end). */
function riceParameter(residual, start, end) {
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += zigzag(residual[index]);
  }
  const count = end - start;
  const mean = count > 0 ? sum / count : 0;
  let best = { parameter: 0, bits: Infinity };
  const guess = mean > 1 ? Math.floor(Math.log2(mean)) : 0;
  for (
    let parameter = Math.max(0, guess - 1);
    parameter <= Math.min(30, guess + 1);
    parameter++
  ) {
    const scale = 2 ** parameter;
    let bits = count * (parameter + 1);
    for (let index = start; index < end; index++) {
      bits += Math.floor(zigzag(residual[index]) / scale);
    }
    if (bits < best.bits) {
      best = { parameter, bits };
    }
  }
  return best;
}

/** Cheapest partitioning of the residual of a block of `size` samples. */
function planResidual(residual, size, order) {
  let best = null;
  for (let partitionOrder = 0; partitionOrder <= MAX_PARTITION_ORDER; ) {
    const partitions = 2 ** partitionOrder;
    if (size % partitions !== 0 || size / partitions <= order) {
      break;
    }
    const length = size / partitions;
    const parameters = [];
    let bits = 6;
    for (let partition = 0; partition < partitions; partition++) {
      const start = partition === 0 ? 0 : partition * length - order;
      const end = (partition + 1) * length - order;
      const choice = riceParameter(residual, start, end);
      parameters.push(choice.parameter);
      bits += 5 + choice.bits;
    }
    if (!best || bits < best.bits) {
      best = { partitionOrder, parameters, bits };
    }
    partitionOrder++;
  }
  return best;
}

function writeResidual(writer, residual, plan, size, order) {
  const wide = plan.parameters.some((parameter) => parameter > 14);
  writer.write(wide ? 1 : 0, 2);
  writer.write(plan.partitionOrder, 4);
  const length = size / 2 ** plan.partitionOrder;
  plan.parameters.forEach((parameter, partition) => {
    writer.write(parameter, wide ? 5 : 4);
    const start = partition === 0 ? 0 : partition * length - order;
    const end = (partition + 1) * length - order;
    const scale = 2 ** parameter;
    for (let index = start; index < end; index++) {
      const value = zigzag(residual[index]);
      writer.writeUnary(Math.floor(value / scale));
      if (parameter > 0) {
        writer.write(value % scale, parameter);
      }
    }
  });
}

function writeSubframe(writer, samples, bitDepth, scratch) {
  const size = samples.length;
  if (samples.every((value) => value === samples[0])) {
    writer.write(0, 8);
    writer.writeSigned(samples[0], bitDepth);
    return;
  }
  let best = null;
  for (let order = 0; order <= Math.min(MAX_FIXED_ORDER, size - 1); order++) {
    const residual = fixedResidual(samples, order, scratch[order]);
    const plan = planResidual(residual, size, order);
    const bits = plan ? plan.bits + order * bitDepth : Infinity;
    if (!best || bits < best.bits) {
      best = { order, residual, plan, bits };
    }
  }
  if (!best.plan || best.bits >= size * bitDepth) {
    writer.write(0b00000010, 8);
    for (const value of samples) {
      writer.writeSigned(value, bitDepth);
    }
    return;
  }
  writer.write((0b001000 | best.order) << 1, 8);
  for (let index = 0; index < best.order; index++) {
    writer.writeSigned(samples[index], bitDepth);
  }
  writeResidual(writer, best.residual, best.plan, size, best.order);
}

function writeFrame(writer, channels, number, sampleRate, bitDepth, scratch) {
  const size = channels[0].length;
  const start = writer.length;
  const sizeCode = size === BLOCK_SIZE ? 12 : size <= 256 ? 6 : 7;
  let rateCode = RATE_CODES.get(sampleRate) ?? 0;
  if (!rateCode && sampleRate % 1000 === 0 && sampleRate / 1000 < 256) {
    rateCode = 12;
  } else if (!rateCode && sampleRate < 65536) {
    rateCode = 13;
  }
  writer.write(0xfff8, 16);
  writer.write(sizeCode, 4);
  writer.write(rateCode, 4);
  writer.write(channels.length - 1, 4);
  writer.write(SAMPLE_SIZE_CODES.get(bitDepth), 3);
  writer.write(0, 1);
  writeFrameNumber(writer, number);
  if (sizeCode === 6) {
    writer.write(size - 1, 8);
  } else if (sizeCode === 7) {
    writer.write(size - 1, 16);
  }
  if (rateCode === 12) {
    writer.write(sampleRate / 1000, 8);
  } else if (rateCode === 13) {
    writer.write(sampleRate, 16);
  }
  writer.write(crc8(writer.bytes, start, writer.length), 8);
  for (const samples of channels) {
    writeSubframe(writer, samples, bitDepth, scratch);
  }
  writer.align();
  writer.write(crc16(writer.bytes, start, writer.length), 16);
  return writer.length - start;
}

/**
 * Encode a FLAC file.
 * @param {ArrayLike<number> | ArrayLike<number>[]} samples One channel or a list of channels (at most 8).
 * @param {number} sampleRate
 * @param {{bitDepth?: number}} [options] 8, 16 (default) or 24 bits.
 * @returns {Uint8Array}
 */
export function encodeFlac(samples, sampleRate, options = {}) {
  const { bitDepth } = sampleFormat(options, {
    float: false,
    depths: FLAC_BIT_DEPTHS,
  });
  const channels = toChannels(samples);
  if (channels.length > 8) {
    throw new Error('FLAC supports at most 8 channels');
  }
  if (!(sampleRate > 0 && sampleRate < 2 ** 20)) {
    throw new Error(`Unsupported FLAC sample rate ${sampleRate}`);
  }
  const total = channels[0].length;
  const integers = channels.map((channel) =>
    Int32Array.from(channel, (value) => quantize(value, bitDepth))
  );
  const writer = new BitWriter(Math.max(1024, total * channels.length * 2));
  writer.write(0x664c6143, 32);
  // STREAMINFO is the last (only) metadata block: 34 bytes.
  writer.write(0x80, 8);
  writer.write(34, 24);
  const info = writer.length;
  writer.write(BLOCK_SIZE, 16);
  writer.write(BLOCK_SIZE, 16);
  writer.write(0, 24);
  writer.write(0, 24);
  writer.write(sampleRate, 20);
  writer.write(channels.length - 1, 3);
  writer.write(bitDepth - 1, 5);
  writer.write(total, 36);
  for (let index = 0; index < 4; index++) {
    writer.write(0, 32);
  }
  const scratch = Array.from(
    { length: MAX_FIXED_ORDER + 1 },
    () => new Float64Array(BLOCK_SIZE)
  );
  let minFrame = Infinity;
  let maxFrame = 0;
  for (let start = 0, number = 0; start < total; start += BLOCK_SIZE) {
    const end = Math.min(total, start + BLOCK_SIZE);
    const block = integers.map((channel) => channel.subarray(start, end));
    const bytes = writeFrame(
      writer,
      block,
      number++,
      sampleRate,
      bitDepth,
      scratch
    );
    minFrame = Math.min(minFrame, bytes);
    maxFrame = Math.max(maxFrame, bytes);
  }
  const file = writer.result();
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (maxFrame > 0) {
    view.setUint16(info + 4, minFrame >> 8);
    view.setUint8(info + 6, minFrame & 0xff);
    view.setUint16(info + 7, maxFrame >> 8);
    view.setUint8(info + 9, maxFrame & 0xff);
  }
  return file;
}

function readResidual(reader, out, size, order) {
  const method = reader.read(2);
  if (method > 1) {
    throw new Error(`Unsupported FLAC residual coding ${method}`);
  }
  const parameterBits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 15 : 31;
  const partitionOrder = reader.read(4);
  const partitions = 2 ** partitionOrder;
  let index = order;
  for (let partition = 0; partition < partitions; partition++) {
    const count = size / partitions - (partition === 0 ? order : 0);
    const parameter = reader.read(parameterBits);
    if (parameter === escape) {
      const bits = reader.read(5);
      for (let item = 0; item < count; item++) {
        out[index++] = reader.readSigned(bits);
      }
      continue;
    }
    const scale = 2 ** parameter;
    for (let item = 0; item < count; item++) {
      const value = reader.readUnary() * scale + reader.read(parameter);
      out[index++] = value % 2 === 0 ? value / 2 : -(value + 1) / 2;
    }
  }
}

const FIXED_COEFFICIENTS = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];

function predict(out, order, coefficients, shift, size) {
  const scale = 2 ** shift;
  for (let index = order; index < size; index++) {
    let sum = 0;
    for (let tap = 0; tap < order; tap++) {
      sum += coefficients[tap] * out[index - tap - 1];
    }
    out[index] += Math.floor(sum / scale);
  }
}

function readSubframe(reader, size, bitDepth) {
  if (reader.read(1) !== 0) {
    throw new Error('Invalid FLAC subframe padding');
  }
  const type = reader.read(6);
  let wasted = 0;
  if (reader.read(1) === 1) {
    wasted = reader.readUnary() + 1;
  }
  const bits = bitDepth - wasted;
  const out = new Float64Array(size);
  if (type === 0) {
    out.fill(reader.readSigned(bits));
  } else if (type === 1) {
    for (let index = 0; index < size; index++) {
      out[index] = reader.readSigned(bits);
    }
  } else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let index = 0; index < order; index++) {
      out[index] = reader.readSigned(bits);
    }
    readResidual(reader, out, size, order);
    predict(out, order, FIXED_COEFFICIENTS[order], 0, size);
  } else if (type >= 32) {
    const order = type - 31;
    for (let index = 0; index < order; index++) {
      out[index] = reader.readSigned(bits);
    }
    const precision = reader.read(4) + 1;
    if (precision === 16) {
      throw new Error('Invalid FLAC LPC precision');
    }
    const shift = reader.readSigned(5);
    const coefficients = [];
    for (let index = 0; index < order; index++) {
      coefficients.push(reader.readSigned(precision));
    }
    readResidual(reader, out, size, order);
    predict(out, order, coefficients, Math.max(0, shift), size);
  } else {
    throw new Error(`Reserved FLAC subframe type ${type}`);
  }
  if (wasted > 0) {
    for (let index = 0; index < size; index++) {
      out[index] *= 2 ** wasted;
    }
  }
  return out;
}

function readFrameNumber(reader) {
  const first = reader.read(8);
  let extra = 0;
  while (extra < 7 && first & (0x80 >> extra)) {
    extra++;
  }
  for (let index = 1; index < extra; index++) {
    reader.read(8);
  }
}

function blockSize(code, reader) {
  if (code === 1) {
    return 192;
  }
  if (code >= 2 && code <= 5) {
    return 576 * 2 ** (code - 2);
  }
  if (code === 6) {
    return reader.read(8) + 1;
  }
  if (code === 7) {
    return reader.read(16) + 1;
  }
  if (code >= 8) {
    return 256 * 2 ** (code - 8);
  }
  throw new Error('Reserved FLAC block size');
}

function frameRate(code, reader, fallback) {
  if (code === 0 || code === 15) {
    return fallback;
  }
  if (code <= 11) {
    return RATES[code];
  }
  if (code === 12) {
    return reader.read(8) * 1000;
  }
  return reader.read(16) * (code === 13 ? 1 : 10);
}

function decorrelate(assignment, subframes) {
  const [first, second] = subframes;
  if (assignment === 8) {
    for (let index = 0; index < first.length; index++) {
      second[index] = first[index] - second[index];
    }
  } else if (assignment === 9) {
    for (let index = 0; index < first.length; index++) {
      first[index] += second[index];
    }
  } else if (assignment === 10) {
    for (let index = 0; index < first.length; index++) {
      const side = second[index];
      const mid = first[index] * 2 + (side & 1);
      first[index] = (mid + side) / 2;
      second[index] = (mid - side) / 2;
    }
  }
}

function readFrame(reader, info) {
  const start = reader.position;
  const sync = reader.read(15);
  if (sync !== 0x7ffc) {
    throw new Error('Lost FLAC frame sync');
  }
  reader.read(1);
  const sizeCode = reader.read(4);
  const rateCode = reader.read(4);
  const assignment = reader.read(4);
  const sizeBitsCode = reader.read(3);
  reader.read(1);
  readFrameNumber(reader);
  const size = blockSize(sizeCode, reader);
  frameRate(rateCode, reader, info.sampleRate);
  reader.read(8);
  const bitDepth = SAMPLE_SIZES[sizeBitsCode] || info.bitDepth;
  const channels = assignment < 8 ? assignment + 1 : 2;
  if (assignment > 10) {
    throw new Error('Reserved FLAC channel assignment');
  }
  const subframes = [];
  for (let channel = 0; channel < channels; channel++) {
    const side =
      (assignment === 8 && channel === 1) ||
      (assignment === 9 && channel === 0) ||
      (assignment === 10 && channel === 1);
    subframes.push(readSubframe(reader, size, bitDepth + (side ? 1 : 0)));
  }
  reader.align();
  const crc = crc16(reader.bytes, start, reader.position);
  if (reader.read(16) !== crc) {
    throw new Error('FLAC frame CRC mismatch');
  }
  decorrelate(assignment, subframes);
  return { subframes, bitDepth };
}

/**
 * Offset of the 'fLaC' marker: 0, or the size of a leading ID3v2 tag.
 * @param {Uint8Array} bytes
 */
export function flacStart(bytes) {
  if (bytes.length < 10 || !readTag(bytes, 0).startsWith('ID3')) {
    return 0;
  }
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return 10 + size;
}

/**
 * Decode a FLAC file to mono floats (all channels are averaged).
 * @param {Uint8Array} bytes
 * @returns {{sampleRate: number, samples: Float32Array, channels: number, bitDepth: number, float: boolean}}
 */
export function decodeFlac(bytes) {
  const position = flacStart(bytes);
  if (readTag(bytes, position) !== 'fLaC') {
    throw new Error('Not a FLAC file');
  }
  const reader = new BitReader(bytes, position + 4);
  const info = { sampleRate: 0, channels: 1, bitDepth: 16, total: 0 };
  let last = false;
  while (!last) {
    last = reader.read(1) === 1;
    const type = reader.read(7);
    const length = reader.read(24);
    const next = reader.position + length;
    if (type === 0) {
      reader.read(16 + 16 + 24 + 24);
      info.sampleRate = reader.read(20);
      info.channels = reader.read(3) + 1;
      info.bitDepth = reader.read(5) + 1;
      info.total = reader.read(36);
    }
    reader.position = next;
  }
  const blocks = [];
  let frames = 0;
  while (reader.position + 2 <= bytes.length) {
    if (bytes[reader.position] !== 0xff) {
      break;
    }
    const { subframes, bitDepth } = readFrame(reader, info);
    const scale = 2 ** (bitDepth - 1);
    const interleaved = new Float64Array(
      subframes[0].length * subframes.length
    );
    subframes.forEach((channel, index) => {
      for (let frame = 0; frame < channel.length; frame++) {
        interleaved[frame * subframes.length + index] = channel[frame] / scale;
      }
    });
    blocks.push(mixdown(interleaved, subframes.length));
    frames += subframes[0].length;
  }
  const samples = new Float32Array(
    info.total ? Math.min(info.total, frames) : frames
  );
  let offset = 0;
  for (const block of blocks) {
    const take = Math.min(block.length, samples.length - offset);
    samples.set(block.subarray(0, take), offset);
    offset += take;
  }
  return {
    sampleRate: info.sampleRate,
    samples,
    channels: info.channels,
    bitDepth: info.bitDepth,
    float: false,
  };
}
