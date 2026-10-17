/**
 * Acoustic synthesis: waveguide formants, pitch, consonant energy and WAV
 * encoding. Renders are kept short so the suite stays fast on every runtime.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { renderPlan, VoiceRenderer } from '../src/acoustics/voice.js';
import { lfParameters, lfWaveform } from '../src/acoustics/glottis.js';
import {
  estimateFormants,
  estimatePitch,
  rms,
  spectralPeaks,
} from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { encodeWav, decodeWav, wavHeader } from '../src/audio/wav.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const RATE = 24000;

function vowelMiddle(plan) {
  const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
  return (vowel.start + vowel.end) / 2;
}

function segmentLevel(samples, plan, index) {
  const segment = plan.segments[index];
  return rms(
    samples,
    Math.floor(segment.start * RATE),
    Math.floor(segment.end * RATE)
  );
}

describe('LF glottal pulse', () => {
  it('has a negative main excitation and returns to zero', () => {
    const pulse = lfParameters(0.6);
    let minimum = 0;
    for (let index = 0; index < 1000; index++) {
      minimum = Math.min(minimum, lfWaveform(pulse, index / 1000));
    }
    expect(minimum).toBeLessThan(-0.8);
    expect(Math.abs(lfWaveform(pulse, 0.999))).toBeLessThan(0.05);
  });
});

describe('waveguide synthesis', () => {
  it('reproduces the formants of the tract shape', () => {
    for (const symbol of ['i', 'ɑ', 'ə']) {
      const plan = planUtterance(`ˈ${symbol}ː`);
      const samples = renderPlan(plan, { sampleRate: RATE });
      const measured = estimateFormants(samples, RATE, {
        start: vowelMiddle(plan) - 0.03,
        duration: 0.06,
        count: 2,
      });
      const shape = tractShape(
        { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
        DEFAULT_HEAD
      );
      const expected = tubeFormants(shape.areas, shape.length, { count: 2 });
      for (let index = 0; index < 2; index++) {
        const error = Math.abs(measured[index] - expected[index]);
        expect(error / expected[index]).toBeLessThan(0.15);
      }
    }
  });

  it('speaks at the configured pitch', () => {
    const head = normalizeHeadConfig({ pitch: 180, vibrato: 0 });
    const plan = planUtterance('ˈəː', { head });
    const samples = renderPlan(plan, { sampleRate: RATE });
    const pitch = estimatePitch(samples, RATE, {
      start: vowelMiddle(plan) - 0.03,
    });
    expect(Math.abs(pitch - 180) / 180).toBeLessThan(0.2);
  });

  it('is deterministic for a seed and stays in range', () => {
    const plan = planUtterance('ˈsa');
    const a = renderPlan(plan, { sampleRate: RATE, seed: 7 });
    const b = renderPlan(plan, { sampleRate: RATE, seed: 7 });
    expect(a.length).toBe(Math.ceil(plan.duration * RATE));
    expect(a).toEqual(b);
    let peak = 0;
    for (const value of a) {
      expect(Number.isFinite(value)).toBe(true);
      peak = Math.max(peak, Math.abs(value));
    }
    expect(peak).toBeLessThan(1);
    expect(peak).toBeGreaterThan(0.05);
  });

  it('renders incrementally in small blocks', () => {
    const plan = planUtterance('ˈma');
    const renderer = new VoiceRenderer(plan, { sampleRate: RATE });
    const block = new Float32Array(128);
    let total = 0;
    while (!renderer.done) {
      total += renderer.render(block);
    }
    expect(Math.abs(total - plan.duration * RATE)).toBeLessThan(130);
  });

  it('exposes the pressure field of the tract for visualisation', () => {
    const plan = planUtterance('ˈma');
    const renderer = new VoiceRenderer(plan, { sampleRate: RATE });
    renderer.render(new Float32Array(2400));
    const field = renderer.solver.field();
    expect(field.pressure.length).toBeGreaterThan(10);
    expect(field.nose.length).toBeGreaterThan(0);
    const peak = Math.max(...field.pressure.map(Math.abs));
    expect(peak).toBeGreaterThan(0);
    expect(Number.isFinite(peak)).toBe(true);
  });

  it('keeps consonants quieter than vowels and closures nearly silent', () => {
    const plan = planUtterance('ˈata');
    const samples = renderPlan(plan, { sampleRate: RATE });
    const kinds = plan.segments.map((segment) => segment.kind);
    const vowel = segmentLevel(samples, plan, kinds.indexOf('vowel'));
    const closure = segmentLevel(samples, plan, kinds.indexOf('consonant'));
    expect(closure).toBeLessThan(vowel * 0.4);

    const fricativePlan = planUtterance('ˈasa');
    const fricative = renderPlan(fricativePlan, { sampleRate: RATE });
    const index = fricativePlan.segments.findIndex(
      (segment) => segment.kind === 'consonant'
    );
    const level = segmentLevel(fricative, fricativePlan, index);
    expect(level).toBeGreaterThan(vowel * 0.2);
    expect(level).toBeLessThan(vowel * 1.2);
  });
});

describe('spectral peaks', () => {
  it('finds resonances and drops weak ones below the floor', () => {
    const rate = 16000;
    const response = new Float64Array(rate / 10);
    for (let n = 0; n < response.length; n++) {
      const decay = Math.exp(-n / 400);
      response[n] =
        decay *
        (Math.sin((2 * Math.PI * 500 * n) / rate) +
          0.8 * Math.sin((2 * Math.PI * 1500 * n) / rate) +
          0.02 * Math.sin((2 * Math.PI * 3000 * n) / rate));
    }
    const all = spectralPeaks(response, rate);
    const strong = spectralPeaks(response, rate, { floor: 12 });
    expect(all).toContain(3000);
    expect(strong).toEqual([500, 1500]);
  });
});

describe('WAV encoding', () => {
  it('round-trips samples through 16-bit PCM', () => {
    const samples = Float32Array.from({ length: 100 }, (_, index) =>
      Math.sin(index / 5)
    );
    const decoded = decodeWav(encodeWav(samples, 16000));
    expect(decoded.sampleRate).toBe(16000);
    expect(decoded.samples.length).toBe(100);
    for (let index = 0; index < 100; index++) {
      expect(Math.abs(decoded.samples[index] - samples[index])).toBeLessThan(
        1e-3
      );
    }
  });

  it('writes an open-ended header for streams', () => {
    const header = wavHeader(48000);
    const text = String.fromCharCode(...header.subarray(0, 4));
    expect(text).toBe('RIFF');
    expect(header.length).toBe(44);
  });
});
