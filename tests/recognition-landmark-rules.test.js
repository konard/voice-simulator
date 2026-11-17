/** Analytic feature inputs isolate the rules from the synthesizer's
 * acoustic/segment alignment. Speech quality is measured separately. */
import { describe, it, expect } from 'test-anywhere';
import {
  createLandmarkDetector,
  findLandmarks,
} from '../src/recognition/landmarks.js';
import {
  classifyFrame,
  cleanClasses,
} from '../src/recognition/landmark-signals.js';
import { LANDMARK_THRESHOLDS as T } from '../src/recognition/landmark-thresholds.js';
import { ruleFrames } from './helpers/landmark-frames.js';

describe('landmark signal rules', () => {
  it('takes each branch of the ordered broad-class tree', () => {
    const frames = ruleFrames();
    const s = new Float32Array(frames.count).fill(0);
    const classify = (burst = false) =>
      classifyFrame(frames, s, 0, 10, burst, T);
    frames.speech[0] = 0;
    frames.energy[0] = frames.noise[0];
    expect(classify()).toBe(0);
    frames.speech[0] = 1;
    frames.periodicity[0] = 0;
    expect(classify()).toBe(5);
    expect(classify(true)).toBe(7);
    frames.periodicity[0] = 1;
    frames.zcr[0] = T.fricativeZcr + 0.01;
    expect(classify()).toBe(4);
    frames.zcr[0] = 0;
    frames.gravity[0] = T.fricativeGravity + 1;
    expect(classify()).toBe(4);
    frames.gravity[0] = 0;
    frames.band[0] = frames.band[2] + T.nasalDrop + 1;
    expect(classify()).toBe(3);
    frames.band[0] = frames.band[2];
    expect(classify()).toBe(2);
    s[0] = 10;
    expect(classify()).toBe(1);
  });

  it('finds both signs of voicing, sonorant and burst band transitions', () => {
    for (const hop of [0.005, 0.01]) {
      for (const kind of ['g', 's', 'b']) {
        const frames = ruleFrames(hop);
        const bands = kind === 'g' ? [0] : [1, 2, 3];
        for (let t = 0; t < frames.count; t++) {
          const time = t * hop;
          const db =
            15 *
            (Math.tanh((time - 0.2) / 0.007) - Math.tanh((time - 0.5) / 0.007));
          for (const band of bands) {
            frames.band[t * 6 + band] = -40 + db;
          }
          frames.periodicity[t] =
            kind === 'g'
              ? time >= 0.2 && time < 0.5
                ? 0.9
                : 0
              : kind === 's'
                ? 0.9
                : 0;
        }
        const result = findLandmarks(frames);
        expect(result.landmarks.length).toBe(2);
        for (const [i, time] of [0.2, 0.5].entries()) {
          const landmark = result.landmarks[i];
          expect(landmark.type).toBe(`${kind}${i === 0 ? '+' : '-'}`);
          expect(Math.abs(landmark.time - time) <= hop).toBe(true);
          expect(landmark.strength > 29 && landmark.strength <= 30).toBe(true);
        }
        // Below-threshold rises and groups of fewer than three bands
        // must not produce events of these types.
        expect(
          findLandmarks(frames, {
            thresholds: { landmarkRise: 31 },
          }).landmarks.length
        ).toBe(0);
        if (kind !== 'g') {
          for (let t = 0; t < frames.count; t++) {
            frames.band[t * 6 + 3] = -40;
          }
        } else {
          frames.periodicity.fill(0.9);
        }
        expect(findLandmarks(frames).landmarks.length).toBe(0);
      }
    }
  });

  it('finds separated voiced energy peaks and rejects unvoiced or noisy peaks', () => {
    for (const hop of [0.005, 0.01]) {
      const frames = ruleFrames(hop);
      for (let t = 0; t < frames.count; t++) {
        const distance = Math.min(
          Math.abs(t * hop - 0.2),
          Math.abs(t * hop - 0.5)
        );
        const db = Math.max(-100, 20 - distance * 1000);
        frames.mel.fill(
          (db * Math.LN10) / 10,
          t * frames.melBands,
          (t + 1) * frames.melBands
        );
      }
      const batch = findLandmarks(frames);
      expect(batch.nuclei.length).toBe(2);
      for (const [i, time] of [0.2, 0.5].entries()) {
        expect(Math.abs(batch.nuclei[i].time - time) <= hop).toBe(true);
      }
      const count = frames.count;
      frames.count = 0;
      const detector = createLandmarkDetector(frames);
      const returned = [];
      while (frames.count < count) {
        frames.count = Math.min(count, frames.count + Math.round(0.02 / hop));
        for (const nucleus of detector.advance()) {
          expect(frames.count * hop - nucleus.time <= 0.15).toBe(true);
          returned.push(nucleus);
        }
      }
      returned.push(...detector.advance(true));
      expect(returned.map((n) => n.time)).toEqual(
        batch.nuclei.map((n) => n.time)
      );
      frames.periodicity.fill(0.44);
      expect(findLandmarks(frames).nuclei.length).toBe(0);
      frames.periodicity.fill(0.9);
      frames.noise.fill(40);
      expect(findLandmarks(frames).nuclei.length).toBe(0);
    }
  });

  it('uses a median, bounded closures and the longer neighbouring run', () => {
    const raw = new Uint8Array(120).fill(1);
    raw[10] = 5;
    raw.fill(0, 30, 50);
    raw.fill(0, 70, 100);
    const classes = cleanClasses(raw, raw.length, 0.005);
    expect(classes[10]).toBe(1);
    expect(Array.from(classes.subarray(30, 50))).toEqual(Array(20).fill(6));
    expect(Array.from(classes.subarray(70, 100))).toEqual(Array(30).fill(0));
    const short = new Uint8Array(50).fill(1);
    short.fill(3, 40, 43);
    short.fill(2, 43);
    expect(cleanClasses(short, short.length, 0.002)[41]).toBe(1);
  });
});
