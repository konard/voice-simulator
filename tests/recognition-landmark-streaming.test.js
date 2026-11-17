import { describe, it, expect } from 'test-anywhere';
import {
  createLandmarkDetector,
  findLandmarks,
} from '../src/recognition/landmarks.js';
import { candidateFrames } from './helpers/landmark-frames.js';
import {
  analyzeFrames,
  createFrameAnalyzer,
} from '../src/recognition/frontend.js';
import { createNucleusScanner } from '../src/recognition/landmark-nuclei.js';

describe('streaming landmark suppression', () => {
  it('preserves earlier suppression and neighbouring bands across windows', () => {
    for (const hop of [0.005, 0.01]) {
      const frames = candidateFrames();
      frames.hop = hop;
      frames.startTime = 1.25;
      const count = frames.count;
      const batch = findLandmarks(frames).landmarks;
      expect(batch.length > 0).toBe(true);
      for (const chunk of [1, 2, 4, 8]) {
        frames.count = 0;
        const detector = createLandmarkDetector(frames);
        let saved = [];
        while (frames.count < count) {
          frames.count = Math.min(count, frames.count + chunk);
          detector.advance();
          expect(detector.output.landmarks.slice(0, saved.length)).toEqual(
            saved
          );
          saved = detector.output.landmarks.slice();
        }
        detector.advance(true);
        expect(detector.output.landmarks).toEqual(batch);
        const previous = new Map();
        for (const landmark of detector.output.landmarks) {
          expect(
            landmark.time - (previous.get(landmark.type) ?? -Infinity) >=
              0.02 - 1e-9
          ).toBe(true);
          previous.set(landmark.type, landmark.time);
        }
      }
    }
  });
});

describe('landmark streaming commitments', () => {
  it('keeps a confirmed nucleus when a higher peak follows within 80 ms', () => {
    const hop = 0.005;
    const s = new Float32Array(80).fill(-20);
    const points = [
      [0, -20],
      [20, 0],
      [24, -6],
      [28, -6],
      [32, 2],
      [40, -20],
    ];
    for (let i = 1; i < points.length; i++) {
      const [left, low] = points[i - 1];
      const [right, high] = points[i];
      for (let t = left; t <= right; t++) {
        s[t] = low + ((high - low) * (t - left)) / (right - left);
      }
    }
    const frames = {
      hop,
      count: 29,
      noise: new Float32Array(80).fill(-80),
      speech: new Uint8Array(80).fill(1),
      periodicity: new Float32Array(80).fill(0.9),
    };
    const output = { startTime: 0, sonority: s, nuclei: [] };
    const scan = createNucleusScanner(frames, output, {
      nucleusAboveNoise: 10,
      nucleusDip: 2,
    });
    const emitted = [];
    scan(21, emitted, false);
    expect(emitted.map((n) => n.time)).toEqual([0.1]);
    const confirmed = emitted[0];
    frames.count = s.length;
    scan(s.length, [], true);
    expect(output.nuclei.length).toBe(1);
    expect(output.nuclei[0]).toBe(confirmed);
    expect(confirmed.time).toBe(0.1);
  });

  it('preserves 60 ms class commitments when batch later identifies a closure', () => {
    const rate = 8000;
    const target = Math.round(0.36 / 0.005);
    const prefix = Math.round(0.4325 * rate);
    const signals = [0.44, 0.6].map((resume) =>
      Float32Array.from({ length: rate }, (_, n) => {
        const time = n / rate;
        return (time >= 0.1 && time < 0.3) ||
          (time >= resume && time < resume + 0.2)
          ? 0.1 * Math.sin((2 * Math.PI * 140 * n) / rate)
          : 0;
      })
    );
    expect(Array.from(signals[0].subarray(0, prefix))).toEqual(
      Array.from(signals[1].subarray(0, prefix))
    );
    expect(
      signals.map(
        (samples) => findLandmarks(analyzeFrames(samples, rate)).classes[target]
      )
    ).toEqual([6, 0]);
    for (const samples of signals) {
      const analyzer = createFrameAnalyzer(rate, { maxSeconds: 1 });
      const detector = createLandmarkDetector(analyzer.frames);
      analyzer.push(samples.subarray(0, prefix));
      detector.advance();
      expect(detector.output.committed).toBe(
        Math.max(0, analyzer.frames.count - 12)
      );
      expect(detector.output.committed > target).toBe(true);
      expect(detector.output.classes[target]).toBe(0);
      const committed = detector.output.committed;
      const saved = detector.output.classes.slice(0, committed);
      analyzer.push(samples.subarray(prefix));
      analyzer.flush();
      detector.advance(true);
      expect(
        Array.from(detector.output.classes.subarray(0, committed))
      ).toEqual(Array.from(saved));
    }
  });
});
