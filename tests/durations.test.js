/**
 * Issue 39: the rule-based segment duration model of
 * src/articulation/durations.js (Klatt 1979 with per-language tables).
 * The numbers come from experiments/issue-11-fit-durations.mjs.
 */

import { describe, expect, it } from 'test-anywhere';
import {
  DURATION_RULES,
  DURATION_TABLES,
  RATE_MINIMUM,
  RATE_STRETCH,
  durationFeatures,
  durationFormula,
  durationTable,
  minimumDuration,
  segmentDuration,
} from '../src/articulation/durations.js';
import { planUtterance } from '../src/articulation/plan.js';
import { parseIpa } from '../src/ipa/parse.js';
import { textToIpa } from '../src/g2p/index.js';
import { normalizeHeadConfig } from '../src/head-config.js';

/** Duration (s) of each token of a plan, summed over its segments. */
function tokenDurations(ipa, language = 'en', head = {}) {
  const plan = planUtterance(ipa, {
    language,
    head: normalizeHeadConfig(head),
  });
  return plan.tokens.map((token) =>
    plan.segments
      .filter(
        (segment) => segment.token === token && segment.kind !== 'release'
      )
      .reduce((sum, segment) => sum + segment.duration, 0)
  );
}

/** Duration of the `count`-th token with symbol `symbol` (0-based). */
function durationOf(ipa, symbol, language = 'en', count = 0) {
  const { tokens } = parseIpa(ipa);
  const durations = tokenDurations(ipa, language);
  const indices = tokens
    .map((token, index) => (token.base === symbol ? index : -1))
    .filter((index) => index >= 0);
  return durations[indices[count]];
}

const between = (value, low, high) => value >= low && value <= high;

describe('segment durations', () => {
  it('applies the formula', () => {
    const at = (percent) =>
      durationFormula({ inherent: 200, minimum: 80, percent });
    expect(Math.abs(at(60) - 0.152) < 1e-9).toBe(true);
    expect(Math.abs(at(0) - 0.08) < 1e-9).toBe(true);
    expect(RATE_MINIMUM).toBe(0.5);
    expect(RATE_STRETCH).toBe(1.2);
    const faster = durationFormula({
      inherent: 200,
      minimum: 80,
      percent: 100,
      speechRate: 2,
    });
    const expected = (80 / 2 ** 0.5 + 120 / 2 ** 1.2) / 1000;
    expect(Math.abs(faster - expected) < 1e-9).toBe(true);
  });

  it('lists rules and tables', () => {
    const names = DURATION_RULES.map((rule) => rule.name);
    for (const name of [
      'clauseFinal',
      'nonPhraseFinal',
      'nonWordFinal',
      'polysyllabic',
      'nonInitialConsonant',
      'unstressedMedial',
      'unstressedOther',
      'unstressedOnset',
      'emphasis',
      'beforeVoicedFricative',
      'beforeVoicedPlosive',
      'beforeNasal',
      'beforeVoiceless',
      'openFinal',
      'vowelBeforeVowel',
      'vowelAfterVowel',
      'clusterMiddle',
      'clusterEdge',
    ]) {
      expect(names.includes(name)).toBe(true);
    }
    expect(Object.keys(DURATION_TABLES).sort()).toEqual([
      'default',
      'en',
      'hi',
      'ru',
      'zh',
    ]);
    expect(durationTable('en-US')).toBe(DURATION_TABLES.en);
    expect(durationTable('fr')).toBe(DURATION_TABLES.default);
    expect(DURATION_TABLES.default.classes).toEqual(DURATION_TABLES.en.classes);
  });

  it('describes the context', () => {
    const { tokens } = parseIpa('ˈstɪkinəs ˈmɑ.');
    const at = (index) => durationFeatures(tokens, index, { language: 'en' });
    expect(at(0).wordInitial).toBe(true);
    expect(at(0).syllableOnset).toBe(true);
    expect(at(0).next).toBe('voicelessPlosive');
    expect(at(2).stress).toBe(1);
    expect(at(2).syllablesInWord).toBe(3);
    expect(at(2).wordFinalSyllable).toBe(false);
    expect(at(2).phraseFinal).toBe(null);
    expect(at(2).previous).toBe('voicelessPlosive');
    expect(at(2).tone).toBe(0);
    expect(at(6).stress).toBe(0);
    expect(at(6).wordFinalSyllable).toBe(true);
    expect(at(7).next).toBe(null);
    const last = tokens.findIndex((token) => token.base === 'ɑ');
    expect(at(last).phraseFinal).toBe('period');
    expect(at(last).emphasis).toBe(false);
    const zh = parseIpa(textToIpa('ma1ma5', { lang: 'zh' }).ipa).tokens;
    expect(durationFeatures(zh, 1).tone).toBe(1);
    expect(durationFeatures(zh, 4).tone).toBe(5);
  });

  it('lengthens vowel before voiced consonant', () => {
    const ratio = durationOf('ˈbæd', 'æ') / durationOf('ˈbæt', 'æ');
    expect(between(ratio, 1.2, 1.8)).toBe(true);
  });

  it('shortens vowels in longer words', () => {
    const stick = durationOf('ˈstɪk', 'ɪ');
    const sticky = durationOf('ˈstɪki', 'ɪ');
    const stickiness = durationOf('ˈstɪkinəs', 'ɪ');
    expect(stick > sticky).toBe(true);
    expect(sticky > stickiness).toBe(true);
  });

  it('shortens consonants in clusters', () => {
    expect(durationOf('ˈstɑ', 's') < durationOf('ˈsɑ', 's')).toBe(true);
  });

  it('lengthens end of phrase', () => {
    const final = durationOf('ˈmɑmɑ.', 'ɑ', 'en', 1);
    const inside = durationOf('ˈmɑmɑ ˈmɑmɑ.', 'ɑ', 'en', 1);
    expect(between(final / inside, 1.2, 1.6)).toBe(true);
  });

  it('reduces Russian vowels in two degrees', () => {
    const durations = tokenDurations('məlɐˈko', 'ru');
    const { tokens } = parseIpa('məlɐˈko');
    const vowels = durations.filter((_, i) => tokens[i].kind === 'vowel');
    expect(vowels.length).toBe(3);
    expect(vowels[0] < vowels[1]).toBe(true);
    expect(vowels[1] < vowels[2]).toBe(true);
  });

  it('keeps Hindi length', () => {
    const ratio = durationOf('kaːl', 'a', 'hi') / durationOf('kəl', 'ə', 'hi');
    expect(between(ratio, 1.6, 2.4)).toBe(true);
  });

  it('shortens neutral tone', () => {
    const { ipa } = textToIpa('ma1ma5', { lang: 'zh' });
    const first = durationOf(ipa, 'a', 'zh', 0);
    const second = durationOf(ipa, 'a', 'zh', 1);
    expect(between(second / first, 0.45, 0.7)).toBe(true);
  });

  it('scales with speech rate', () => {
    const { ipa } = textToIpa('The quick brown fox jumps over the lazy dog.');
    const length = (speechRate) =>
      planUtterance(ipa, {
        language: 'en',
        head: normalizeHeadConfig({ speechRate }),
      }).duration;
    const ratio = length(1.5) / length(1);
    expect(between(ratio, 0.55, 0.8)).toBe(true);
    const { tokens } = parseIpa(ipa);
    const table = DURATION_TABLES.en;
    const options = { speechRate: 1.5 };
    tokens.forEach((token, index) => {
      if (token.kind === 'pause') {
        return;
      }
      const features = durationFeatures(tokens, index, { language: 'en' });
      const duration = segmentDuration(token, features, table, options);
      const shortest = minimumDuration(token, features, table, {
        speechRate: 1,
      });
      expect(duration >= shortest / 1.5 - 1e-12).toBe(true);
    });
  });
});
