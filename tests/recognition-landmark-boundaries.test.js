import { describe, it, expect } from 'test-anywhere';
import {
  createLandmarkDetector,
  findLandmarks,
} from '../src/recognition/landmarks.js';
import { boundaryFrames } from './helpers/landmark-frames.js';

function checkStrengths(result) {
  expect(result.nuclei.length).toBe(2);
  for (const nucleus of result.nuclei) {
    if (nucleus.end === null) {
      continue;
    }
    const at = (time) => Math.round((time - result.startTime) / result.hop);
    const expected =
      result.sonority[at(nucleus.time)] -
      Math.min(
        result.sonority[at(nucleus.start)],
        result.sonority[at(nucleus.end)]
      );
    expect(nucleus.strength).toBe(expected);
  }
}

describe('landmark nucleus boundaries', () => {
  it('updates strength when the next peak reveals a deeper minimum', () => {
    const result = findLandmarks(boundaryFrames());
    expect(result.nuclei[0].end).not.toBe(null);
    checkStrengths(result);
  });
  it('keeps strengths consistent with trailing nonspeech', () => {
    checkStrengths(findLandmarks(boundaryFrames(true)));
  });
  it('keeps streamed strengths consistent with completed boundaries', () => {
    const frames = boundaryFrames(true);
    const count = frames.count;
    frames.count = 0;
    const detector = createLandmarkDetector(frames);
    for (let end = 4; end < count; end += 4) {
      frames.count = end;
      detector.advance();
    }
    frames.count = count;
    detector.advance(true);
    checkStrengths(detector.output);
  });
});
