/** Shipped public-domain counts. Modules contain counts, never IPA. */
import * as en from './en.js';
import * as ru from './ru.js';
import * as hi from './hi.js';
import * as zh from './zh.js';

const DATA = new Map([
  ['en', en],
  ['ru', ru],
  ['hi', hi],
  ['zh', zh],
]);
const opened = new Map();

export function getCounts(language) {
  if (!DATA.has(language)) {
    throw new RangeError(`unsupported recognition language "${language}"`);
  }
  if (!opened.has(language)) {
    const data = DATA.get(language);
    const words = data.WORDS.split(' ')
      .filter(Boolean)
      .map((item) => {
        const at = item.lastIndexOf('=');
        return { word: item.slice(0, at), count: Number(item.slice(at + 1)) };
      });
    const counts = new Map(words.map((item) => [item.word, item.count]));
    const bigrams = new Map(
      data.BIGRAMS.split(' ')
        .filter(Boolean)
        .map((item) => {
          const [pair, count] = item.split('=');
          const [a, b] = pair.split(',').map(Number);
          return [`${words[a].word}\t${words[b].word}`, Number(count)];
        })
    );
    opened.set(language, {
      words,
      counts,
      bigrams,
      total: words.reduce((sum, item) => sum + item.count, 0),
    });
  }
  return opened.get(language);
}

/** Discounted bigram probability with the specified unigram back-off. */
export function wordCost(data, previous, word) {
  const pair = previous && data.bigrams.get(`${previous}\t${word}`);
  const probability = pair
    ? (pair - 0.75) / data.counts.get(previous)
    : (0.4 * (data.counts.get(word) ?? 1)) / data.total;
  return -0.3 * Math.log(probability) + 0.5;
}
