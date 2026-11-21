import { describe, it, expect } from 'test-anywhere';
import {
  readFileSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  corpusWords,
  buildCounts,
  writeCounts,
} from '../scripts/build-recognition-data.mjs';
import {
  getCounts,
  wordCost,
  wordTransition,
} from '../src/recognition/data/index.js';
import * as en from '../src/recognition/data/en.js';
import * as ru from '../src/recognition/data/ru.js';
import * as hi from '../src/recognition/data/hi.js';
import * as zh from '../src/recognition/data/zh.js';

describe('recognition count tables', () => {
  for (const [language, data] of Object.entries({ en, ru, hi, zh })) {
    it(`${language}: bounded, sorted words and observed indexed bigrams`, () => {
      const counts = getCounts(language);
      expect(counts).toBe(getCounts(language));
      expect(counts.words.length > 5000 && counts.words.length <= 20000).toBe(
        true
      );
      expect(new Set(counts.words.map((w) => w.word)).size).toBe(
        counts.words.length
      );
      expect(data.CORPUS_WORDS >= 1000000).toBe(true);
      const bytes = (name) =>
        statSync(
          new globalThis.URL(
            `../src/recognition/data/${name}.js`,
            import.meta.url
          )
        ).size;
      expect(bytes(language) + bytes(`${language}-bigrams`) <= 800000).toBe(
        true
      );
      let previous = Infinity;
      for (const { word, count } of counts.words) {
        expect(
          Number.isSafeInteger(count) && count > 0 && count <= previous
        ).toBe(true);
        if (language === 'zh') {
          expect([...word].length >= 1 && [...word].length <= 4).toBe(true);
        }
        previous = count;
      }
      const pairs = data.BIGRAMS.split(' ').filter(Boolean);
      expect(pairs.length <= 40000).toBe(true);
      previous = Infinity;
      for (const pair of pairs) {
        const [indices, value] = pair.split('=');
        const count = Number(value);
        expect(
          Number.isSafeInteger(count) && count >= 3 && count <= previous
        ).toBe(true);
        for (const index of indices.split(',').map(Number)) {
          expect(
            Number.isInteger(index) && index >= 0 && index < counts.words.length
          ).toBe(true);
        }
        previous = count;
      }
      const sources = readFileSync(
        new globalThis.URL(
          '../src/recognition/data/SOURCES.md',
          import.meta.url
        ),
        'utf8'
      );
      expect(sources.includes(`## ${language}`)).toBe(true);
      expect(sources.match(/[a-f0-9]{64}/g).length >= 20).toBe(true);
    });
  }

  it('uses discounted bigrams and the specified unigram backoff', () => {
    const data = {
      counts: new Map([
        ['a', 10],
        ['b', 5],
      ]),
      total: 15,
      bigrams: new Map([['a\tb', 3]]),
    };
    expect(wordCost(data, 'a', 'b')).toBe(-0.3 * Math.log(2.25 / 10) + 0.5);
    expect(wordCost(data, null, 'b')).toBe(
      -0.3 * Math.log((0.4 * 5) / 15) + 0.5
    );
  });

  it('scores indexed corpus pairs and missing predecessors exactly as the reference', () => {
    for (const language of ['en', 'ru', 'hi', 'zh']) {
      const data = getCounts(language);
      for (const [pair] of Array.from(data.bigrams).slice(0, 16)) {
        const [previous, word] = pair.split('\t');
        const transition = wordTransition(data, word);
        expect(transition(previous)).toBe(wordCost(data, previous, word));
        expect(transition('')).toBe(wordCost(data, '', word));
        expect(transition('🦊')).toBe(wordCost(data, '🦊', word));
      }
    }
  });

  it('counts real source words and pairs without bridging sentence or file boundaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-recognition-counts-'));
    try {
      const first = join(dir, 'a.txt');
      const second = join(dir, 'b.txt');
      const text = 'two cats. two cats! two cats?';
      writeFileSync(first, text);
      writeFileSync(second, 'hello world');
      const data = buildCounts([second, first], 'en');
      expect(data.total).toBe(8);
      expect(new Map(data.words).get('two')).toBe(3);
      const index = new Map(data.words.map(([word], i) => [word, i]));
      expect(data.bigrams).toEqual([
        [`${index.get('two')},${index.get('cats')}`, 3],
      ]);
      expect(data.sources[0].sha256).toBe(
        createHash('sha256').update(text).digest('hex')
      );
      writeCounts(data, 'en', dir);
      const modules = ['en.js', 'en-bigrams.js'];
      const readModules = () =>
        modules.map((name) => readFileSync(join(dir, name), 'utf8'));
      const before = readModules();
      writeCounts(buildCounts([first, second], 'en'), 'en', dir);
      expect(readModules()).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalises historical Russian, Hindi punctuation and greedy Mandarin words explicitly', () => {
    expect(corpusWords('Міръ мѣдъ ѳита ѵ', 'ru')).toEqual([
      'мир',
      'мед',
      'фита',
      'и',
    ]);
    expect(corpusWords('एक। दो १२३', 'hi')).toEqual(['एक', 'दो']);
    expect(
      corpusWords('我们今天学习', 'zh', new Set(['我们', '今天', '学习']))
    ).toEqual(['我们', '今天', '学习']);
  });

  it('preserves ordinary corpus words without false dependency-name matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-recognition-literals-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      const words = [['torch', 4]];
      writeCounts({ words, bigrams: [], total: 4 }, 'en', dir);
      const source = readFileSync(join(dir, 'en.js'), 'utf8');
      expect(/onnx|tensorflow|torch/u.test(source)).toBe(false);
      const data = await import(pathToFileURL(join(dir, 'en.js')).href);
      expect(data.WORDS).toBe('torch=4');
      expect(en.WORDS.includes('torch=4')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
