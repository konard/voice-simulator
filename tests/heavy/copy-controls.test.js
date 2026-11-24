/** Copy control regression on a verified preset recording. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  copyRecording,
  presetHeadConfig,
  synthesize,
  toScore,
} from '../../src/index.js';
import { planRecording } from '../../src/session/score.js';
import { warpPlan } from '../../src/session/warp.js';

it('honors an explicitly unset pitch control when copying', () => {
  const sampleRate = 16000;
  const options = { tier: 'minimal', sampleRate, seed: 1, engine: 'js' };
  const head = presetHeadConfig('male');
  const { samples } = synthesize('Yes.', { ...options, head });
  const { recognition, score, voice } = copyRecording(samples, sampleRate, {
    ...options,
    languages: ['en'],
    impose: { pitch: undefined },
  });
  const { ipa, modes, segments } = recognition;
  const plan = warpPlan(planRecording(ipa, 'en', voice, modes), segments, {
    duration: samples.length / sampleRate,
  });
  assert.deepEqual(score.f0, toScore(plan, recognition, voice).f0);
});
