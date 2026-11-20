/** Whisper recognition quality gates on synthesized, held-out material. Unlicense. */
import { equal } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect } from 'test-anywhere';
import {
  audioToIpa,
  errorRate,
  ipaToText,
  parseIpa,
  synthesize,
  textToIpa,
} from '../../src/index.js';
import { buildWhisperCues } from '../../scripts/build-whisper-cues.mjs';
import { WHISPER_CUES } from '../../src/recognition/data/whisper-cues.js';
import { renderWhisper } from '../../experiments/issue-72-whisper-robustness.mjs';
import {
  DECODER_VOICES,
  DECODE_SENTENCES,
  plannedPhones,
} from '../helpers/decoder-material.js';
import { itUnless } from '../helpers/skip.js';

const it = itUnless(process.env.HEAVY === '1' ? null : 'requires HEAVY=1');
const paired = new Map(
  WHISPER_CUES.flatMap(([a, b]) => [
    [a[0], a[0]],
    [b[0], a[0]],
  ])
);
const noMarks = (ipa) => ipa.replace(/[˥˦˧˨˩ˈˌ]/gu, '');
const toneCode = new Map([
  ['5', 'a'],
  ['35', 'e'],
  ['214', 'i'],
  ['21', 'i'],
  ['51', 'u'],
  ['', 'o'],
]);

function decodeText(text, language) {
  const { samples, sampleRate, plan } = renderWhisper(
    `[whisper] ${text}`,
    language
  );
  const heard = audioToIpa(samples, sampleRate, {
    language,
    voice: DECODER_VOICES.male,
  });
  return { heard, plan };
}

function phoneErrors(reference, hypothesis, equal) {
  const format = (phones) =>
    phones.map((ipa) => (equal ? (paired.get(ipa) ?? ipa) : ipa)).join(' ');
  return errorRate(format(reference), format(hypothesis), 'phone');
}

function toneIn(ipa) {
  const tone = parseIpa(ipa).tokens.find((token) => token.tone?.length)?.tone;
  return toneCode.get(tone?.join('') ?? '') ?? 'ə';
}

const mandarin = [
  ...DECODE_SENTENCES.zh,
  '请等一下',
  '他有一只猫',
  '今天下雨了',
  '我喜欢看书',
  '我们去学校',
  '他正在喝水',
];

function countPair([first, second]) {
  let correct = 0;
  for (const [expected, [ipa]] of [first, second].entries()) {
    const { samples, sampleRate, plan } = synthesize(`{W a${ipa}a W}`, {
      ipa: true,
      head: DECODER_VOICES.female,
      tier: 'minimal',
      seed: 1,
      engine: 'js',
    });
    const target = plannedPhones(plan)[1];
    const result = audioToIpa(samples, sampleRate, {
      voice: DECODER_VOICES.female,
      languages: [],
      whisper: [{ start: 0, end: samples.length / sampleRate }],
    });
    const sound = result.segments.find(
      ({ start, end }) =>
        start <= (target.start + target.end) / 2 &&
        end > (target.start + target.end) / 2
    );
    correct += Number(
      sound?.voicing !== undefined &&
        sound.voicing !== 0.5 &&
        Number(sound.voicing > 0.5) === expected
    );
  }
  console.log(first[0], second[0], `${correct}/2`);
  return correct;
}

describe('whisper acceptance measurements', () => {
  it('decodes three whispered sentences per language', () => {
    let edits = 0;
    let equalEdits = 0;
    let phones = 0;
    for (const [language, sentences] of Object.entries(DECODE_SENTENCES)) {
      for (const text of sentences.slice(0, 3)) {
        const { heard, plan } = decodeText(text, language);
        const reference = plannedPhones(plan).map(({ ipa }) => noMarks(ipa));
        const hypothesis = heard.segments
          .filter(({ kind }) => kind !== 'pause')
          .map(({ ipa }) => noMarks(ipa));
        edits += phoneErrors(reference, hypothesis, false).distance;
        equalEdits += phoneErrors(reference, hypothesis, true).distance;
        phones += reference.length;
      }
    }
    console.log(JSON.stringify({ edits, equalEdits, phones }));
    expect(
      Math.max(edits / phones / 0.15, equalEdits / phones / 0.08)
    ).toBeLessThanOrEqual(1);
  });

  it('chooses the correct voicing for at least 75% of female aCa probes', () => {
    const correct = WHISPER_CUES.reduce(
      (sum, pair) => sum + countPair(pair),
      0
    );
    console.log(`Female aCa: ${correct}/${2 * WHISPER_CUES.length}`);
    expect(correct / (2 * WHISPER_CUES.length)).toBeGreaterThanOrEqual(0.75);
  });

  it('lets words decide from whispered audio', () => {
    const { heard } = decodeText('a big dog', 'en');
    const result = ipaToText(heard.segments, { language: 'en' });
    console.log('a big dog:', result.text);
    expect(result.text).toBe('a big dog');
  });

  it('finds the right lexical tone for at least 75% of syllables across ten Mandarin sentences', () => {
    let edits = 0;
    let correct = 0;
    let syllables = 0;
    for (const text of mandarin) {
      const { heard } = decodeText(text, 'zh');
      const spoken = textToIpa(text, { lang: 'zh' }).words.flatMap(({ ipa }) =>
        ipa.split(/\s+/u).map(toneIn)
      );
      const lexical = ipaToText(heard.segments, {
        language: 'zh',
      }).words.flatMap(({ syllables: word }) =>
        word.map(({ ipa }) => toneIn(ipa))
      );
      const result = errorRate(spoken.join(' '), lexical.join(' '), 'phone');
      edits += result.distance;
      correct += spoken.length - result.substitutions - result.deletions;
      syllables += spoken.length;
    }
    console.log(
      JSON.stringify({ correctTones: correct, toneEdits: edits, syllables })
    );
    expect(syllables).toBeGreaterThan(0);
    expect(correct / syllables).toBeGreaterThanOrEqual(0.75);
  });

  it('recognizes hello world through the command line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-whisper-'));
    const wav = join(dir, 'w.wav');
    const run = (...args) =>
      spawnSync(process.execPath, ['bin/voice-simulator.js', ...args], {
        encoding: 'utf8',
      });
    try {
      const said = run('say', '[whisper] hello world', '-o', wav);
      equal(said.status, 0, said.stderr);
      const result = run('recognize', wav);
      equal(result.status, 0, result.stderr);
      console.log('CLI:', result.stdout.trim());
      expect(result.stdout.toLowerCase().replace(/\p{P}/gu, '').trim()).toBe(
        'hello world'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships current consonant cue statistics', () => {
    expect(buildWhisperCues()).toEqual(WHISPER_CUES);
  });
});
