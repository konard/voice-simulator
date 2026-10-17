/**
 * Audio formats (issue 5): WAV, AIFF/AIFF-C, AU, FLAC and raw PCM encoders,
 * decoders, the format sniffer, streaming encoders and resampling.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  AUDIO_FORMATS,
  AUDIO_FORMAT_NAMES,
  audioStreamEncoder,
  decodeAiff,
  decodeAu,
  decodeAudio,
  decodeFlac,
  decodeWav,
  detectAudioFormat,
  encodeAiff,
  encodeAudio,
  encodeAu,
  encodeFlac,
  encodeWav,
  formatFromFileName,
  resample,
  wavHeader,
} from '../src/index.js';
import { readExtended, writeExtended } from '../src/audio/aiff.js';
import { auHeader } from '../src/audio/au.js';

function tone(length, seed = 1) {
  let state = seed;
  return Float32Array.from({ length }, (_, index) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    const noise = (state / 2147483648 - 0.5) * 0.05;
    return 0.6 * Math.sin(index / 7) + 0.25 * Math.sin(index / 1.7) + noise;
  });
}

function maxError(a, b) {
  let error = 0;
  for (let index = 0; index < a.length; index++) {
    error = Math.max(error, Math.abs(a[index] - b[index]));
  }
  return error;
}

function sameBytes(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function tag(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

const CODECS = {
  wav: [encodeWav, decodeWav],
  aiff: [encodeAiff, decodeAiff],
  au: [encodeAu, decodeAu],
  flac: [encodeFlac, decodeFlac],
};

describe('audio format round trips', () => {
  const left = tone(5003, 1);
  const right = tone(5003, 2);
  for (const [name, [encode, decode]] of Object.entries(CODECS)) {
    const format = AUDIO_FORMATS[name];
    const encodings = [
      ...format.bitDepths.map((bitDepth) => ({ bitDepth })),
      ...format.floatBitDepths.map((bitDepth) => ({ bitDepth, float: true })),
    ];
    for (const options of encodings) {
      const label = `${options.float ? 'float' : 'int'} ${options.bitDepth}`;
      it(`${name} ${label}: lossless after quantisation`, () => {
        const bytes = encode(left, 22050, options);
        const decoded = decode(bytes);
        expect(decoded.sampleRate).toBe(22050);
        expect(decoded.samples.length).toBe(left.length);
        expect(decoded.bitDepth).toBe(options.bitDepth);
        expect(decoded.float).toBe(Boolean(options.float));
        const step = options.float ? 0 : 2 ** (1 - options.bitDepth);
        // Float32Array rounding adds at most 2^-24 to the quantisation step.
        expect(maxError(decoded.samples, left) <= step / 2 + 2 ** -24).toBe(
          true
        );
        // Decoding and re-encoding gives back the same file.
        expect(sameBytes(encode(decoded.samples, 22050, options), bytes)).toBe(
          true
        );
      });
      it(`${name} ${label}: mixes stereo down to mono`, () => {
        const decoded = decode(encode([left, right], 16000, options));
        expect(decoded.channels).toBe(2);
        const mono = Float32Array.from(
          left,
          (value, index) => (value + right[index]) / 2
        );
        const step = options.float ? 0 : 2 ** (1 - options.bitDepth);
        expect(maxError(decoded.samples, mono) <= step + 2 ** -23).toBe(true);
      });
    }
  }

  it('keeps encodeWav backward compatible (16-bit, 44-byte header)', () => {
    const bytes = encodeWav(new Float32Array(10), 16000);
    expect(bytes.length).toBe(44 + 20);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(wavHeader(48000).length).toBe(44);
  });

  it('round-trips raw PCM with explicit layout', () => {
    const bytes = encodeAudio([left, right], 8000, {
      format: 'raw',
      bitDepth: 24,
    });
    expect(bytes.length).toBe(left.length * 2 * 3);
    expect(detectAudioFormat(bytes)).toBe(null);
    const decoded = decodeAudio(bytes, {
      format: 'raw',
      sampleRate: 8000,
      channels: 2,
      bitDepth: 24,
    });
    expect(decoded.format).toBe('raw');
    expect(decoded.samples.length).toBe(left.length);
    const f32 = encodeAudio(left, 8000, { format: 'raw', float: true });
    expect(new Float32Array(f32.buffer)[3]).toBe(left[3]);
  });

  it('compresses speech-like audio with FLAC', () => {
    const smooth = Float32Array.from(
      { length: 16000 },
      (_, index) =>
        0.5 * Math.sin(index / 20) * Math.sin(index / 900) +
        0.1 * Math.sin(index / 6)
    );
    const flac = encodeFlac(smooth, 16000);
    const wav = encodeWav(smooth, 16000);
    expect(flac.length < wav.length * 0.6).toBe(true);
    const silence = encodeFlac(new Float32Array(10000), 16000);
    expect(silence.length < 100).toBe(true);
    expect(decodeFlac(silence).samples.length).toBe(10000);
  });
});

describe('WAV decoder robustness', () => {
  function riff(chunks) {
    const parts = chunks.map(([id, body]) => {
      const padded = new Uint8Array(8 + body.length + (body.length % 2));
      const view = new DataView(padded.buffer);
      for (let index = 0; index < 4; index++) {
        padded[index] = id.charCodeAt(index);
      }
      view.setUint32(4, body.length, true);
      padded.set(body, 8);
      return padded;
    });
    const total = 12 + parts.reduce((sum, part) => sum + part.length, 0);
    const file = new Uint8Array(total);
    file.set(
      [...'RIFF'].map((c) => c.charCodeAt(0)),
      0
    );
    new DataView(file.buffer).setUint32(4, total - 8, true);
    file.set(
      [...'WAVE'].map((c) => c.charCodeAt(0)),
      8
    );
    let offset = 12;
    for (const part of parts) {
      file.set(part, offset);
      offset += part.length;
    }
    return file;
  }

  function fmt(tag, channels, rate, bits) {
    const body = new Uint8Array(16);
    const view = new DataView(body.buffer);
    view.setUint16(0, tag, true);
    view.setUint16(2, channels, true);
    view.setUint32(4, rate, true);
    view.setUint32(8, (rate * channels * bits) / 8, true);
    view.setUint16(12, (channels * bits) / 8, true);
    view.setUint16(14, bits, true);
    return body;
  }

  it('walks chunks with odd sizes and padding', () => {
    const file = riff([
      ['LIST', new Uint8Array([1, 2, 3])],
      ['fmt ', fmt(1, 1, 11025, 8)],
      ['junk', new Uint8Array(5)],
      ['data', new Uint8Array([128, 255, 0])],
      ['id3 ', new Uint8Array(1)],
    ]);
    const decoded = decodeWav(file);
    expect(decoded.sampleRate).toBe(11025);
    expect(Array.from(decoded.samples)).toEqual([0, 127 / 128, -1]);
  });

  it('reads extensible headers and multi-channel files', () => {
    const channels = [tone(300, 1), tone(300, 2), tone(300, 3)];
    const bytes = encodeWav(channels, 48000, { bitDepth: 24 });
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16, true)).toBe(40);
    expect(view.getUint16(20, true)).toBe(0xfffe);
    expect(view.getUint16(44, true)).toBe(1);
    const decoded = decodeWav(bytes);
    expect(decoded.channels).toBe(3);
    const mono = channels[0].map(
      (value, index) => (value + channels[1][index] + channels[2][index]) / 3
    );
    expect(maxError(decoded.samples, mono) < 1e-6).toBe(true);
  });

  it('writes IEEE float with a fact chunk', () => {
    const bytes = encodeWav(tone(10), 8000, { float: true });
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(20, true)).toBe(3);
    expect(tag(bytes, 38)).toBe('fact');
    expect(view.getUint32(46, true)).toBe(10);
  });

  it('decodes G.711 mu-law and A-law', () => {
    const mulaw = decodeWav(
      riff([
        ['fmt ', fmt(7, 1, 8000, 8)],
        ['data', new Uint8Array([0xff, 0x80, 0x00])],
      ])
    );
    expect(Array.from(mulaw.samples)).toEqual([
      0,
      32124 / 32768,
      -32124 / 32768,
    ]);
    const alaw = decodeWav(
      riff([
        ['fmt ', fmt(6, 1, 8000, 8)],
        ['data', new Uint8Array([0xd5, 0x55, 0x2a])],
      ])
    );
    expect(Array.from(alaw.samples)).toEqual([
      8 / 32768,
      -8 / 32768,
      -32256 / 32768,
    ]);
  });

  it('rejects broken files', () => {
    expect(() => decodeWav(riff([['data', new Uint8Array(4)]]))).toThrow();
    expect(() => decodeWav(riff([['fmt ', fmt(2, 1, 8000, 4)]]))).toThrow();
    expect(() => decodeWav(new Uint8Array(12))).toThrow();
  });
});

describe('AIFF and AU details', () => {
  it('stores sample rates as 80-bit extended floats', () => {
    const bytes = new Uint8Array(10);
    const view = new DataView(bytes.buffer);
    writeExtended(view, 0, 44100);
    expect(Array.from(bytes)).toEqual([
      0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0,
    ]);
    for (const rate of [8000, 11025, 22050, 48000, 96000, 12345.5]) {
      writeExtended(view, 0, rate);
      expect(readExtended(view, 0)).toBe(rate);
    }
  });

  it('writes float AIFF as AIFF-C', () => {
    const bytes = encodeAiff(tone(8), 8000, { float: true });
    expect(tag(bytes, 8)).toBe('AIFC');
    expect(tag(bytes, 12)).toBe('FVER');
    expect(tag(bytes, 24)).toBe('COMM');
    expect(tag(bytes, 24 + 26)).toBe('fl32');
    expect(tag(encodeAiff(tone(8), 8000), 8)).toBe('AIFF');
  });

  it('reads AU streams of unknown length', () => {
    const samples = tone(100);
    const body = encodeAu(samples, 8000).subarray(24);
    const file = new Uint8Array(24 + body.length);
    file.set(auHeader(8000), 0);
    file.set(body, 24);
    const decoded = decodeAu(file);
    expect(decoded.samples.length).toBe(100);
    expect(maxError(decoded.samples, samples) < 1e-4).toBe(true);
  });
});

/** MSB-first bit writer for hand-built FLAC streams. */
function bitStream() {
  const bytes = [];
  let acc = 0;
  let count = 0;
  const stream = {
    put(value, bits) {
      for (let bit = bits - 1; bit >= 0; bit--) {
        acc = acc * 2 + (Math.floor(value / 2 ** bit) % 2);
        if (++count === 8) {
          bytes.push(acc);
          acc = 0;
          count = 0;
        }
      }
    },
    signed(value, bits) {
      stream.put(value < 0 ? value + 2 ** bits : value, bits);
    },
    unary(zeros) {
      stream.put(1, zeros + 1);
    },
    align() {
      while (count !== 0) {
        stream.put(0, 1);
      }
    },
    bytes: () => Uint8Array.from(bytes),
  };
  return stream;
}

function crc(bytes, polynomial, width) {
  const mask = 2 ** width - 1;
  let value = 0;
  for (const byte of bytes) {
    value ^= byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) {
      value =
        value & (1 << (width - 1)) ? (value << 1) ^ polynomial : value << 1;
      value &= mask;
    }
  }
  return value;
}

/**
 * A FLAC file using what the encoder never writes: mid/side stereo, an LPC
 * subframe, Rice2 with an escaped partition and wasted bits.
 */
function handBuiltFlac(left, right) {
  const mid = left.map((value, index) =>
    Math.floor((value + right[index]) / 2)
  );
  const side = left.map((value, index) => value - right[index]);
  const out = bitStream();
  out.put(0x664c6143, 32);
  out.put(1, 1);
  out.put(0, 7);
  out.put(34, 24);
  out.put(8, 16);
  out.put(8, 16);
  out.put(0, 48);
  out.put(8000, 20);
  out.put(1, 3);
  out.put(15, 5);
  out.put(left.length, 36);
  out.put(0, 128);
  const frameStart = out.bytes().length;
  out.put(0xfff8, 16);
  out.put(6, 4); // 8-bit block size follows
  out.put(4, 4); // 8 kHz
  out.put(10, 4); // mid/side
  out.put(4, 3); // 16 bits
  out.put(0, 1);
  out.put(0, 8); // frame 0
  out.put(left.length - 1, 8);
  out.put(crc(out.bytes().subarray(frameStart), 0x07, 8), 8);
  // Mid: LPC order 2, 4-bit coefficients [3, -1], shift 1.
  out.put(0, 1);
  out.put(33, 6);
  out.put(0, 1);
  out.signed(mid[0], 16);
  out.signed(mid[1], 16);
  out.put(3, 4);
  out.signed(1, 5);
  out.signed(3, 4);
  out.signed(-1, 4);
  const residual = mid.map((value, index) =>
    index < 2
      ? 0
      : value - Math.floor((3 * mid[index - 1] - mid[index - 2]) / 2)
  );
  out.put(1, 2); // Rice2
  out.put(1, 4); // two partitions
  out.put(2, 5);
  for (let index = 2; index < 4; index++) {
    const value = residual[index];
    const folded = value >= 0 ? value * 2 : -value * 2 - 1;
    out.unary(Math.floor(folded / 4));
    out.put(folded % 4, 2);
  }
  out.put(31, 5); // escape: raw signed residuals
  out.put(14, 5);
  for (let index = 4; index < 8; index++) {
    out.signed(residual[index], 14);
  }
  // Side (17 bits): verbatim with 2 wasted bits.
  out.put(0, 1);
  out.put(1, 6);
  out.put(1, 1);
  out.unary(1);
  for (const value of side) {
    out.signed(value / 4, 15);
  }
  out.align();
  out.put(crc(out.bytes().subarray(frameStart), 0x8005, 16), 16);
  return out.bytes();
}

describe('FLAC decoder', () => {
  const left = [1000, 1200, 1100, 900, -500, -800, 300, 4000];
  const side = [4, 8, -4, 12, 0, 4, -8, 16];
  const right = left.map((value, index) => value - side[index]);

  it('decodes mid/side, LPC, Rice2, escapes and wasted bits', () => {
    const decoded = decodeFlac(handBuiltFlac(left, right));
    expect(decoded.channels).toBe(2);
    expect(decoded.sampleRate).toBe(8000);
    const expected = left.map((value, index) =>
      Math.fround((value + right[index]) / 2 / 32768)
    );
    expect(Array.from(decoded.samples)).toEqual(expected);
  });

  it('checks frame CRCs and skips ID3 tags', () => {
    const bytes = encodeFlac(tone(500), 8000);
    const tagged = new Uint8Array(bytes.length + 20);
    tagged.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10], 0);
    tagged.set(bytes, 20);
    expect(detectAudioFormat(tagged)).toBe('flac');
    expect(decodeAudio(tagged).samples.length).toBe(500);
    const broken = bytes.slice();
    broken[broken.length - 10] ^= 0x40;
    expect(() => decodeFlac(broken)).toThrow();
  });

  it('encodes 24-bit noise with wide Rice parameters losslessly', () => {
    const noise = Float32Array.from(tone(9000, 7), (value) => value * 0.99);
    const decoded = decodeFlac(encodeFlac(noise, 96000, { bitDepth: 24 }));
    expect(decoded.sampleRate).toBe(96000);
    expect(maxError(decoded.samples, noise) <= 2 ** -24 + 2 ** -24).toBe(true);
  });
});

describe('audio format registry', () => {
  it('lists every format with a MIME type and extension', () => {
    expect(AUDIO_FORMAT_NAMES).toEqual(['wav', 'flac', 'aiff', 'au', 'raw']);
    expect(AUDIO_FORMATS.flac.mimeType).toBe('audio/flac');
    expect(AUDIO_FORMATS.au.mimeType).toBe('audio/basic');
    expect(AUDIO_FORMATS.wav.extension).toBe('wav');
  });

  it('detects containers and decodes them', () => {
    const samples = tone(64);
    for (const name of ['wav', 'aiff', 'au', 'flac']) {
      const bytes = encodeAudio(samples, 16000, { format: name });
      expect(detectAudioFormat(bytes)).toBe(name);
      const decoded = decodeAudio(bytes.buffer);
      expect(decoded.format).toBe(name);
      expect(decoded.samples.length).toBe(64);
    }
    expect(() => decodeAudio(new Uint8Array(64))).toThrow();
  });

  it('infers formats from file names', () => {
    expect(formatFromFileName('voice.FLAC')).toBe('flac');
    expect(formatFromFileName('a/b/voice.aif')).toBe('aiff');
    expect(formatFromFileName('voice.snd')).toBe('au');
    expect(formatFromFileName('voice.pcm')).toBe('raw');
    expect(formatFromFileName('voice.mp3')).toBe(null);
    expect(formatFromFileName('voice')).toBe(null);
  });

  it('rejects encodings a format cannot store', () => {
    const samples = tone(10);
    expect(() =>
      encodeAudio(samples, 8000, { format: 'flac', float: true })
    ).toThrow();
    expect(() =>
      encodeAudio(samples, 8000, { format: 'flac', bitDepth: 32 })
    ).toThrow();
    expect(() => encodeAudio(samples, 8000, { bitDepth: 12 })).toThrow();
    expect(() => encodeAudio(samples, 8000, { format: 'mp3' })).toThrow();
    expect(encodeAudio(samples, 8000, { bitDepth: '24' }).length).toBe(68 + 30);
  });

  it('streams WAV, AU and raw chunk by chunk', () => {
    const samples = tone(1000);
    for (const name of ['wav', 'au', 'raw']) {
      const stream = audioStreamEncoder(name, 16000, { bitDepth: 24 });
      expect(stream.mimeType).toBe(AUDIO_FORMATS[name].mimeType);
      const parts = [
        stream.header,
        stream.encode(samples.subarray(0, 300)),
        stream.encode(samples.subarray(300)),
      ];
      const file = new Uint8Array(
        parts.reduce((sum, part) => sum + part.length, 0)
      );
      let offset = 0;
      for (const part of parts) {
        file.set(part, offset);
        offset += part.length;
      }
      const decoded = decodeAudio(file, {
        format: name,
        sampleRate: 16000,
        bitDepth: 24,
      });
      expect(decoded.samples.length).toBe(1000);
      expect(maxError(decoded.samples, samples) < 1e-6).toBe(true);
    }
    expect(() => audioStreamEncoder('flac', 16000)).toThrow();
  });
});

describe('resampling', () => {
  function sine(rate, frequency, length) {
    return Float32Array.from({ length }, (_, index) =>
      Math.sin((2 * Math.PI * frequency * index) / rate)
    );
  }

  it('converts between rates without audible error', () => {
    for (const [from, to] of [
      [48000, 16000],
      [16000, 44100],
      [22050, 48000],
    ]) {
      const output = resample(sine(from, 440, from / 10), from, to);
      expect(output.length).toBe(to / 10);
      const expected = sine(to, 440, output.length);
      // Ignore the filter's edge effects.
      const margin = Math.ceil(to / 200);
      const error = maxError(
        output.subarray(margin, -margin),
        expected.subarray(margin, -margin)
      );
      expect(error < 1e-3).toBe(true);
    }
  });

  it('removes content above the new Nyquist frequency', () => {
    const output = resample(sine(48000, 12000, 4800), 48000, 16000);
    let peak = 0;
    for (let index = 200; index < output.length - 200; index++) {
      peak = Math.max(peak, Math.abs(output[index]));
    }
    expect(peak < 0.01).toBe(true);
  });
});
