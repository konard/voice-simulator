/**
 * Voice matching: the analysis measures known signals, and a voice rendered
 * by the simulator is matched back to a head with the same pitch and vocal
 * tract length.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { runCli } from '../bin/voice-simulator.js';
import { decodeHeadConfig, encodeWav } from '../src/index.js';
import { synthesize } from '../src/synthesize.js';
import {
  analyzeVoice,
  formantSpacing,
  resample,
  yinPitch,
} from '../src/analysis/voice-features.js';
import { featureDistance, matchVoice } from '../src/analysis/voice-match.js';
import { presetHeadConfig } from '../src/head-config.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';

function pulseTrain(f0, sampleRate, seconds) {
  const samples = new Float64Array(Math.round(sampleRate * seconds));
  const period = sampleRate / f0;
  for (let index = 0; index < samples.length; index++) {
    const phase = (index % period) / period;
    samples[index] = Math.exp(-8 * phase) * Math.sin(2 * Math.PI * 4 * phase);
  }
  return samples;
}

function relativeError(value, expected) {
  return Math.abs(value - expected) / expected;
}

describe('voice features', () => {
  it('resamples to the analysis rate', () => {
    const { samples, sampleRate } = resample(new Float64Array(44100), 44100);
    expect(sampleRate).toBe(11025);
    expect(Math.abs(samples.length - 11025)).toBeLessThan(3);
  });

  it('finds the pitch of a pulse train with YIN', () => {
    for (const f0 of [100, 220, 350]) {
      const signal = pulseTrain(f0, 11025, 0.2);
      const pitch = yinPitch(signal, 0, 441, 11025);
      expect(relativeError(pitch.f0, f0)).toBeLessThan(0.02);
      expect(pitch.aperiodicity).toBeLessThan(0.1);
    }
  });

  it('fits the formant spacing of a uniform tube', () => {
    expect(formantSpacing([500, 1500, 2500, 3500])).toBe(1000);
    expect(formantSpacing([600, 1800, 3000])).toBe(1200);
  });

  it('measures pitch and range of a voiced recording', () => {
    const features = analyzeVoice(pulseTrain(150, 22050, 1), 22050);
    expect(relativeError(features.f0, 150)).toBeLessThan(0.02);
    expect(features.f0Range).toBeLessThan(0.5);
    expect(features.voicedDuration).toBeGreaterThan(0.8);
  });

  it('has a zero distance between equal features', () => {
    const features = analyzeVoice(pulseTrain(150, 16000, 0.5), 16000);
    expect(featureDistance(features, features)).toBe(0);
  });
});

describe('matchVoice', () => {
  it('rejects a recording without voiced speech', () => {
    expect(() => matchVoice(new Float64Array(16000), 16000)).toThrow();
  });

  for (const preset of ['female', 'male']) {
    it(`matches a ${preset} voice back to its pitch and tract length`, () => {
      const target = presetHeadConfig(preset);
      const { samples, sampleRate } = synthesize(TEXT, {
        head: target,
        sampleRate: 22050,
      });
      const result = matchVoice(samples, sampleRate, { transcript: TEXT });
      expect(result.preset).toBe(preset);
      expect(relativeError(result.head.pitch, target.pitch)).toBeLessThan(0.1);
      expect(
        relativeError(result.head.vocalTractLength, target.vocalTractLength)
      ).toBeLessThan(0.1);
      expect(
        relativeError(result.head.speechRate, target.speechRate)
      ).toBeLessThan(0.1);
    });
  }

  it('tells a male from a female voice without a transcript', () => {
    const [male, female] = ['male', 'female'].map((preset) => {
      const { samples, sampleRate } = synthesize(TEXT, {
        head: presetHeadConfig(preset),
        sampleRate: 16000,
      });
      return matchVoice(samples, sampleRate, { iterations: 2 });
    });
    expect(female.head.pitch / male.head.pitch).toBeGreaterThan(1.5);
    expect(male.head.vocalTractLength).toBeGreaterThan(
      female.head.vocalTractLength + 1
    );
    expect(male.preset).toBe('male');
  });
});

describe('voice-simulator match', () => {
  it('prints the features and the matched head of a WAV file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'voice-match-'));
    try {
      const file = join(directory, 'voice.wav');
      const target = presetHeadConfig('female');
      const { samples, sampleRate } = synthesize(TEXT, {
        head: target,
        sampleRate: 16000,
      });
      writeFileSync(file, encodeWav(samples, sampleRate));
      const lines = [];
      const code = await runCli(
        ['match', file, '--transcript', TEXT, '--iterations', '2', '--json'],
        {
          stdout: (line) => lines.push(line),
          stderr: (line) => lines.push(line),
        }
      );
      expect(code).toBe(0);
      const result = JSON.parse(lines[0]);
      expect(result.preset).toBe('female');
      expect(relativeError(result.features.f0, target.pitch)).toBeLessThan(
        0.15
      );

      const text = [];
      await runCli(['match', file, '--iterations', '1'], {
        stdout: (line) => text.push(line),
      });
      expect(text[0]).toContain('Hz');
      expect(decodeHeadConfig(text[2]).pitch).toBeGreaterThan(150);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails without a file', async () => {
    const errors = [];
    const code = await runCli(['match'], {
      stderr: (line) => errors.push(line),
    });
    expect(code).toBe(1);
    expect(errors[0]).toContain('Missing');
  });
});
