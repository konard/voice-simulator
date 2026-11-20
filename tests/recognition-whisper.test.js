/** Whisper acoustic and lexical integration. Unlicense. */
import { describe, expect, it } from 'test-anywhere';
import {
  analyzeFrames,
  audioToIpa,
  createFrameAnalyzer,
  createIpaDecoder,
  createRecognizer,
  findWhisper,
  ipaToText,
  recognize,
  recognizeModes,
  resample,
  synthesize,
  trackFormants,
  trackPitch,
  whisperTones,
} from '../src/index.js';
import { toneCurve } from '../src/articulation/tone-model.js';
import { createRandom } from '../src/random.js';
import { bestTone, mean } from '../src/recognition/prosody-features.js';
import { createPitchTracker } from '../src/recognition/pitch.js';
import { whisperSpeechRuns } from '../src/recognition/whisper.js';
import {
  createWhisperFramePool,
  whisperFormantFrames,
} from '../src/recognition/whisper-spectrum.js';
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

it('separates a weak periodic gap from a telephone whisper', () => {
  const text = 'Привет, как дела?';
  const { samples, sampleRate, timeline } = synthesize(
    `${text} [whisper]${text}[/whisper]`,
    {
      lang: 'ru',
      tier: 'telephone',
      head: 'random',
      preset: 'male',
      seed: 1,
      markup: true,
    }
  );
  const frames = analyzeFrames(samples, sampleRate, { hop: 0.01 });
  const spans = findWhisper(samples, sampleRate, frames, trackPitch(frames));
  const change = timeline.words[3].start;
  expect(spans.length).toBeGreaterThan(0);
  expect(spans.every(({ start }) => start >= change - 0.1)).toBe(true);
});

describe('whisper recognition', () => {
  for (const lang of new Set(sentences.map(([language]) => language))) {
    it(`finds ${lang} whispers, including at 8 kHz and with noise 20 dB below them`, () => {
      for (const [, text] of sentences.filter(
        ([language]) => language === lang
      )) {
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
  }

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

  it('marks timed whisper results', () => {
    const { samples, sampleRate, head } = renderWhisper(
      '[whisper] a fresh fish'
    );
    const heard = audioToIpa(samples, sampleRate, {
      language: 'en',
      voice: head,
    });
    expect(heard.ipa.startsWith('{W ')).toBe(true);
    expect(heard.modes[0].notation).toBe('W');
    expect(heard.modes[0].phonation).toEqual({ whisper: 1 });
    expect(heard.tracks.articulation.channels.whisper.includes(1)).toBe(true);
    const sounds = heard.segments.filter((sound) => sound.whispered);
    expect(sounds.length).toBeGreaterThan(0);
    expect(sounds.every(({ voicing }) => voicing >= 0 && voicing <= 1)).toBe(
      true
    );
  });

  it('clips explicit whisper times to the recording', () => {
    const { samples, sampleRate } = renderWhisper('[whisper] a fresh fish');
    const explicit = audioToIpa(samples, sampleRate, {
      language: 'en',
      whisper: [{ start: 0, end: 2 }],
    });
    expect(explicit.whisperSpans).toEqual([
      { start: 0, end: samples.length / sampleRate, confidence: 1 },
    ]);
  });

  it('can disable whisper detection', () => {
    const { samples, sampleRate } = renderWhisper('[whisper] a fresh fish');
    const disabled = audioToIpa(samples, sampleRate, {
      language: 'en',
      whisper: false,
    });
    expect(disabled.modes).toEqual([]);
    expect(disabled.segments.some(({ whispered }) => whispered)).toBe(false);
    expect(disabled.tracks.articulation.channels.whisper).toBeUndefined();
  });

  it('keeps decoding across explicit spans shorter than a phone', () => {
    const { samples, sampleRate } = renderWhisper('[whisper] a fresh fish');
    const result = audioToIpa(samples, sampleRate, {
      language: 'en',
      whisper: [{ start: 0.34, end: 0.345 }],
    });
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('leaves acoustic costs unchanged for an explicit span between analysis frames', () => {
    const { samples, sampleRate, head } = renderWhisper('a fresh fish');
    const options = { language: 'en', voice: head };
    const disabled = audioToIpa(samples, sampleRate, {
      ...options,
      whisper: false,
    });
    const betweenCentres = audioToIpa(samples, sampleRate, {
      ...options,
      whisper: [{ start: 0.341, end: 0.342 }],
    });
    expect(betweenCentres.lattice).toEqual(disabled.lattice);
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

  it('passes detected spans to mode recognition once', () => {
    const { samples, sampleRate } = renderWhisper('[whisper] a fresh fish');
    const options = { languages: ['en'] };
    const reading = recognize(samples, sampleRate, options);
    const whispered = (output) =>
      output.modes.filter(({ notation }) => notation === 'W');
    const spans = whispered(reading);
    expect(spans.length).toBe(1);
    const combined = recognizeModes(samples, sampleRate, {
      ...reading,
      whisperSpans: spans,
    });
    expect(whispered(combined)).toEqual(spans);
    expect(
      whispered(
        recognize(samples, sampleRate, {
          ...options,
          whisper: false,
        })
      )
    ).toEqual([]);
  });
});

describe('whisper tone recognition', () => {
  it('measures a contour from energy independently of the overall level', () => {
    const st = toneCurve([5, 1], { duration: 0.1, count: 10 });
    const frames = {
      startTime: 0,
      hop: 0.01,
      window: 0.025,
      count: 10,
      energy: st.map((x) => x * 0.7 - 40),
      speech: new Uint8Array(10).fill(1),
    };
    const costs = whisperTones(frames, {
      start: 0,
      end: 0.1,
      meanDuration: 0.1 / 1.1135,
    });
    expect(Math.abs(costs['˥˩'] - 0.25)).toBeLessThan(1e-12);
    expect(Object.entries(costs).sort((a, b) => a[1] - b[1])[0][0]).toBe('˥˩');
  });

  it('guesses at least five whispered tones in the eight ma probes', () => {
    const letters = ['˥', '˧˥', '˨˩˦', '˥˩'];
    let correct = 0;
    for (const preset of ['male', 'female']) {
      const { samples, sampleRate, plan, timeline } = renderWhisper(
        '[whisper] 妈 麻 马 骂',
        'zh',
        preset
      );
      const frames = analyzeFrames(samples, sampleRate);
      const meanDuration = mean(
        timeline.words.map(({ start, end }) => end - start)
      );
      for (const [index, word] of timeline.words.entries()) {
        const vowel = plan.segments.find(
          ({ kind, start }) => kind === 'vowel' && start >= word.start - 1e-9
        );
        const costs = whisperTones(frames, {
          ...word,
          vowelStart: vowel.start,
          meanDuration,
        });
        const best = bestTone(costs);
        console.log(preset, word.text, letters[index], best);
        correct += Number(best === letters[index]);
      }
    }
    console.log(`Mandarin ma probes: ${correct}/8`);
    expect(correct).toBeGreaterThanOrEqual(5);
  });
});

it('locates an interior whisper in continuous speech', () => {
  const { samples, sampleRate, timeline } = renderWhisper(
    'one two three [whisper] we are here[/whisper] we are ready'
  );
  const spans = detect(samples, sampleRate);
  expect(spans.length).toBe(1);
  expect(Math.abs(spans[0].start - timeline.words[3].start)).toBeLessThan(0.1);
  expect(Math.abs(spans[0].end - timeline.words[6].start)).toBeLessThan(0.1);
});

it('detects a continuous switch to whisper before committing the quiet tail', () => {
  const { samples, sampleRate, timeline } = renderWhisper(
    'one two three [whisper] four five six'
  );
  const start = timeline.words[3].start;
  const input = createFrameAnalyzer(sampleRate);
  const { frames } = input;
  const pool = createWhisperFramePool(frames);
  const pitch = createPitchTracker(frames);
  const classifier = createWhisperDecisions(frames, pitch.track, 'auto');
  const firstHalfSecond = Math.floor((start + 0.5) * sampleRate);
  const quantum = Math.floor(sampleRate * 0.02);
  let live;
  for (let i = 0; i < firstHalfSecond; i += quantum) {
    input.push(samples.subarray(i, Math.min(i + quantum, firstHalfSecond)));
    pitch.advance();
    live = classifier.advance(false, pool.frames.count * frames.hop);
    pool.advance(live, false);
  }
  expect(live.spans.length).toBe(1);
  expect(Math.abs(live.spans[0].start - start)).toBeLessThan(0.1);
  const switchRow = Math.round(live.spans[0].start / frames.hop);
  expect(pool.frames.whisper[switchRow - 1]).toBe(0);
  expect(pool.frames.whisper[switchRow]).toBe(1);
});

it('ends the streaming whisper when continuous speech returns to voice', () => {
  const { samples, sampleRate, timeline } = renderWhisper(
    'one two three [whisper] we are here[/whisper] we are ready'
  );
  const input = createFrameAnalyzer(sampleRate);
  const { frames } = input;
  const pool = createWhisperFramePool(frames);
  const pitch = createPitchTracker(frames);
  const classifier = createWhisperDecisions(frames, pitch.track, 'auto');
  const quantum = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < samples.length; i += quantum) {
    input.push(samples.subarray(i, i + quantum));
    pitch.advance();
    const decision = classifier.advance(false, pool.frames.count * frames.hop);
    pool.advance(decision, false);
  }
  input.flush();
  pitch.advance(true);
  const final = classifier.advance(true, pool.frames.count * frames.hop);
  pool.advance(final, true);
  expect(final.spans.length).toBe(1);
  const [span] = final.spans;
  expect(Math.abs(span.start - timeline.words[3].start)).toBeLessThan(0.1);
  expect(Math.abs(span.end - timeline.words[6].start)).toBeLessThan(0.1);
  const resume = Math.ceil(timeline.words[6].start / frames.hop);
  expect(pool.frames.whisper.subarray(resume).includes(1)).toBe(false);
});

describe('whisper streaming', () => {
  it('uses whispered articulation after a detected change of mode at a pause', () => {
    const { samples: voice, sampleRate, head } = renderWhisper('one two three');
    const { samples: whispering } = renderWhisper(
      '[whisper] she sees five sheep'
    );
    const transition = voice.length + Math.round(sampleRate * 0.3);
    const samples = new Float32Array(transition + whispering.length);
    samples.set(voice);
    samples.set(whispering, transition);
    const stream = createIpaDecoder(sampleRate, {
      language: 'en',
      voice: head,
    });
    stream.push(samples);
    stream.flush();
    const { tracks, whisperSpans } = stream.result();
    expect(whisperSpans.length).toBe(1);
    expect(
      Math.abs(whisperSpans[0].start - transition / sampleRate)
    ).toBeLessThan(0.1);
    const { whisper } = tracks.articulation.channels;
    expect(whisper[0]).toBe(0);
    expect(whisper.includes(1)).toBe(true);
  });

  it('clips present spans and returns pooled formants before flush', () => {
    const { samples, sampleRate, head } = renderWhisper(
      '[whisper] a fresh fish'
    );
    const stream = createIpaDecoder(sampleRate, {
      language: 'en',
      voice: head,
      whisper: [
        { start: 0, end: 2 },
        { start: 3, end: 4 },
      ],
    });
    stream.push(samples.subarray(0, Math.floor(sampleRate * 0.44)));
    const result = stream.result();
    const { frames, tracks, voice, whisperSpans } = result;
    expect(whisperSpans).toEqual([
      { start: 0, end: frames.sampleCount / frames.rate, confidence: 1 },
    ]);
    const expected = trackFormants(whisperFormantFrames(frames, whisperSpans), {
      pitch: tracks.pitch,
      vocalTractLength: voice.vocalTractLength,
    });
    const columns = tracks.formants.committed * 4;
    expect(columns).toBeGreaterThan(0);
    expect(tracks.formants.valid.slice(0, columns).includes(1)).toBe(true);
    expect(tracks.articulation.channels.whisper[0]).toBe(1);
    const raw = trackFormants(frames, {
      pitch: tracks.pitch,
      vocalTractLength: voice.vocalTractLength,
    });
    const distance = (formants) =>
      formants.frequency.slice(0, columns).reduce((sum, frequency, i) => {
        const bothValid = formants.valid[i] && expected.valid[i];
        return (
          sum + (bothValid ? Math.abs(frequency - expected.frequency[i]) : 0)
        );
      }, 0);
    expect(distance(tracks.formants)).toBeLessThan(distance(raw));
  });

  it('holds the mode decision until half a second of speech or a pause', () => {
    const { samples, sampleRate } = renderWhisper(
      '[whisper] she sees five sheep'
    );
    const allFrames = analyzeFrames(samples, sampleRate);
    const pitch = trackPitch(allFrames);
    const [run] = whisperSpeechRuns(allFrames);
    const frames = { ...allFrames };
    const observe = (count) => {
      frames.count = run.from + count;
      frames.sampleCount = Math.round(frames.count * frames.hop * frames.rate);
      pitch.committed = frames.count;
    };
    const mode = createWhisperDecisions(frames, pitch, 'auto');
    observe(96);
    expect(mode.advance(false).through).toBe(run.start);
    observe(100);
    expect(mode.advance(false).through).toBeGreaterThanOrEqual(run.start + 0.5);
    const shortFrames = { ...frames, speech: frames.speech.slice() };
    shortFrames.speech.fill(0, run.from + 70);
    const shortMode = createWhisperDecisions(shortFrames, pitch, 'auto');
    expect(shortMode.advance(false).through).toBe(run.start);
    shortFrames.count = run.from + 110;
    shortFrames.sampleCount = Math.round(
      shortFrames.count * shortFrames.hop * shortFrames.rate
    );
    pitch.committed = shortFrames.count;
    expect(shortMode.advance(false).through).toBeGreaterThan(run.start);
    const stream = createIpaDecoder(sampleRate, { language: 'en' });
    expect(
      stream.push(samples.subarray(0, Math.floor(sampleRate * 0.45))).segments
    ).toEqual([]);
    stream.reset();
  });

  it('keeps explicit whisper spans on the original stream timeline', () => {
    const first = renderWhisper('a fresh fish');
    const second = renderWhisper('[whisper] a fresh fish');
    const { sampleRate } = first;
    const offset = first.samples.length + Math.round(0.5 * sampleRate);
    const samples = new Float32Array(offset + second.samples.length);
    samples.set(first.samples);
    samples.set(second.samples, offset);
    const [relative] = detect(second.samples, sampleRate);
    const start = offset / sampleRate + relative.start;
    const end = offset / sampleRate + relative.end;
    const stream = createRecognizer({
      sampleRate,
      languages: ['en'],
      level: 'medium',
      whisper: [{ start, end }],
    });
    const phrases = [];
    stream.on('final', (result) => phrases.push(result));
    stream.on('error', (error) => {
      throw error;
    });
    stream.push(samples);
    const result = stream.flush();
    const whispers = result.modes.filter(({ notation }) => notation === 'W');
    expect(phrases.length).toBe(2);
    expect(whispers.length).toBe(1);
    expect(Math.abs(whispers[0].start - start)).toBeLessThan(1e-7);
    expect(Math.abs(whispers[0].end - end)).toBeLessThan(1e-7);
    expect(whispers[0].from).toBeGreaterThan(0);
  });
});
