/** Whisper acoustic and lexical integration. Unlicense. */
import { describe, expect, it } from 'test-anywhere';
import {
  analyzeFrames,
  audioToIpa,
  createRecognizer,
  ipaToText,
  resample,
  trackPitch,
  whisperTones,
} from '../src/index.js';
import { toneCurve } from '../src/articulation/tone-model.js';
import { createRandom } from '../src/random.js';
import { whisperSpeechRuns } from '../src/recognition/whisper.js';
import { createWhisperDecisions } from '../src/recognition/whisper-stream.js';
import { loadGolden } from './helpers/golden.js';
import {
  detect,
  noiseBelow,
  renderWhisper,
} from '../experiments/issue-72-whisper-robustness.mjs';

const sentences = [
  ['en', 'a fresh fish'],
  ['en', 'she sees five sheep'],
  ['ru', 'Саша шла домой.'],
  ['ru', 'На улице светит солнце.'],
  ['hi', 'फिर चार सेब'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好世界'],
  ['zh', '请喝茶'],
];

describe('whisper recognition', () => {
  it('finds whispered speech, including at 8 kHz and with noise 20 dB below it', () => {
    for (const [lang, text] of sentences) {
      const voiced = renderWhisper(text, lang);
      expect(detect(voiced.samples, voiced.sampleRate)).toEqual([]);
      const { samples, sampleRate, timeline } = renderWhisper(
        `[whisper] ${text}`,
        lang
      );
      const clean = detect(samples, sampleRate);
      expect(clean.length).toBe(1);
      expect(clean[0].start).toBeLessThan(timeline.words[0].start + 0.15);
      expect(clean[0].end).toBeGreaterThan(timeline.words.at(-1).end - 0.15);
      expect(
        detect(resample(samples, sampleRate, 8000), 8000).length
      ).toBeGreaterThan(0);
      expect(
        detect(noiseBelow(samples, -20), sampleRate).length
      ).toBeGreaterThan(0);
    }
  });

  it('locates a transition to whisper within 100 ms of the first whispered word', () => {
    const { samples, sampleRate, timeline } = renderWhisper(
      'one two three [whisper] four five six'
    );
    const [span] = detect(samples, sampleRate);
    expect(Math.abs(span.start - timeline.words[3].start)).toBeLessThan(0.1);
  });

  it('rejects white noise and hissing', () => {
    const random = createRandom(1);
    const level = Math.sqrt(3) * 10 ** (-30 / 20);
    const noise = Float32Array.from(
      { length: 16000 },
      () => (2 * random() - 1) * level
    );
    const hiss = renderWhisper('sss');
    expect(detect(noise, 16000)).toEqual([]);
    expect(detect(hiss.samples, hiss.sampleRate)).toEqual([]);
  });

  it('does not find a whisper in at least 23 of 24 voiced golden recordings', () => {
    const falsePositives = loadGolden().filter(
      ({ samples, sampleRate }) => detect(samples, sampleRate).length
    );
    console.log(
      'Whisper false positives on golden recordings:',
      falsePositives.map(({ id }) => id)
    );
    expect(falsePositives.length).toBeLessThanOrEqual(1);
  });

  it('marks timed results and accepts explicit or disabled whisper detection', () => {
    const { samples, sampleRate } = renderWhisper('[whisper] a fresh fish');
    const heard = audioToIpa(samples, sampleRate, { language: 'en' });
    expect(heard.ipa.startsWith('{W ')).toBe(true);
    expect(heard.modes[0].notation).toBe('W');
    expect(heard.modes[0].phonation).toEqual({ whisper: 1 });
    const sounds = heard.segments.filter((sound) => sound.whispered);
    expect(sounds.length).toBeGreaterThan(0);
    expect(sounds.every(({ voicing }) => voicing >= 0 && voicing <= 1)).toBe(
      true
    );
    const explicit = audioToIpa(samples, sampleRate, {
      language: 'en',
      whisper: [{ start: 0, end: 2 }],
    });
    expect(explicit.whisperSpans).toEqual([
      { start: 0, end: samples.length / sampleRate, confidence: 1 },
    ]);
    const disabled = audioToIpa(samples, sampleRate, {
      language: 'en',
      whisper: false,
    });
    expect(disabled.modes).toEqual([]);
    expect(disabled.segments.some(({ whispered }) => whispered)).toBe(false);
  });

  it('lets lexical context use soft voicing evidence when the preferred IPA is wrong', () => {
    const phones = ['ə', 'p', 'ɪ', 'k', 't', 'ɔ', 'k'].map((ipa, i) => ({
      ipa,
      start: i / 10,
      end: (i + 1) / 10,
      confidence: 1,
      ...('pkt'.includes(ipa) && { whispered: true, voicing: 0.95 }),
    }));
    expect(ipaToText(phones, { language: 'en' }).text).toBe('a big dog');
  });

  it('measures a contour from energy independently of the overall level', () => {
    const st = toneCurve([5, 1], { duration: 0.1, count: 10 });
    const frames = {
      startTime: 0,
      hop: 0.01,
      count: 10,
      energy: st.map((x) => x * 0.7 - 40),
    };
    const costs = whisperTones(frames, {
      start: 0,
      end: 0.1,
      meanDuration: 0.1 / 1.0072,
    });
    expect(Math.abs(costs['˥˩'] - 0.25)).toBeLessThan(1e-12);
    expect(Object.entries(costs).sort((a, b) => a[1] - b[1])[0][0]).toBe('˥˩');
  });

  it('holds the mode decision until half a second of speech or a pause', () => {
    const { samples, sampleRate } = renderWhisper(
      '[whisper] she sees five sheep'
    );
    const frames = analyzeFrames(samples, sampleRate);
    const pitch = trackPitch(frames);
    const mode = createWhisperDecisions(frames, pitch, 'auto');
    const [run] = whisperSpeechRuns(frames);
    pitch.committed = run.from + 96;
    expect(mode.advance(false).through).toBe(run.start);
    pitch.committed = run.from + 100;
    expect(mode.advance(false).through).toBeGreaterThanOrEqual(run.start + 0.5);
    const stream = createRecognizer(sampleRate, { language: 'en' });
    expect(
      stream.push(samples.subarray(0, Math.floor(sampleRate * 0.45))).segments
    ).toEqual([]);
    stream.reset();
  });
});
