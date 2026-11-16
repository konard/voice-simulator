/**
 * Intonation models per language (issue 51): English tunes, Russian
 * intonation constructions, Hindi accent phrases, Mandarin question
 * raise, focus, sentence types from text and phrase breaks. Pitch is the
 * planned f0 in semitones from the head pitch (150 Hz, no vibrato),
 * sampled 10 ms inside each vowel.
 */

import { describe, it, expect } from 'test-anywhere';
import { planUtterance } from '../src/articulation/plan.js';
import {
  FOCUS,
  TUNE_NAMES,
  TUNES,
  intonationLanguage,
} from '../src/articulation/intonation.js';
import { textToIpa } from '../src/g2p/index.js';
import {
  ALTERNATIVE_CONJUNCTIONS,
  PHRASE_CONJUNCTIONS,
  englishAuxiliary,
} from '../src/g2p/phrasing.js';
import { ZH_WH_WORDS } from '../src/g2p/verbalize-zh.js';
import { parseIpa } from '../src/ipa/parse.js';
import { syllabifyIpa } from '../src/ipa/syllables.js';
import { TUNE_LABELS } from '../src/markup/modes.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const HEAD = normalizeHeadConfig({ pitch: 150, vibrato: 0 });

/** Pitch of the vowels of a text: start, end, min, max and mean in st. */
function measure(text, lang = 'en', options = {}) {
  const { ipa, modes } = textToIpa(text, { lang, ...options });
  const plan = planUtterance(ipa, { head: HEAD, language: lang, modes });
  const st = (time) => {
    const frame = Math.min(
      plan.frameCount - 1,
      Math.max(0, Math.round(time * plan.frameRate))
    );
    return 12 * Math.log2(plan.channels.f0[frame] / HEAD.pitch);
  };
  const vowels = plan.segments
    .filter((segment) => segment.kind === 'vowel')
    .map((segment) => {
      const samples = [];
      for (let t = segment.start + 0.01; t <= segment.end - 0.01; t += 0.005) {
        samples.push(st(t));
      }
      return {
        segment,
        word: segment.token.word,
        stress: segment.token.stress,
        start: st(segment.start + 0.01),
        end: st(segment.end - 0.01),
        min: Math.min(...samples),
        max: Math.max(...samples),
        mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      };
    });
  return { ipa, plan, vowels };
}

const ofWord = (vowels, word) => vowels.filter((vowel) => vowel.word === word);
const meanOf = (vowels) =>
  vowels.reduce((sum, vowel) => sum + vowel.mean, 0) / vowels.length;

describe('English tunes', () => {
  it('falls in English statements', () => {
    const { vowels } = measure('You are coming.');
    expect(vowels[0].start - vowels.at(-1).end >= 5).toBe(true);
  });

  it('rises in yes/no questions', () => {
    const { vowels } = measure('Are you coming?');
    const nucleus = vowels.find((vowel) => vowel.stress === 1);
    expect(vowels.at(-1).end - nucleus.start >= 5).toBe(true);
  });

  it('falls in wh-questions', () => {
    const { vowels } = measure('Where are you going?');
    expect(vowels[0].start - vowels.at(-1).end >= 5).toBe(true);
  });

  it('rises then falls in alternative questions', () => {
    const { vowels } = measure('Tea or coffee?');
    const tea = ofWord(vowels, vowels[0].word);
    expect(tea.at(-1).end - tea[0].start >= 3).toBe(true);
    expect(tea.at(-1).end - vowels.at(-1).end >= 4).toBe(true);
  });

  it('rises in asking tags', () => {
    const { vowels, plan } = measure("You are coming, aren't you?");
    const comma = plan.segments.find(
      (segment) => segment.kind === 'pause' && segment.boundary === 'comma'
    );
    const before = vowels.filter((vowel) => vowel.segment.end <= comma.start);
    expect(vowels.at(-1).end - before.at(-1).end >= 4).toBe(true);
  });

  it('raises list items and lowers the last one', () => {
    // "Above their stressed vowel": the continuation tune of the issue
    // puts +2 on the nucleus and ends at +3.5, so the end is compared with
    // the end and the lowest point of the stressed vowel, after its fall.
    const { vowels } = measure('Apples, pears and plums.');
    const apples = ofWord(vowels, vowels[0].word);
    const stressed = apples.find((vowel) => vowel.stress === 1);
    expect(apples.at(-1).end - stressed.end >= 2).toBe(true);
    expect(apples.at(-1).end - stressed.min >= 2).toBe(true);
    expect(vowels[0].start - vowels.at(-1).end >= 4).toBe(true);
  });

  it('boosts focus and compresses what follows', () => {
    const focus = measure('*Anna* came with Manny.', 'en', { markup: true });
    const plain = measure('Anna came with Manny.');
    expect(focus.vowels[0].max - plain.vowels[0].max >= 2.5).toBe(true);
    const manny = ({ vowels }) =>
      ofWord(vowels, vowels.at(-1).word).find((vowel) => vowel.stress === 1);
    expect(manny(plain).max - manny(focus).max >= 1.5).toBe(true);
  });

  it('scales focus with the emphasis level', () => {
    const peak = (level) =>
      measure(
        `<speak><emphasis level="${level}">Anna</emphasis> came with Manny.</speak>`
      ).vowels[0].max;
    const plain = measure('Anna came with Manny.').vowels[0].max;
    const strong = peak('strong') - plain;
    const moderate = peak('moderate') - plain;
    expect(moderate > 0.3 * strong).toBe(true);
    expect(moderate < 0.7 * strong).toBe(true);
    expect(peak('reduced') < plain - 0.5).toBe(true);
  });
});

describe('Russian intonation constructions', () => {
  it('puts the Russian question rise on the stressed vowel', () => {
    const { vowels } = measure('Это мама?', 'ru');
    const mama = ofWord(vowels, vowels[2].word);
    expect(mama[0].end - mama[0].start >= 6).toBe(true);
    expect(vowels.at(-1).end < vowels[0].start).toBe(true);
    const plain = measure('Это мама.', 'ru').vowels;
    expect(plain.every((vowel) => vowel.max - vowel.start <= 1)).toBe(true);
  });

  it('moves the Russian centre with emphasis', () => {
    const { vowels } = measure('*Ты* придёшь?', 'ru', { markup: true });
    const [ty, ...after] = vowels;
    expect(ty.end - ty.start >= 6).toBe(true);
    expect(after.every((vowel) => vowel.max < ty.max)).toBe(true);
  });

  it('keeps Russian wh-questions falling', () => {
    const { vowels } = measure('Кто пришёл?', 'ru');
    expect(vowels[0].start - vowels.at(-1).end >= 4).toBe(true);
    expect(textToIpa('А ты куда идёшь?', { lang: 'ru' }).ipa).toMatch(/↘ \?$/u);
  });

  it('gives short а-questions IK4 and как-exclamations IK5', () => {
    const ik4 = textToIpa('А вы?', { lang: 'ru' });
    expect(ik4.ipa.startsWith('{IK4 ')).toBe(true);
    expect(ik4.modes[0].mode.tune).toBe('IK4');
    const { vowels } = measure('А вы?', 'ru');
    expect(vowels.at(-1).end - vowels.at(-1).min >= 4).toBe(true);
    expect(textToIpa('Какая погода!', { lang: 'ru' }).ipa).toMatch(/^\{IK5 /u);
    expect(textToIpa('Он пришёл!', { lang: 'ru' }).ipa).not.toMatch(/IK/u);
  });
});

describe('Hindi accent phrases', () => {
  it('builds Hindi accent phrases', () => {
    const { vowels } = measure('लड़का घर जाएगा।', 'hi');
    const first = ofWord(vowels, vowels[0].word);
    expect(first.at(-1).end - first[0].start >= 2).toBe(true);
    const question = measure('तुम आओगे?', 'hi').vowels.at(-1).end;
    const statement = measure('तुम आओगे।', 'hi').vowels.at(-1).end;
    expect(question - statement >= 4).toBe(true);
    const wh = measure('तुम कहाँ जा रहे हो?', 'hi').vowels;
    expect(wh.at(-1).end < wh[0].start).toBe(true);
  });
});

describe('Mandarin questions', () => {
  it('raises Mandarin questions without breaking tones', () => {
    const lastWord = (vowels) => ofWord(vowels, vowels.at(-1).word);
    const question = measure('你来？', 'zh').vowels;
    const statement = measure('你来。', 'zh').vowels;
    expect(meanOf(lastWord(question)) - meanOf(lastWord(statement)) >= 2).toBe(
      true
    );
    const fall = measure('他去？', 'zh').vowels.at(-1);
    expect(fall.start - fall.end >= 3).toBe(true);
    const particle = measure('你来吗？', 'zh').vowels;
    const lai = ofWord(particle, particle[1].word);
    const plainLai = ofWord(statement, statement[1].word);
    expect(meanOf(lai) - meanOf(plainLai) < 1.5).toBe(true);
  });

  it('lets Mandarin wh-questions fall without a raise', () => {
    expect(textToIpa('你去哪里？', { lang: 'zh' }).ipa).toMatch(/↘ \?$/u);
    expect(textToIpa('他几乎来了？', { lang: 'zh' }).ipa).toMatch(/[^↘] \?$/u);
    expect(ZH_WH_WORDS).toContain('为什么');
  });
});

describe('sentence types from text', () => {
  const ipa = (text, lang = 'en') => textToIpa(text, { lang }).ipa;

  it('writes alternative questions', () => {
    expect(ipa('Tea or coffee?')).toBe('ˈti ↗ | ˈɔɹ ˈkɑfi ↘ ?');
    expect(ipa('Чай или кофе?', 'ru')).toMatch(/↗ \| ˈilʲɪ .* ↘ \?$/u);
    expect(ipa('चाय या कॉफ़ी?', 'hi')).toMatch(/↗ \| jaː .* ↘ \?$/u);
    expect(ipa('茶还是咖啡？', 'zh')).toMatch(/↗ \| xaɪ.* ↘ \?$/u);
  });

  it('writes echo questions and tags with a rise', () => {
    expect(ipa('You are coming?')).toMatch(/↗ \?$/u);
    expect(ipa("You are coming, aren't you?")).toMatch(/, ˈɑɹənt ju ↗ \?$/u);
    expect(ipa('Are you coming?')).toMatch(/[^↗↘] \?$/u);
    expect(ipa('What are you looking at?')).toMatch(/↘ \?$/u);
    expect(ipa('Do you know where he is?')).toMatch(/[^↗↘] \?$/u);
    expect(englishAuxiliary("won't")).toBe('will');
    expect(englishAuxiliary('aren’t')).toBe('are');
    expect(englishAuxiliary('coming')).toBe(null);
  });

  it('breaks long phrases', () => {
    const text =
      'The old man walked slowly down the long dusty road and he looked at all the empty houses again.';
    const { ipa: written } = textToIpa(text, { lang: 'en' });
    const plain = written.replace(/ \|/gu, '');
    expect(syllabifyIpa(plain, { language: 'en' }).flat().length).toBe(24);
    expect(written).toMatch(/ \| ənd /u);
    expect(ipa('The old man walked slowly down the road.')).not.toMatch(/\|/u);
    expect(PHRASE_CONJUNCTIONS.zh).toContain('因为');
    expect(ALTERNATIVE_CONJUNCTIONS.ru).toBe('или');
  });

  it('gives the phrase before a break a continuation', () => {
    const { vowels, plan } = measure(
      'The old man walked slowly down the long dusty road and he looked at all the empty houses again.'
    );
    const dash = plan.segments.find(
      (segment) => segment.kind === 'pause' && segment.boundary === 'dash'
    );
    const before = vowels.filter((vowel) => vowel.segment.end <= dash.start);
    expect(before.at(-1).end > vowels.at(-1).end + 3).toBe(true);
  });
});

describe('tune markup', () => {
  it('lists the same tune names in the markup and the model', () => {
    expect([...TUNE_LABELS].sort()).toEqual([...TUNE_NAMES].sort());
    expect(Object.keys(TUNES).sort()).toEqual(['en', 'hi', 'ru', 'zh']);
    expect(FOCUS.en.pitch).toBe(2.9);
    expect(intonationLanguage('ru-RU')).toBe('ru');
    expect(intonationLanguage('de')).toBe('en');
  });

  it('reads tunes from IPA marks, inline tags and SSML', () => {
    expect(parseIpa('{IK4 a ˈvɨ ? IK4}').modes[0].mode.tune).toBe('IK4');
    const inline = textToIpa('[tune call]John![/tune]', {
      lang: 'en',
      markup: true,
    });
    expect(inline.ipa).toBe('{call ˈd͡ʒɑn call} !');
    const ssml = textToIpa(
      '<speak><vs:tune name="command">Sit down!</vs:tune></speak>',
      { lang: 'en' }
    );
    expect(ssml.modes[0].mode.tune).toBe('command');
    const unknown = textToIpa(
      '<speak><vs:tune name="nope">Hi!</vs:tune></speak>',
      { lang: 'en' }
    );
    expect(unknown.warnings[0].message).toBe('unknown tune nope');
  });

  it('lets a tune win over the punctuation', () => {
    const statement = measure('You are coming.').vowels.at(-1).end;
    const asked = measure('[tune yesno]You are coming.[/tune]', 'en', {
      markup: true,
    }).vowels.at(-1).end;
    expect(asked - statement >= 6).toBe(true);
  });
});
