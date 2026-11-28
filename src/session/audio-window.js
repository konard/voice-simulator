/** Sample-indexed window and block pitch measurements, independent of push boundaries. Unlicense. */
import { withFrameStorage } from '../recognition/frame-storage.js';
import { analyzePitchFrames } from '../recognition/frontend.js';
import { trackPitchFrames } from '../recognition/pitch.js';

export function createAudioWindow(capacity) {
  const buffer = new Float32Array(capacity);
  let end = 0;
  return {
    get end() {
      return end;
    },
    clear() {
      end = 0;
    },
    push(chunk) {
      const start = end + Math.max(0, chunk.length - capacity);
      const slice = chunk.subarray(start - end);
      const index = start % capacity;
      const split = Math.min(slice.length, capacity - index);
      buffer.set(slice.subarray(0, split), index);
      buffer.set(slice.subarray(split), 0);
      end += chunk.length;
    },
    read(count = capacity, through = end) {
      const start = Math.max(end - capacity, through - count, 0);
      const output = new Float32Array(through - start);
      const index = start % capacity;
      const split = Math.min(output.length, capacity - index);
      output.set(buffer.subarray(index, index + split));
      output.set(buffer.subarray(0, output.length - split), split);
      return output;
    },
  };
}

/** A one-shot recording appends into a fixed buffer. Earlier reads stay valid. */
export function createRecordingWindow(capacity) {
  const buffer = new Float32Array(capacity);
  let base = 0;
  let cursor = 0;
  return {
    get end() {
      return cursor - base;
    },
    clear() {
      base = cursor;
    },
    push(chunk) {
      buffer.set(chunk, cursor);
      cursor += chunk.length;
    },
    read(count = capacity, through = cursor - base) {
      return buffer.subarray(
        base + Math.max(0, through - count),
        base + through
      );
    },
  };
}

const PITCH_FRAMES = { hop: 0.01, rate: 8000 };

export function blockPitch(window, sampleRate, from, through, offset) {
  const count = Math.min(through, Math.ceil(0.4 * sampleRate));
  const samples = window.read(count, through);
  const start = through - samples.length;
  if (!samples.some((value) => Math.abs(value) >= 1e-5)) {
    return [];
  }
  const pitch = withFrameStorage((storage) =>
    trackPitchFrames(
      analyzePitchFrames(samples, sampleRate, PITCH_FRAMES, storage)
    )
  );
  const voiced = [];
  for (let row = 0; row < pitch.count; row++) {
    const sample = start + Math.round(row * pitch.hop * sampleRate);
    if (sample >= from && sample < through && pitch.f0[row] > 0) {
      voiced.push({ time: (offset + sample) / sampleRate, f0: pitch.f0[row] });
    }
  }
  return voiced;
}
