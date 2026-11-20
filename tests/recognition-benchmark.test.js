import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { licenceGate, loadPolicy, loadRegistry } from '../scripts/datasets.mjs';
import { textToIpa } from '../src/g2p/index.js';
import { listSymbols } from '../src/ipa/inventory.js';
import {
  baselineRegressions,
  checkFloors,
} from './heavy/helpers/benchmark-baseline.js';
import {
  BENCHMARK,
  checkBaseline,
  normalizeForScoring,
  phoneClass,
  scoreUtterance,
  toneErrors,
} from './heavy/helpers/benchmark.js';

test('normalises text and skips references containing a digit', () => {
  assert.equal(normalizeForScoring('Hello, World!', 'en'), 'hello world');
  assert.equal(normalizeForScoring('Ёлка — это…', 'ru'), 'елка это');
  assert.equal(normalizeForScoring('你好， 世界。', 'zh'), '你好世界');
  assert.equal(normalizeForScoring('Cafe\u0301 \t©', 'en'), 'café');
  assert.equal(scoreUtterance({ text: 'In 1999' }, {}, 'en'), null);
  assert.equal(scoreUtterance({ text: 'साल १९९९' }, {}, 'hi'), null);
});

test('scores an utterance as edit counts and reference lengths', () => {
  const text = 'Take a short walk.';
  const ipa = textToIpa(text, { lang: 'en' }).ipa;
  const scores = scoreUtterance(
    { text },
    { ipa, text: 'Take a long walk.', languages: [{ language: 'en' }] },
    'en'
  );
  assert.deepEqual(scores.wer, { errors: 1, length: 4 });
  assert.equal(scores.per.errors, 0);
  assert.equal(scores.classErr.errors, 0);
  assert.equal(scores.toneErr, null);
  assert.equal(scores.languageRight, true);
});

test('ignores stress, tones, punctuation, pauses and brace labels in PER', () => {
  const text = 'Hello';
  const ipa = textToIpa(text, { lang: 'en' }).ipa;
  const scores = scoreUtterance(
    { text },
    {
      ipa: `{W ${ipa.replace(/[ˈˌ]/gu, '')}˥ ? (.) W}`,
      text,
      languages: [],
    },
    'en'
  );
  assert.equal(scores.per.errors, 0);
  assert.equal(scores.languageRight, false);
});

test('maps every phone in the inventory to exactly one broad class', () => {
  for (const symbol of listSymbols()) {
    assert.match(phoneClass(symbol), /^[VPAFNL]$/u, symbol);
  }
  assert.equal(phoneClass('t͡ʃ'), 'A');
  assert.equal(phoneClass('kʰ'), 'P');
  assert.equal(phoneClass('ʟ'), 'L');
});

test('counts tone errors only on aligned syllables', () => {
  assert.deepEqual(toneErrors('ni˧˥ xɑʊ˨˩˦', 'ni˨˩˦ xɑʊ˨˩˦'), {
    errors: 1,
    length: 2,
  });
  assert.deepEqual(toneErrors('ni˧˥ xɑʊ˨˩˦', 'tɕi˥ ni˧˥ xɑʊ˨˩˦'), {
    errors: 0,
    length: 2,
  });
});

test('ratchets comparable rates and explains mismatched sample sizes', () => {
  const baseline = {
    limit: 50,
    sets: {
      'fleurs-en': {
        low: { per: 0.7, languageRight: 0.6, rtf: 2, utterances: 50 },
      },
    },
  };
  const measured = JSON.parse(JSON.stringify(baseline));
  assert.deepEqual(checkBaseline(measured, baseline), []);
  const low = measured.sets['fleurs-en'].low;
  low.per = 0.72;
  low.languageRight = 0.56;
  low.rtf = 3;
  assert.deepEqual(checkBaseline(measured, baseline), []);
  assert.match(
    baselineRegressions(measured, baseline).join(),
    /fleurs-en low per/u
  );
  low.per = 0.73;
  assert.match(checkBaseline(measured, baseline).join(), /fleurs-en low per/u);
  low.per = 0.6;
  assert.deepEqual(checkBaseline(measured, baseline), []);
  low.languageRight = 0.55;
  low.rtf = 3.01;
  assert.equal(checkBaseline(measured, baseline).length, 2);

  const notices = [];
  const margins = { notice: (message) => notices.push(message) };
  low.utterances = 49;
  assert.deepEqual(checkBaseline(measured, baseline, margins), []);
  assert.match(notices.pop(), /utterance count/u);
  measured.limit = 5;
  assert.deepEqual(checkBaseline(measured, baseline, margins), []);
  assert.match(notices.pop(), /limit/u);
});

test('enforces the quality floors before the first baseline', () => {
  const medium = { per: 0.8, classErr: 0.55, cer: 0.5, utterances: 10 };
  const low = { ...medium, cer: 0.65 };
  const high = { ...medium };
  const sets = { 'fleurs-en': { low, medium, high } };
  const fleurs = { right: 20, length: 40 };

  assert.deepEqual(checkFloors(sets, fleurs), []);
  assert.match(checkFloors({}, null).join(), /No dataset was measured/u);

  fleurs.right = 19;
  high.classErr = 0.6;
  high.per = 1;
  low.cer = 0.66;
  const failures = checkFloors(sets, fleurs);
  assert.equal(failures.length, 4);
  assert.match(failures.join(), /FLEURS medium languageRight: 19\/40/u);
  assert.match(failures.join(), /fleurs-en high classErr: 0\.6/u);
  assert.match(failures.join(), /fleurs-en high per: 1/u);
  assert.match(failures.join(), /fleurs-en low cer: 0\.66/u);
});

test('the benchmark file names allowed datasets and valid row prefixes', () => {
  const registry = loadRegistry();
  const policy = loadPolicy();
  assert.equal(BENCHMARK.schema, 1);
  assert.equal(
    new Set(BENCHMARK.sets.map(({ id }) => id)).size,
    BENCHMARK.sets.length
  );
  for (const { id, language, rows } of BENCHMARK.sets) {
    const entry = registry.datasets.find((dataset) => dataset.id === id);
    assert.ok(entry, id);
    assert.equal(licenceGate(entry, policy), null);
    assert.ok(entry.languages.includes(language), id);
    assert.equal(entry.source.kind, 'rows', id);
    assert.ok(
      Number.isInteger(rows) && rows > 0 && rows <= entry.source.length,
      id
    );
  }
});

test('nothing fetched is tracked', () => {
  assert.equal(
    execFileSync('git', ['ls-files', '.datasets'], { encoding: 'utf8' }),
    ''
  );
});
