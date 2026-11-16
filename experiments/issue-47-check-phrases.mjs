/**
 * Check hand-written Chinese words (issue 47) before adding them to
 * data/lexicon/zh-phrases.txt:
 *   - every syllable must be a Unihan kTGHZ2013 reading of its character;
 *   - words of 2 to 4 characters only;
 *   - compare with the majority AISHELL-3 reading in the training split
 *     (lines whose index % 10 != 0) and print the disagreements.
 *
 * node experiments/issue-47-check-phrases.mjs <phrases.txt> <unihan dir> <aishell content.txt>
 */
import { readFileSync } from 'node:fs';
import {
  unihanReadings,
  unihanReadingsText,
} from '../scripts/lexicon-sources.mjs';
import { parseAishellLine, sameReading } from '../scripts/lexicon-metrics.mjs';
import { readingLetter } from '../scripts/lexicon-zh.mjs';

const [file, unihan, aishell] = process.argv.slice(2);
const readings = unihanReadings(unihanReadingsText(unihan));
const words = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const clean = line.replace(/#.*$/, '').trim();
  if (!clean) {
    continue;
  }
  const [word, ...syllables] = clean.split(/\s+/);
  words.push({
    word: word.normalize('NFC'),
    syllables: syllables.map((s) => s.normalize('NFC')),
  });
}
const lines = aishell
  ? readFileSync(aishell, 'utf8')
      .split('\n')
      .filter((_, i) => i % 10 !== 0)
  : [];
const texts = lines.map(parseAishellLine).filter(Boolean);
let bad = 0;
const seenWords = new Set();
for (const { word, syllables } of words) {
  const chars = [...word];
  const problems = [];
  if (seenWords.has(word)) {
    problems.push('duplicate');
  }
  seenWords.add(word);
  if (chars.length < 2 || chars.length > 4) {
    problems.push(`${chars.length} characters`);
  }
  if (chars.length !== syllables.length) {
    problems.push('syllable count');
  }
  chars.forEach((char, i) => {
    const list = readings.get(char);
    if (!list) {
      problems.push(`${char} has no readings`);
    } else if (syllables[i] && !readingLetter(list, syllables[i])) {
      problems.push(`${char} ${syllables[i]} not in ${list.join(',')}`);
    }
  });
  // AISHELL comparison
  let hits = 0;
  let agree = 0;
  const other = new Map();
  for (const t of texts) {
    const joined = t.chars.join('');
    let at = joined.indexOf(word);
    while (at >= 0 && t.chars.length === [...joined].length) {
      hits++;
      const theirs = t.pinyin.slice(at, at + chars.length);
      const ok = chars.every(
        (c, i) =>
          sameReading(c, syllables[i], theirs[i]) ||
          (/5$/.test(theirs[i]) &&
            syllables[i] &&
            !/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(syllables[i]) &&
            theirs[i].replace(/\d$/, '') === syllables[i].replace('ü', 'v'))
      );
      if (ok) {
        agree++;
      } else {
        const key = theirs.join(' ');
        other.set(key, (other.get(key) ?? 0) + 1);
      }
      at = joined.indexOf(word, at + 1);
    }
  }
  if (hits > 0 && agree < hits / 2) {
    problems.push(
      `AISHELL ${agree}/${hits} agree; ${[...other]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k, v]) => `${k}×${v}`)
        .join(', ')}`
    );
  }
  if (problems.length) {
    bad++;
    console.log(`${word} ${syllables.join(' ')}: ${problems.join('; ')}`);
  }
}
console.log(`${words.length} words, ${bad} with remarks`);
