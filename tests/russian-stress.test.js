/**
 * Russian stress outside the small dictionary and for homographs
 * (issue 48): whole forms, stems with endings, homographs by context,
 * restored ё, typed marks, the guess table and the hand-marked fixture.
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { textToIpa } from '../src/g2p/index.js';
import { lexiconFor } from '../src/g2p/lexicon.js';
import { RU_GUESS } from '../src/g2p/lexicon/ru.js';
import {
  findRussianStress,
  guessRussianStress,
  russianWordToIpa,
} from '../src/g2p/russian.js';
import { RUSSIAN_HOMOGRAPHS } from '../src/g2p/russian-homographs.js';
import {
  readRussianStress,
  russianGuessTable,
  splitGuessWords,
} from '../scripts/lexicon-ru.mjs';
import { measureRussianFixture } from './helpers/russian-stress-fixture.js';

const ru = (text) => textToIpa(text, { lang: 'ru' }).ipa;
const stressData = () =>
  readRussianStress(
    readFileSync(
      fileURLToPath(import.meta.resolve('../data/lexicon/ru-stress.txt')),
      'utf8'
    )
  );

describe('Russian stress', () => {
  it('stresses inflected forms', () => {
    expect(ru('Мы пошли в лес')).toContain('pɐˈʂlʲi');
    expect(ru('Они увидели дерево')).toContain('ʊˈvʲidʲɪlʲɪ');
    expect(ru('хорошая погода')).toContain('xɐˈroʂəjə');
    expect(ru('Я купил телефон')).toContain('kʊˈpʲiɫ');
    expect(ru('Я купил телефон')).toContain('tʲɪlʲɪˈfon');
    expect(ru('5 часов')).toContain('t͡ɕɪˈsof');
    expect(ru('дорого')).toBe('ˈdorəɡə');
  });

  it('chooses homographs by context', () => {
    expect(ru('Ключ от замка')).toContain('zɐmˈka');
    expect(ru('Старый замок на горе')).toContain('ˈzamək');
    expect(ru('Старый замок на горе')).toContain('ɡɐˈrʲe');
    expect(ru('Это стоит дорого')).toContain('ˈstoɪt');
    expect(ru('Он стоит там')).toContain('stɐˈit');
    expect(ru('3 часа')).toContain('t͡ɕɪˈsa');
    expect(ru('большие города')).toContain('ɡərɐˈda');
    expect(ru('из города')).toContain('ˈɡorədə');
    const spellings = new Set(
      RUSSIAN_HOMOGRAPHS.flatMap(([forms]) =>
        forms.map((pair) => pair.split('/')[0].replaceAll('+', ''))
      )
    );
    expect(spellings.size).toBeGreaterThanOrEqual(60);
  });

  it('restores ё', () => {
    expect(ru('еще ее елка зеленый идет пришел')).toBe(
      'jɪˈɕːo jɪˈjo ˈjoɫkə zʲɪˈlʲonɨj ɪˈdʲot prʲɪˈʂoɫ'
    );
    expect(ru('все')).toBe('fsʲe');
    expect(findRussianStress('еще').letters).toBe('ещё');
  });

  it('keeps user marks', () => {
    expect(ru('замо́к з+амок')).toBe('zɐˈmok ˈzamək');
    expect(ru('Ключ от з+амка, старый замо́к')).toContain('ˈzamkə');
    expect(ru('Ключ от з+амка, старый замо́к')).toContain('zɐˈmok');
    expect(findRussianStress('з+амок').source).toBe('user');
  });

  it('reports where the stress comes from', () => {
    expect(findRussianStress('привет').source).toBe('dictionary');
    expect(findRussianStress('телефоны').source).toBe('morphology');
    expect(findRussianStress('кракозябрами').source).toBe('rules');
    expect(russianWordToIpa('телефонами').source).toBe('morphology');
  });

  it('guesses unknown words', () => {
    const { counted, heldOut } = splitGuessWords(stressData().words);
    // The shipped table is the one the build derives from the data.
    expect(RU_GUESS).toEqual(russianGuessTable(counted));
    const right = heldOut.filter(
      ([word, stress]) => guessRussianStress(word) === stress
    ).length;
    expect(right / heldOut.length).toBeGreaterThanOrEqual(0.65);
  });

  it('ships the lexicon', () => {
    const { forms, stems } = stressData();
    expect(stems.size).toBeGreaterThanOrEqual(5000);
    expect(forms.size).toBeGreaterThanOrEqual(1500);
    expect(lexiconFor('ru', 'stems').size).toBe(stems.size);
    expect(lexiconFor('ru', 'forms').size).toBe(forms.size);
  });

  it('reaches the sentence target', () => {
    const { all, homograph } = measureRussianFixture();
    expect(all.right / all.total).toBeGreaterThanOrEqual(0.9);
    expect(homograph.right / homograph.total).toBeGreaterThanOrEqual(0.8);
  });
});
