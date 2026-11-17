/** Landmark stage: acoustic rules, multilingual synthetic speech, streaming
 * latency and immutable commitments, noise and the CPU budget (issue 62). */
import { describe, it, expect } from 'test-anywhere';
import {
  BROAD_CLASSES,
  analyzeFrames,
  createFrameAnalyzer,
  createLandmarkDetector,
  findLandmarks,
  synthesize,
  planUtterance,
  presetHeadConfig,
  syllabifyTokens,
} from '../src/index.js';
import { createRandom } from '../src/random.js';
import { frameTruth } from '../scripts/landmark-material.mjs';
import { LANDMARK_THRESHOLDS } from '../src/recognition/landmark-thresholds.js';
import { sonorityFilters } from '../src/recognition/landmark-signals.js';

const SENTENCES = [
  ['en', 'The north wind and the sun were disputing which was the stronger.'],
  ['ru', 'Мама мыла раму.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好世界'],
];
const voices = new Map();
function voice(lang, text, preset, rate, ipa = false) {
  const key = `${lang}:${text}:${preset}:${rate}:${ipa}`;
  if (!voices.has(key)) {
    const out = synthesize(text, {
      lang,
      ipa,
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      engine: 'js',
      sampleRate: rate,
      seed: 1,
    });
    const frames = analyzeFrames(out.samples, rate);
    voices.set(key, { ...out, frames, result: findLandmarks(frames) });
  }
  return voices.get(key);
}
function plannedNuclei(plan, lang) {
  return syllabifyTokens(plan.tokens, { language: lang }).flatMap((tokens) => {
    const segments = plan.segments.filter(
      (s) => s.kind === 'vowel' && tokens.includes(s.token)
    );
    return segments.length
      ? [(segments[0].start + segments.at(-1).end) / 2]
      : [];
  });
}
function matches(truth, nuclei, tolerance) {
  const remaining = nuclei.map((n) => n.time);
  let found = 0;
  for (const time of truth) {
    let best = -1;
    for (let j = 0; j < remaining.length; j++) {
      if (
        Math.abs(remaining[j] - time) <= tolerance &&
        (best < 0 ||
          Math.abs(remaining[j] - time) < Math.abs(remaining[best] - time))
      ) {
        best = j;
      }
    }
    if (best >= 0) {
      found++;
      remaining.splice(best, 1);
    }
  }
  return { found, extra: remaining.length };
}

describe('recognition landmarks', () => {
  it('exports the classes, typed arrays and configurable thresholds', () => {
    expect(BROAD_CLASSES).toEqual([
      'silence',
      'vowel',
      'glide',
      'nasal',
      'voiced-fricative',
      'voiceless-fricative',
      'closure',
      'burst',
    ]);
    const frames = analyzeFrames(new Float32Array(800), 8000);
    const result = findLandmarks(frames);
    expect(result.classes instanceof Uint8Array).toBe(true);
    expect(result.sonority instanceof Float32Array).toBe(true);
    expect(result.classes.length).toBe(frames.capacity);
    expect(result.sonority.length).toBe(frames.capacity);
    expect(result.committed).toBe(frames.count);
    expect(result.nuclei.length).toBe(0);
    expect(() => findLandmarks(frames, { thresholds: { voiced: 2 } })).toThrow(
      RangeError
    );
    expect(() =>
      findLandmarks(frames, { thresholds: { nucleusDip: NaN } })
    ).toThrow(RangeError);
  });
  it('computes sonority from the selected mel filters', () => {
    for (const rate of [8000, 11025, 16000]) {
      const frames = analyzeFrames(new Float32Array(rate / 5), rate);
      frames.mel.fill(Math.log(2));
      const result = findLandmarks(frames);
      const expected = 10 * Math.log10(2 * sonorityFilters(frames).length);
      for (const value of result.sonority) {
        expect(Math.abs(value - expected) < 1e-5).toBe(true);
      }
    }
  });
  it('labels the closure and frication of affricates separately', () => {
    for (const [ipa, frication] of [
      ['at͡sa', 5],
      ['ad͡za', 4],
    ]) {
      const plan = planUtterance(ipa);
      const parts = plan.segments.filter((s) => s.token?.affricate);
      expect(parts.length).toBe(2);
      const frames = {
        count: Math.ceil(plan.duration / 0.005),
        startTime: 0,
        hop: 0.005,
      };
      const truth = frameTruth(plan, frames);
      for (const [part, expected] of [
        [parts[0], 6],
        [parts[1], frication],
      ]) {
        const middle = Math.round((part.start + part.end) / 2 / frames.hop);
        expect(truth[middle]).toBe(expected);
      }
    }
  });
  it('uses sonority and periodicity without an extra speech-flag gate', () => {
    const frames = analyzeFrames(new Float32Array(3200), 8000);
    frames.noise.fill(-80);
    frames.periodicity.fill(0.9);
    frames.speech.fill(0);
    for (let t = 0; t < frames.count; t++) {
      const logEnergy = ((20 - Math.abs(t - 40)) * Math.LN10) / 10;
      frames.mel.fill(
        logEnergy,
        t * frames.melBands,
        (t + 1) * frames.melBands
      );
    }
    const result = findLandmarks(frames);
    expect(result.nuclei.length).toBe(1);
    expect(Math.abs(result.nuclei[0].time - 0.2) <= frames.hop).toBe(true);
  });
  it('finds the nuclei of synthetic speech', () => {
    let total = 0,
      found = 0,
      extra = 0;
    for (const [lang, text] of SENTENCES) {
      for (const preset of ['male', 'female']) {
        for (const rate of [16000, 8000]) {
          const out = voice(lang, text, preset, rate);
          const truth = plannedNuclei(out.plan, lang);
          const counts = matches(truth, out.result.nuclei, 0.05);
          console.log(
            `nuclei ${lang}:${preset}@${rate}: true ${truth.length}, found ${counts.found}, extra ${counts.extra}`
          );
          total += truth.length;
          found += counts.found;
          extra += counts.extra;
        }
      }
    }
    console.log(`nuclei recall ${found / total}, extra ${extra / total}`);
    expect(found / total >= 0.9).toBe(true);
    expect(extra / total <= 0.1).toBe(true);
  });
});

describe('recognition landmarks: streaming and classes', () => {
  it('reports nuclei in time', () => {
    for (const [lang, text] of SENTENCES) {
      for (const preset of ['male', 'female']) {
        for (const rate of [16000, 8000]) {
          const out = voice(lang, text, preset, rate);
          const analyzer = createFrameAnalyzer(rate, {
            maxSeconds: out.samples.length / rate,
          });
          const detector = createLandmarkDetector(analyzer.frames);
          const returned = [];
          const saved = new Uint8Array(detector.output.classes.length);
          let committed = 0;
          for (
            let start = 0;
            start < out.samples.length;
            start += rate * 0.02
          ) {
            const end = Math.min(out.samples.length, start + rate * 0.02);
            analyzer.push(out.samples.subarray(start, end));
            for (const nucleus of detector.advance()) {
              expect(end / rate - nucleus.time <= 0.15 + 1e-9).toBe(true);
              returned.push(nucleus);
            }
            expect(
              Array.from(detector.output.classes.subarray(0, committed))
            ).toEqual(Array.from(saved.subarray(0, committed)));
            committed = detector.output.committed;
            saved.set(detector.output.classes.subarray(0, committed));
          }
          analyzer.flush();
          returned.push(...detector.advance(true));
          expect(returned.length).toBe(out.result.nuclei.length);
          for (let i = 0; i < returned.length; i++) {
            expect(
              Math.abs(returned[i].time - out.result.nuclei[i].time) <= 0.01
            ).toBe(true);
          }
          expect(detector.output.committed).toBe(out.frames.count);
          expect(detector.advance(true)).toEqual([]);
        }
      }
    }
  });
  it('names broad classes', () => {
    const accuracies = [];
    for (const rate of [16000, 8000]) {
      let correct = 0,
        total = 0;
      const confusion = Array.from({ length: 8 }, () => Array(8).fill(0));
      for (const [lang, text] of SENTENCES) {
        for (const preset of ['male', 'female']) {
          const out = voice(lang, text, preset, rate);
          const truth = frameTruth(out.plan, out.frames);
          for (let t = 0; t < truth.length; t++) {
            if (truth[t] >= 0) {
              total++;
              correct += truth[t] === out.result.classes[t] ? 1 : 0;
              confusion[truth[t]][out.result.classes[t]]++;
            }
          }
        }
      }
      console.log(
        `classes @${rate}: accuracy ${correct / total}; confusion ${JSON.stringify(confusion)}`
      );
      accuracies.push(correct / total >= (rate === 16000 ? 0.85 : 0.8));
    }
    expect(accuracies.every(Boolean)).toBe(true);
  });
  it('finds landmarks', () => {
    const missing = [];
    for (const ipa of ['apa', 'asa', 'ama', 'aba']) {
      const out = voice('en', ipa, 'male', 16000, true);
      const consonant = out.plan.segments.find((s) => s.kind === 'consonant');
      const release = out.plan.segments.find((s) => s.kind === 'release');
      console.log(`landmarks ${ipa}: ${JSON.stringify(out.result.landmarks)}`);
      const expected =
        ipa === 'ama'
          ? [
              ['s-', consonant.start],
              ['s+', consonant.end],
            ]
          : [
              ['g-', consonant.start],
              ['g+', release?.end ?? consonant.end],
            ];
      if (release) {
        expected.push(['b-', consonant.start], ['b+', release.start]);
      }
      for (const [type, time] of expected) {
        if (
          !out.result.landmarks.some(
            (l) => l.type === type && Math.abs(l.time - time) <= 0.02
          )
        ) {
          missing.push(`${ipa} ${type} at ${time.toFixed(3)} s`);
        }
      }
    }
    console.log(`missing landmarks: ${missing.join(', ')}`);
    expect(missing).toEqual([]);
  });
  it('is quiet on noise', () => {
    for (const rate of [8000, 16000]) {
      const random = createRandom(62);
      const noise = Float32Array.from(
        { length: 2 * rate },
        () => 0.01 * (2 * random() - 1)
      );
      expect(findLandmarks(analyzeFrames(noise, rate)).nuclei.length).toBe(0);
    }
  });
  it('invalidates a stage after trim', () => {
    const analyzer = createFrameAnalyzer(8000);
    analyzer.push(new Float32Array(1600));
    const detector = createLandmarkDetector(analyzer.frames);
    detector.advance();
    analyzer.trim(1);
    expect(() => detector.advance()).toThrow();
  });
  it('stays within the CPU budget', () => {
    const out = voice('en', SENTENCES[0][1], 'male', 16000);
    findLandmarks(out.frames);
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = globalThis.performance.now();
      findLandmarks(out.frames);
      best = Math.min(
        best,
        (globalThis.performance.now() - started) / 1000 / out.duration
      );
    }
    console.log(`landmarks rtf ${best.toFixed(6)}`);
    expect(best <= 0.08).toBe(true);
  });
  it('keeps thresholds within the declared search ranges', async () => {
    const { SEARCH_RANGES } =
      await import('../scripts/calibrate-landmarks.mjs');
    for (const [key, [low, high]] of Object.entries(SEARCH_RANGES)) {
      expect(
        LANDMARK_THRESHOLDS[key] >= low && LANDMARK_THRESHOLDS[key] <= high
      ).toBe(true);
    }
  });
});
