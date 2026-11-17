import { describe, it, expect } from 'test-anywhere';
import {
  createLandmarkDetector,
  findLandmarks,
} from '../src/recognition/landmarks.js';
import { candidateFrames } from './helpers/landmark-frames.js';

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
