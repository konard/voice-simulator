/**
 * Pronunciation lexicons: the vslex container, the shipped lexicons of
 * English, Chinese and Hindi, user lexicons and the size budgets.
 */

import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'test-anywhere';
import { encodeVslex } from '../src/g2p/vslex.js';
import {
  addLexicon,
  clearLexicons,
  lexiconFor,
  lexiconWords,
  openLexicon,
  pronunciations,
  spellingsOf,
} from '../src/g2p/lexicon.js';
import { textToIpa } from '../src/g2p/index.js';
import { englishDictionarySize, englishWordToIpa } from '../src/g2p/english.js';
import { chineseWordToIpa } from '../src/g2p/chinese.js';
import { hindiWordToIpa } from '../src/g2p/hindi.js';
import { runCli } from '../bin/voice-simulator.js';

const LETTERS = "abcdefghijklmnopqrstuvwxyz'";
const SOUNDS = ['a', 'i', 'u', 'ˈ', 'ɹ', 'ð', 'ŋ', 't͡ʃ', 'ə', 'k', 's', 'oʊ'];

/** A deterministic pseudo-random generator (a linear congruence). */
function random(seed) {
  let state = seed;
  return (limit) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % limit;
  };
}

function testEntries() {
  const next = random(47);
  const entries = new Map([
    ['a', ['ə', 'ˈeɪ']],
    ['aa', ['ˌeɪˈeɪ']],
    ['aaaaaaaaaaaa', ['ˈa']],
    ['aaaaaaaaaaab', ['ˈab']],
    ["don't", ['ˈdoʊnt']],
  ]);
  while (entries.size < 1000) {
    const length = 1 + next(12);
    let word = '';
    for (let index = 0; index < length; index++) {
      word += LETTERS[next(index === 0 ? 26 : LETTERS.length)];
    }
    const variants = Array.from({ length: 1 + next(2) }, () =>
      Array.from({ length: 1 + next(8) }, () => SOUNDS[next(12)]).join('')
    );
    if (!entries.has(word)) {
      entries.set(word, [...new Set(variants)]);
    }
  }
  return entries;
}

describe('pronunciation lexicons', () => {
  it('round-trips a lexicon', () => {
    const entries = testEntries();
    const data = JSON.parse(JSON.stringify(encodeVslex('en', entries)));
    const lexicon = openLexicon(data);
    expect(lexicon.size).toBe(1000);
    for (const [word, variants] of entries) {
      expect(lexicon.lookup(word)).toEqual(variants);
    }
    expect(lexicon.lookup('a')).toEqual(['ə', 'ˈeɪ']);
    expect(lexicon.lookup("don't")).toEqual(['ˈdoʊnt']);
    expect(lexicon.lookup('DON’T')).toEqual(['ˈdoʊnt']);
    let others = 0;
    for (let index = 0; others < 100; index++) {
      const word = `${'zq'.repeat(1 + (index % 7))}${index}`;
      if (!entries.has(word)) {
        expect(lexicon.lookup(word)).toBe(null);
        expect(lexicon.has(word)).toBe(false);
        others++;
      }
    }
    expect(lexicon.lookup('aaaaaaaaaaa')).toBe(null);
    expect(lexicon.lookup('')).toBe(null);
    expect([...lexicon.words()].sort()).toEqual([...entries.keys()].sort());
  });

  it('stores the letters of a word as ASCII when asked', () => {
    const entries = new Map([
      ['стол', ['+']],
      ['столик', ['a']],
      ['ёлк', ['a']],
      ['зелён', ['b']],
    ]);
    const plain = encodeVslex('ru', entries);
    const data = JSON.parse(
      JSON.stringify(encodeVslex('ru', entries, { ascii: true }))
    );
    expect(data.letters).toBe([...new Set('столикёлкзелён')].sort().join(''));
    expect(/^[A-Za-z]*$/u.test(data.alphabet)).toBe(true);
    expect(plain.letters).toBe(undefined);
    const lexicon = openLexicon(data);
    for (const [word, variants] of entries) {
      expect(lexicon.lookup(word)).toEqual(variants);
    }
    expect(lexicon.lookup('стул')).toBe(null);
    expect(lexicon.lookup('stol')).toBe(null);
    expect([...lexicon.words()].sort()).toEqual([...entries.keys()].sort());
  });

  it('keeps all CMUdict variants', () => {
    const either = pronunciations('en', 'either');
    expect(either.length).toBe(2);
    expect(either.some((ipa) => ipa.startsWith('ˈi'))).toBe(true);
    expect(either.some((ipa) => ipa.startsWith('ˈaɪ'))).toBe(true);
    expect(englishDictionarySize()).toBeGreaterThanOrEqual(20000);
  });

  it('prefers the user lexicon', () => {
    const word = (options) =>
      textToIpa('quinoa', { lang: 'en', ...options }).words[0];
    const user = word({ lexicon: { en: { quinoa: 'kiˈnoʊə' } } });
    expect(user.ipa).toBe('kiˈnoʊə');
    expect(user.source).toBe('user');
    const shipped = word();
    expect(shipped.ipa.startsWith('ˈkin')).toBe(true);
    expect(shipped.source).toBe('dictionary');
    expect(() =>
      textToIpa('x', { lang: 'en', lexicon: { en: { x: '' } } })
    ).toThrow('"x"');
    // Speech markup reads its words with the same lexicon.
    const lexicon = { en: { quinoa: 'kiˈnoʊə' } };
    const marked = textToIpa('[whisper]quinoa[/whisper]', {
      lang: 'en',
      markup: true,
      lexicon,
    });
    expect(marked.ipa).toBe('{W kiˈnoʊə W}');
    expect(
      textToIpa('<speak>quinoa</speak>', { lang: 'en', lexicon }).words[0]
        .source
    ).toBe('user');
  });

  it('adds and clears user lexicons', () => {
    try {
      expect(addLexicon('en', { segue: 'ˈsɛɡweɪ', tomato: 'təˈmɑtoʊ' })).toBe(
        2
      );
      expect(englishWordToIpa('tomato')).toEqual({
        ipa: 'təˈmɑtoʊ',
        source: 'user',
      });
      expect(pronunciations('en', 'tomato')[0]).toBe('təˈmɑtoʊ');
      expect(spellingsOf('en', 'təˈmɑtoʊ')).toContain('tomato');
      expect(() => addLexicon('fr', { chat: 'ʃa' })).toThrow('fr');
      expect(() => addLexicon('en', { bad: '¤' })).toThrow('"bad"');
    } finally {
      clearLexicons();
    }
    expect(englishWordToIpa('tomato').source).toBe('dictionary');
  });

  it('finds spellings', () => {
    const spellings = spellingsOf('en', 'ˈðɛɹ');
    expect(spellings).toContain('there');
    expect(spellings).toContain('their');
    expect(spellingsOf('zh', 'ʈ͡ʂʰʊŋ˧˥ t͡ɕʰiŋ˥˩')).toContain('重庆');
  });

  it('reads polyphones in words', () => {
    const expected = {
      重庆: 'chóng qìng',
      还钱: 'huán qián',
      首都: 'shǒu dū',
      行为: 'xíng wéi',
      教书: 'jiāo shū',
      干净: 'gān jìng',
      少年: 'shào nián',
      大夫: 'dài fu',
      着急: 'zháo jí',
      有空: 'yǒu kòng',
      种树: 'zhòng shù',
      银行: 'yín háng',
    };
    for (const [word, pinyin] of Object.entries(expected)) {
      expect(`${word} ${chineseWordToIpa(word).pinyin}`).toBe(
        `${word} ${pinyin}`
      );
    }
    const user = textToIpa('重庆', {
      lang: 'zh',
      lexicon: { zh: { 重庆: 'zhòng qìng' } },
    }).words[0];
    expect(user.source).toBe('user');
  });

  it('uses the Hindi lexicon', () => {
    expect(hindiWordToIpa('लोकसभा')).toEqual({
      ipa: 'loːksəbʱaː',
      source: 'dictionary',
    });
    expect(hindiWordToIpa('ज्ञान').ipa).toBe('ɡjaːn');
    expect(hindiWordToIpa('धड़कनें')).toEqual({
      ipa: 'd̪ʱəɽkənẽː',
      source: 'dictionary',
    });
  });

  it('opens each shipped lexicon and lists its words', () => {
    expect(lexiconFor('ru', 'stress').has('привет')).toBe(true);
    expect(lexiconFor('hi').size).toBeGreaterThanOrEqual(200);
    expect(lexiconFor('zh', 'phrases').size).toBeGreaterThanOrEqual(600);
    expect(pronunciations('ru', 'привет')).toEqual(['prʲɪˈvʲet']);
    let count = 0;
    for (const word of lexiconWords('hi')) {
      expect(typeof word).toBe('string');
      count++;
    }
    expect(count).toBe(lexiconFor('hi').size);
  });
});

describe('lexicon files and budgets', () => {
  it('loads --lexicon files in the CLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-simulator-lexicon-'));
    const plain = join(dir, 'en.json');
    const full = join(dir, 'zh.json');
    writeFileSync(plain, JSON.stringify({ quinoa: 'kiˈnoʊə' }));
    writeFileSync(
      full,
      JSON.stringify({
        format: 'lexicon',
        version: 1,
        lang: 'zh',
        count: 1,
        words: { 重庆: ['zhòng qìng'] },
      })
    );
    const run = async (args) => {
      const out = [];
      const err = [];
      const code = await runCli(args, {
        stdout: (line) => out.push(line),
        stderr: (line) => err.push(line),
      });
      return { code, out: out.join('\n'), err: err.join('\n') };
    };
    try {
      const english = await run([
        'ipa',
        '-l',
        'en',
        '--lexicon',
        plain,
        'quinoa',
      ]);
      expect(english).toEqual({ code: 0, out: 'kiˈnoʊə', err: '' });
      const chinese = await run(['ipa', '--json', '--lexicon', full, '重庆']);
      expect(JSON.parse(chinese.out).words[0].pinyin).toBe('zhòng qìng');
      const noLang = await run(['ipa', '--lexicon', plain, 'quinoa']);
      expect(noLang.code).toBe(1);
      expect(noLang.err).toContain('--lang');
      expect((await run(['--help'])).out).toContain('--lexicon <file>');
    } finally {
      clearLexicons();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stays inside the budgets', () => {
    const folder = fileURLToPath(
      new globalThis.URL('../src/g2p/lexicon/', import.meta.url)
    );
    const sizes = readdirSync(folder).map(
      (name) => statSync(join(folder, name)).size
    );
    expect(statSync(join(folder, 'en.js')).size).toBeLessThanOrEqual(246045);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(
      420000
    );
  });
});
