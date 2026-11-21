/**
 * Tests for the listening-test harness (issue 20): the page in
 * examples/listening-test/ (loaded as a classic script that sets
 * globalThis.ListeningTest) and scripts/listening-test.mjs, which builds
 * the stimuli and analyses the result files.
 */

import { describe, expect, it } from 'test-anywhere';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

await import('../examples/listening-test/app.js');
import {
  analyzeResults,
  binomialTail,
  binomialTailP,
  bootstrapInterval,
  buildStimuli,
  formatReport,
  loadConfig,
  main,
  readSentences,
  rmsDbfs,
  screenListeners,
  susSentences,
  wilsonInterval,
} from '../scripts/listening-test.mjs';
import { decodeAudio } from '../src/audio/formats.js';
import { powerFrames } from '../src/metrics/spectrum.js';
import { createRandom } from '../src/random.js';
import { itUnless, sandboxed } from './helpers/skip.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(HERE, '..', 'examples', 'listening-test');
const { ListeningTest } = globalThis;

const CONFIG = {
  id: 'unit',
  title: 'Unit test',
  instructions: 'Listen.',
  trials: [
    {
      type: 'mushra',
      id: 'm1',
      conditions: {
        reference: 'r.wav',
        anchor35: 'a35.wav',
        anchor70: 'a70.wav',
        studio: 's.wav',
      },
    },
    { type: 'abx', id: 'x1', a: 'a.wav', b: 'b.wav' },
    { type: 'intelligibility', id: 'i1', audio: 'i.wav', text: 'A cat sat.' },
  ],
};

const near = (actual, expected, tolerance) =>
  expect(Math.abs(actual - expected) <= tolerance).toBe(true);

it('loads the recording copy studies in the harness', () => {
  const abx = loadConfig(path.join(TEST_DIR, 'copy-abx.config.js'));
  const similarity = loadConfig(
    path.join(TEST_DIR, 'copy-similarity.config.js')
  );
  expect(ListeningTest.validateConfig(abx)).toEqual([]);
  expect(ListeningTest.validateConfig(similarity)).toEqual([]);
  expect(ListeningTest.planSession(abx, 7).trials.length).toBe(10);
  for (const trial of ListeningTest.planSession(similarity, 7).trials) {
    expect(trial.rating).toBe('speaker');
    const byName = Object.fromEntries(
      trial.conditions.map(({ name, file }) => [name, file])
    );
    expect(Object.keys(byName).sort()).toEqual([
      'anchor',
      'copy',
      'default',
      'reference',
    ]);
    expect(byName.reference === trial.reference).toBe(false);
  }
});

function mushraResult(listener, ratings) {
  return {
    schema: 1,
    test: 'unit',
    listener,
    trials: ratings.map((rating, index) => ({
      id: `m${index}`,
      type: 'mushra',
      ratings: rating,
    })),
  };
}

describe('listening test page: plan', () => {
  it('validates a configuration', () => {
    expect(ListeningTest.validateConfig(CONFIG)).toEqual([]);
    const errors = (config) => ListeningTest.validateConfig(config).join('\n');
    expect(errors({ ...CONFIG, id: undefined })).toContain('missing id');
    expect(
      errors({ ...CONFIG, trials: [CONFIG.trials[1], CONFIG.trials[1]] })
    ).toContain('duplicate trial id "x1"');
    expect(errors({ ...CONFIG, trials: [{ type: 'mos', id: 'q' }] })).toContain(
      'unknown type "mos"'
    );
    expect(
      errors({
        ...CONFIG,
        trials: [{ type: 'mushra', id: 'm', conditions: { a: 'a.wav' } }],
      })
    ).toContain('without a condition "reference"');
    const many = { reference: 'r.wav' };
    for (let i = 0; i < 12; i++) {
      many[`c${i}`] = `${i}.wav`;
    }
    expect(
      errors({
        ...CONFIG,
        trials: [{ type: 'mushra', id: 'm', conditions: many }],
      })
    ).toContain('13 conditions, more than 12');
    expect(
      errors({ ...CONFIG, trials: [{ type: 'abx', id: 'x', a: 'a.wav' }] })
    ).toContain('ABX trial without "b"');
    expect(
      errors({ ...CONFIG, trials: [{ type: 'abx', id: 'x', b: 'b.wav' }] })
    ).toContain('ABX trial without "a"');
    expect(
      errors({
        ...CONFIG,
        trials: [{ type: 'intelligibility', id: 'i', text: 'x' }],
      })
    ).toContain('intelligibility trial without "audio"');
    expect(
      errors({
        ...CONFIG,
        trials: [{ type: 'intelligibility', id: 'i', audio: 'i.wav' }],
      })
    ).toContain('intelligibility trial without "text"');
  });

  it('plans a session deterministically', () => {
    const first = ListeningTest.planSession(CONFIG, 7);
    expect(ListeningTest.planSession(CONFIG, 7)).toEqual(first);
    expect(first.seed).toBe(7);
    const mushra = first.trials.find((trial) => trial.type === 'mushra');
    expect(mushra.conditions.map((c) => c.label)).toEqual(['A', 'B', 'C', 'D']);

    const firsts = new Map();
    let xIsA = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const plan = ListeningTest.planSession(CONFIG, seed);
      const trial = plan.trials.find((t) => t.type === 'mushra');
      const name = trial.conditions[0].name;
      firsts.set(name, (firsts.get(name) ?? 0) + 1);
      if (plan.trials.find((t) => t.type === 'abx').x === 'a') {
        xIsA++;
      }
    }
    for (const name of Object.keys(CONFIG.trials[0].conditions)) {
      expect(firsts.get(name) >= 10).toBe(true);
    }
    expect(xIsA >= 35 && xIsA <= 65).toBe(true);

    const drawn = ListeningTest.planSession(CONFIG);
    expect(Number.isInteger(drawn.seed) && drawn.seed >= 0).toBe(true);
  });

  it('carries the same mulberry32 as src/random.js', () => {
    const page = ListeningTest.createRandom(12345);
    const project = createRandom(12345);
    for (let i = 0; i < 5; i++) {
      expect(page()).toBe(project());
    }
  });
});

describe('listening test page: result', () => {
  it('builds an anonymous result', () => {
    const result = ListeningTest.buildResult({
      test: 'unit',
      seed: 3,
      headphones: true,
      nativeLanguage: 'EN',
      name: 'Alice',
      userAgent: 'Mozilla',
      trials: [
        {
          id: 'x1',
          type: 'abx',
          x: 'a',
          answer: 'a',
          correct: true,
          plays: { a: 1, b: 1, x: 2 },
          seconds: 9.5,
          extra: 'dropped',
        },
      ],
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'schema',
        'test',
        'listener',
        'seed',
        'date',
        'headphones',
        'nativeLanguage',
        'trials',
      ].sort()
    );
    expect(result.schema).toBe(1);
    expect(/^[0-9a-f]{8}$/.test(result.listener)).toBe(true);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(result.date)).toBe(true);
    expect(result.nativeLanguage).toBe('en');
    expect(Object.keys(result.trials[0]).sort()).toEqual(
      ['id', 'type', 'x', 'answer', 'correct', 'plays', 'seconds'].sort()
    );
    expect(ListeningTest.resultFileName(result)).toBe(
      `listening-unit-${result.listener}.json`
    );
  });

  it('enables Next only when the trial is complete', () => {
    const names = ['reference', 'b'];
    expect(
      ListeningTest.mushraComplete(
        names,
        { reference: 1, b: 1 },
        { reference: 100, b: 40 }
      )
    ).toBe(true);
    expect(
      ListeningTest.mushraComplete(
        names,
        { reference: 1, b: 0 },
        { reference: 100, b: 40 }
      )
    ).toBe(false);
    expect(
      ListeningTest.mushraComplete(
        names,
        { reference: 1, b: 1 },
        { reference: 90, b: 40 }
      )
    ).toBe(false);
    expect(ListeningTest.abxComplete({ x: 1 }, 'a')).toBe(true);
    expect(ListeningTest.abxComplete({ x: 0 }, 'a')).toBe(false);
    expect(ListeningTest.abxComplete({ x: 1 }, null)).toBe(false);
  });

  it('makes no network calls', () => {
    const app = readFileSync(path.join(TEST_DIR, 'app.js'), 'utf8');
    const html = readFileSync(path.join(TEST_DIR, 'index.html'), 'utf8');
    for (const text of [app, html]) {
      for (const word of [
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        'sendBeacon',
        'http://',
        'https://',
      ]) {
        expect(text.includes(word)).toBe(false);
      }
    }
    expect(html).toContain("connect-src 'none'");
    expect(app).toContain('mulberry32');
    expect(/^\s*(import|export)\s/m.test(app)).toBe(false);
  });
});

describe('listening test statistics', () => {
  it('computes the Wilson interval', () => {
    const [low, high] = wilsonInterval(15, 20);
    near(low, 0.5313, 0.0001);
    near(high, 0.8881, 0.0001);
  });

  it('computes the binomial tail', () => {
    near(binomialTail(15, 20), 0.020695, 0.000001);
    expect(binomialTail(0, 20)).toBe(1);
    near(binomialTail(600, 1000), 1.36e-10, 0.01e-10);
  });

  it('bootstraps with a seed', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const first = bootstrapInterval(values, { resamples: 10000, seed: 1 });
    expect(bootstrapInterval(values, { resamples: 10000, seed: 1 })).toEqual(
      first
    );
    expect(first.mean).toBe(50.5);
    expect(first.low < 50.5 && first.high > 50.5).toBe(true);
    expect(first.high - first.low < 15).toBe(true);
  });

  it('screens a careless listener', () => {
    const good = { reference: 100, b: 40 };
    const bad = { reference: 50, b: 40 };
    const careless = mushraResult('aaaaaaaa', [bad, bad, good, good, good]);
    const careful = mushraResult('bbbbbbbb', [
      bad,
      ...Array.from({ length: 9 }, () => good),
    ]);
    const { kept, dropped } = screenListeners([careless, careful]);
    expect(dropped.map((r) => r.listener)).toEqual(['aaaaaaaa']);
    expect(kept.map((r) => r.listener)).toEqual(['bbbbbbbb']);
    expect(analyzeResults([careless, careful]).dropped).toEqual(['aaaaaaaa']);
  });

  it('analyses a synthetic study', () => {
    const random = createRandom(5);
    const jitter = () => Math.round((random() - 0.5) * 10);
    const results = Array.from({ length: 10 }, (_, listener) => {
      const ratings = Array.from({ length: 3 }, () => ({
        reference: 100,
        studio: 60 + jitter(),
        anchor35: 20 + jitter(),
      }));
      return mushraResult(listener.toString(16).padStart(8, '0'), ratings);
    });
    const analysis = analyzeResults(results);
    expect(analysis.listeners).toBe(10);
    expect(analysis.mushra.conditions.map((c) => c.name)).toEqual([
      'reference',
      'studio',
      'anchor35',
    ]);
    expect(analysis.mushra.pairs.length).toBe(3);
    expect(analysis.mushra.pairs.every((pair) => pair.different)).toBe(true);

    const report = formatReport(analysis, { command: 'node x analyze' });
    const order = ['| reference |', '| studio |', '| anchor35 |'].map((row) =>
      report.indexOf(row)
    );
    expect(order[0] >= 0 && order[0] < order[1] && order[1] < order[2]).toBe(
      true
    );
    expect(report).toContain('Command: `node x analyze`');
    expect(report).toContain('Listeners: 10');
    expect(report.match(/, different$/gm).length).toBe(3);
    expect(report).not.toContain('not different');
    expect(report).not.toContain('Fewer than 8 listeners');
  });

  it('scores ABX and intelligibility answers', () => {
    const results = ['00000001', '00000002'].map((listener, index) => ({
      schema: 1,
      test: 'unit',
      listener,
      trials: [
        { id: 'x1', type: 'abx', correct: index === 0 },
        {
          id: 'i1',
          type: 'intelligibility',
          typed: index === 0 ? 'a cat sat' : 'a hat sat',
        },
      ],
    }));
    const analysis = analyzeResults(results, { config: CONFIG });
    expect(analysis.abx.all.correct).toBe(1);
    expect(analysis.abx.all.total).toBe(2);
    near(analysis.intelligibility.rows[0].mean, 1 / 6, 1e-9);
    const report = formatReport(analysis);
    for (const heading of ['## MUSHRA', '## ABX', '## Intelligibility']) {
      expect(report).toContain(heading);
    }
    expect(report).toContain('Fewer than 8 listeners');
    expect(() => analyzeResults(results)).toThrow();
  });

  it('writes semantically unpredictable sentences', () => {
    const words = JSON.parse(
      readFileSync(path.join(TEST_DIR, 'sus.en.json'), 'utf8')
    );
    expect(words.frames.length).toBe(5);
    expect(words.nouns.length >= 40).toBe(true);
    expect(words.verbs.length >= 25).toBe(true);
    expect(words.adjectives.length >= 25).toBe(true);
    const sentences = susSentences({ count: 20, seed: 1, words });
    expect(sentences.length).toBe(20);
    expect(susSentences({ count: 20, seed: 1, words })).toEqual(sentences);
    expect(new Set(sentences).size).toBe(20);
    expect(sentences.every((s) => /^[A-Z].*[.?]$/.test(s))).toBe(true);
    const lines = [];
    const out = { log: (line) => lines.push(line), error: () => {} };
    expect(main(['sus', '--count', '3', '--seed', '1'], out)).toBe(0);
    expect(lines).toEqual(sentences.slice(0, 3));
    expect(main(['sus', '--lang', 'fr'], out)).toBe(2);
  });
});

describe('listening test stimuli', () => {
  itUnless(sandboxed)('builds stimuli', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'listening-test-'));
    try {
      const config = buildStimuli(
        {
          id: 'unit',
          sentences: [
            {
              id: 's1',
              text: 'Hello there.',
              lang: 'en',
              tiers: ['minimal', 'low'],
            },
          ],
        },
        out
      );
      const folder = path.join(out, 'stimuli', 's1');
      const names = readdirSync(folder).sort();
      expect(names).toEqual(
        [
          'anchor35.wav',
          'anchor70.wav',
          'low.wav',
          'minimal.wav',
          'reference.wav',
        ].sort()
      );
      const sounds = Object.fromEntries(
        names.map((name) => [
          name.replace('.wav', ''),
          decodeAudio(readFileSync(path.join(folder, name))),
        ])
      );
      for (const sound of Object.values(sounds)) {
        expect(sound.sampleRate).toBe(48000);
        near(rmsDbfs(sound.samples), -26, 0.2);
      }
      const above = (samples) => {
        const frames = powerFrames(samples, 48000, { size: 2048 });
        const first = Math.ceil((4000 / 48000) * 2048);
        let sum = 0;
        for (const frame of frames) {
          for (let k = first; k < frame.length; k++) {
            sum += frame[k];
          }
        }
        return 10 * Math.log10(sum);
      };
      const drop =
        above(sounds.reference.samples) - above(sounds.anchor35.samples);
      expect(drop >= 30).toBe(true);
      expect(Array.from(sounds.reference.samples)).toEqual(
        Array.from(sounds.low.samples)
      );
      expect(ListeningTest.validateConfig(config)).toEqual([]);
      expect(loadConfig(path.join(out, 'config.js'))).toEqual(config);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'afraid', 'bored'];

/** A configuration of choice trials (issue 55). */
const CHOICE = {
  id: 'emotions-unit',
  trials: ['en', 'ru'].flatMap((lang) =>
    EMOTIONS.map((answer) => ({
      type: 'choice',
      id: `${lang}-${answer}`,
      audio: `stimuli/${lang}/${answer}.wav`,
      choices: EMOTIONS,
      answer,
      lang,
    }))
  ),
};

describe('listening test: choice trials', () => {
  it('validates and plans a choice trial', () => {
    expect(ListeningTest.validateConfig(CHOICE)).toEqual([]);
    const errors = (trial) =>
      ListeningTest.validateConfig({ ...CHOICE, trials: [trial] }).join('\n');
    const trial = CHOICE.trials[0];
    expect(errors({ ...trial, answer: undefined })).toContain(
      'choice trial without "answer"'
    );
    expect(errors({ ...trial, audio: undefined })).toContain(
      'choice trial without "audio"'
    );
    expect(errors({ ...trial, answer: 'calm' })).toContain(
      'the answer is not among the choices'
    );
    expect(errors({ ...trial, choices: ['neutral'] })).toContain(
      'choices must be two or more different names'
    );
    const orders = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const plan = ListeningTest.planSession(CHOICE, seed);
      for (const planned of plan.trials) {
        expect([...planned.choices].sort()).toEqual([...EMOTIONS].sort());
        expect(planned.maxPlays).toBe(2);
        orders.add(planned.choices.join());
      }
    }
    expect(orders.size > 10).toBe(true);
  });

  it('keeps only the keys of a choice record', () => {
    const result = ListeningTest.buildResult({
      test: 'emotions-unit',
      seed: 1,
      trials: [
        {
          id: 'en-sad',
          type: 'choice',
          chosen: 'bored',
          correct: false,
          plays: 2,
          seconds: 4.2,
          answer: 'sad',
        },
      ],
    });
    expect(Object.keys(result.trials[0]).sort()).toEqual(
      ['id', 'type', 'chosen', 'correct', 'plays', 'seconds'].sort()
    );
  });

  it('computes the binomial tail with a chance level', () => {
    expect(binomialTailP(12, 20, 1 / 6) < 0.001).toBe(true);
    expect(binomialTailP(8, 20, 1 / 6) < 0.02).toBe(true);
    near(binomialTailP(15, 20, 0.5), binomialTail(15, 20), 1e-15);
    near(binomialTailP(1, 1, 1 / 6), 1 / 6, 1e-15);
    expect(binomialTailP(0, 5, 0.2)).toBe(1);
    expect(binomialTailP(6, 5, 0.2)).toBe(0);
  });

  it('analyses choice answers into a confusion matrix', () => {
    // Listener 1 is always right; listener 2 hears sad as bored and
    // everything else right.
    const results = ['00000001', '00000002'].map((listener, index) => ({
      schema: 1,
      test: 'emotions-unit',
      listener,
      trials: CHOICE.trials.map((trial) => {
        const chosen =
          index === 1 && trial.answer === 'sad' ? 'bored' : trial.answer;
        return {
          id: trial.id,
          type: 'choice',
          chosen,
          correct: chosen === trial.answer,
          plays: 1,
          seconds: 3,
        };
      }),
    }));
    const { choice } = analyzeResults(results, { config: CHOICE });
    expect(choice.trials).toBe(24);
    near(choice.chance, 1 / 6, 1e-12);
    expect(choice.labels).toEqual(EMOTIONS);
    expect(choice.answers).toEqual(EMOTIONS);
    const sad = EMOTIONS.indexOf('sad');
    const bored = EMOTIONS.indexOf('bored');
    expect(choice.matrix[sad][sad]).toBe(2);
    expect(choice.matrix[sad][bored]).toBe(2);
    expect(choice.matrix[bored][bored]).toBe(4);
    const row = choice.rows.find((r) => r.id === 'sad');
    expect([row.total, row.correct]).toEqual([4, 2]);
    near(row.p, binomialTailP(2, 4, 1 / 6), 1e-15);
    near(choice.mean, (5 + 0.5) / 6, 1e-12);
    expect(choice.byLanguage.length).toBe(12);
    const report = formatReport(analyzeResults(results, { config: CHOICE }));
    expect(report).toContain('## Choice');
    expect(report).toContain('choice 24');
    expect(report).toContain('| sad | 0 | 0 | 2 | 0 | 0 | 2 |');
    expect(() => analyzeResults(results)).toThrow();
  });
});

describe('listening test: emotion study', () => {
  it('describes 48 emotion trials in four languages', () => {
    const study = readSentences(path.join(TEST_DIR, 'emotions.sentences.json'));
    expect(study.sentences.length).toBe(8);
    const langs = study.sentences.map((entry) => entry.lang);
    for (const lang of ['en', 'ru', 'hi', 'zh']) {
      expect(langs.filter((l) => l === lang).length).toBe(2);
    }
    expect(
      study.sentences
        .filter((entry) => entry.lang === 'en')
        .map((entry) => entry.text)
    ).toEqual(['The train leaves at seven.', 'I will see you on Monday.']);
    let trials = 0;
    for (const entry of study.sentences) {
      expect(entry.type).toBe('choice');
      expect(entry.emotions).toEqual(EMOTIONS);
      expect(entry.choices).toEqual(EMOTIONS);
      expect(entry.intensity).toBe(1);
      trials += entry.emotions.length;
    }
    expect(trials).toBe(48);
  });
});

describe('listening test: choice stimuli', () => {
  itUnless(sandboxed)('builds choice stimuli with one shared gain', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'listening-choice-'));
    try {
      const config = buildStimuli(
        {
          id: 'emotions-unit',
          sentences: [
            {
              id: 'c1',
              type: 'choice',
              text: 'Hello there.',
              lang: 'en',
              tiers: ['minimal'],
              emotions: ['neutral', 'sad'],
              choices: ['neutral', 'sad', 'angry'],
            },
          ],
        },
        out
      );
      expect(config.trials).toEqual([
        {
          type: 'choice',
          id: 'c1-neutral',
          audio: 'stimuli/c1/neutral.wav',
          choices: ['neutral', 'sad', 'angry'],
          answer: 'neutral',
          lang: 'en',
          maxPlays: 2,
        },
        {
          type: 'choice',
          id: 'c1-sad',
          audio: 'stimuli/c1/sad.wav',
          choices: ['neutral', 'sad', 'angry'],
          answer: 'sad',
          lang: 'en',
          maxPlays: 2,
        },
      ]);
      const level = (name) =>
        rmsDbfs(
          decodeAudio(readFileSync(path.join(out, 'stimuli', 'c1', name)))
            .samples
        );
      near(level('neutral.wav'), -26, 0.2);
      // The soft voice of sad stays softer than neutral.
      expect(level('sad.wav') < -29).toBe(true);
      expect(ListeningTest.validateConfig(config)).toEqual([]);
      expect(() =>
        buildStimuli(
          {
            id: 'bad',
            sentences: [
              {
                id: 'c2',
                type: 'choice',
                text: 'x',
                emotions: ['calm'],
                choices: ['neutral'],
              },
            ],
          },
          out
        )
      ).toThrow();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
