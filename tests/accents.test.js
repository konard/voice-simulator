/**
 * Accents: the English accents derived from the American dictionary
 * (General American, Southern British, Australian and Indian English),
 * the regional accents of the other languages and the foreign accents
 * (issue 57): accent files, rules, strength, explanation, the wiring
 * through the CLI, the server and voice files, and their acoustic effects
 * (tier medium, seed 1; experiments/issue-57-acoustics.mjs).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { LANGUAGES, textToIpa } from '../src/g2p/index.js';
import {
  ACCENTS,
  adaptEnglishWord,
  resolveAccent,
} from '../src/g2p/accents.js';
import { parseIpa } from '../src/ipa/parse.js';
import { prepareUtterance } from '../src/synthesize.js';
import { runCli } from '../bin/voice-simulator.js';
import {
  accentSettings,
  applyAccent,
  explainAccent,
  foreignAccent,
  getAccent,
  loadAccent,
} from '../src/accent/index.js';
import { synthesisOptions } from '../src/server/server.js';
import { saveVoice, DEFAULT_HEAD } from '../src/index.js';
import {
  burstToVoicing,
  consonantDip,
  consonants,
  renderAccent,
  segmentCentroid,
  voicedShare,
  vowelNpvi,
} from './helpers/accent-measures.js';
import { measureVoice } from './helpers/voice-measures.js';
import { ACCENTS_DOC_FILE, accentsMarkdown } from '../scripts/accents-doc.mjs';

const say = (text, lang = 'en', accent = undefined) =>
  textToIpa(text, { lang, accent }).ipa;

describe('resolveAccent', () => {
  it('accepts codes and regions and defaults to General American', () => {
    expect(resolveAccent('en', 'en-GB')).toBe('en-GB');
    expect(resolveAccent('en', 'gb')).toBe('en-GB');
    expect(resolveAccent('en', 'AU')).toBe('en-AU');
    expect(resolveAccent('en')).toBe('en-US');
    expect(resolveAccent('en', 'xx')).toBe('en-US');
  });

  it('defaults the other languages to their standard accent', () => {
    expect(resolveAccent('ru', 'en-GB')).toBe('ru-RU');
    expect(resolveAccent('zh')).toBe('zh-CN');
    expect(resolveAccent('hi')).toBe('hi-IN');
    expect(resolveAccent('xx')).toBe(null);
  });

  it('lists the default accent first', () => {
    expect(ACCENTS.en[0].code).toBe('en-US');
  });
});

describe('General American', () => {
  it('stays rhotic and flaps t between vowels', () => {
    expect(say('car')).toBe('ˈkɑɹ');
    expect(say('water')).toBe('ˈwɔɾɚ');
    expect(say('lot')).toBe('ˈlɑt');
    expect(say('bath')).toBe('ˈbæθ');
    expect(say('Hello world')).toBe('həˈloʊ ˈwɝld');
  });

  it('keeps t before a stressed vowel', () => {
    expect(say('attack')).toBe(say('attack', 'en', 'en-US'));
    expect(say('attack').includes('ɾ')).toBe(false);
  });
});

describe('Southern British', () => {
  it('drops a final r and lengthens START', () => {
    expect(say('car', 'en', 'en-GB')).toBe('ˈkɑː');
    expect(say('start', 'en', 'en-GB')).toBe('ˈstɑːt');
  });

  it('uses the BATH vowel and a rounded LOT', () => {
    expect(say('bath', 'en', 'en-GB')).toBe('ˈbɑːθ');
    expect(say('dance', 'en', 'en-GB')).toBe('ˈdɑːns');
    expect(say('cat', 'en', 'en-GB')).toBe('ˈkæt');
    expect(say('lot', 'en', 'en-GB')).toBe('ˈlɒt');
    expect(say('want', 'en', 'en-GB')).toBe('ˈwɒnt');
    expect(say('father', 'en', 'en-GB')).toBe('ˈfɑːðə');
  });

  it('keeps t unflapped and THOUGHT long', () => {
    expect(say('water', 'en', 'en-GB')).toBe('ˈwɔːtə');
    expect(say('better', 'en', 'en-GB')).toBe('ˈbɛtə');
    expect(say('thought', 'en', 'en-GB')).toBe('ˈθɔːt');
  });

  it('has its own GOAT, NURSE, NEAR, SQUARE and CURE vowels', () => {
    expect(say('go', 'en', 'en-GB')).toBe('ˈɡəʊ');
    expect(say('nurse', 'en', 'en-GB')).toBe('ˈnɜːs');
    expect(say('near', 'en', 'en-GB')).toBe('ˈnɪə');
    expect(say('square', 'en', 'en-GB')).toBe('ˈskwɛə');
    expect(say('pure', 'en', 'en-GB')).toBe('ˈpjʊə');
    expect(say('hurry', 'en', 'en-GB')).toBe('ˈhʌɹi');
    expect(say('sorry', 'en', 'en-GB')).toBe('ˈsɒɹi');
  });

  it('keeps a yod after t, d and n', () => {
    expect(say('tune', 'en', 'en-GB')).toBe('ˈtjuːn');
    expect(say('tune')).toBe('ˈtun');
  });

  it('links a final r to a following vowel only', () => {
    expect(say('far away', 'en', 'en-GB')).toBe('ˈfɑːɹ əˈweɪ');
    expect(say('far gone', 'en', 'en-GB').startsWith('ˈfɑː ')).toBe(true);
    expect(say('four. Apples', 'en', 'en-GB').startsWith('ˈfɔː .')).toBe(true);
  });

  it('reports the accent it used', () => {
    expect(textToIpa('car', { lang: 'en', accent: 'gb' }).accent).toBe('en-GB');
    expect(textToIpa('car', { lang: 'en' }).accent).toBe('en-US');
  });
});

describe('other English accents', () => {
  it('derives General Australian vowels', () => {
    expect(say('car', 'en', 'en-AU')).toBe('ˈkɐː');
    expect(say('go', 'en', 'en-AU')).toBe('ˈɡəʉ');
    expect(say('dance', 'en', 'en-AU')).toBe('ˈdæns');
    expect(say('water', 'en', 'en-AU')).toBe('ˈwoːɾə');
  });

  it('derives Indian English consonants', () => {
    expect(say('water', 'en', 'en-IN')).toBe('ˈʋɔʈəɾ');
    expect(say('thought', 'en', 'en-IN')).toBe('ˈt̪ʰɔʈ');
    expect(say('go', 'en', 'en-IN')).toBe('ˈɡoː');
  });

  it('only produces symbols the parser knows', () => {
    const text = 'The quick brown fox, thirty cars: water, tune, square!';
    for (const { code } of ACCENTS.en) {
      expect(parseIpa(say(text, 'en', code)).unknown).toEqual([]);
    }
  });

  it('leaves the other languages alone', () => {
    const russian = textToIpa('Привет, мир', { lang: 'ru' });
    const british = textToIpa('Привет, мир', { lang: 'ru', accent: 'en-GB' });
    expect(british.ipa).toBe(russian.ipa);
    expect(british.accent).toBe('ru-RU');
  });

  it('passes unknown accents through unchanged', () => {
    expect(adaptEnglishWord('ˈkɑɹ', 'car', 'en-XX')).toBe('ˈkɑɹ');
  });
});

describe('accent option', () => {
  it('reaches the planner through prepareUtterance', () => {
    const british = prepareUtterance('car', { lang: 'en', accent: 'en-GB' });
    expect(british.accent).toBe('en-GB');
    expect(british.ipa).toBe('ˈkɑː');
    const phones = (prepared) =>
      prepared.plan.segments.map((segment) => segment.token?.symbol);
    expect(phones(prepareUtterance('car', { lang: 'en' }))).toContain('ɹ');
    expect(phones(british)).not.toContain('ɹ');
  });

  it('is a CLI option', async () => {
    const stdout = [];
    const code = await runCli(['ipa', '--accent', 'en-GB', 'water'], {
      stderr: () => {},
      stdout: (line) => stdout.push(line),
    });
    expect(code).toBe(0);
    expect(stdout).toEqual(['ˈwɔːtə']);
  });

  it('is implied by a regional language code', () => {
    const british = textToIpa('water', { lang: 'en-GB' });
    expect(british.lang).toBe('en');
    expect(british.accent).toBe('en-GB');
    expect(british.ipa).toBe('ˈwɔːtə');
    expect(textToIpa('car', { lang: 'en-au' }).accent).toBe('en-AU');
    // An explicit accent wins over the region of the language code.
    expect(textToIpa('car', { lang: 'en-GB', accent: 'en-US' }).ipa).toBe(
      'ˈkɑɹ'
    );
    expect(prepareUtterance('car', { lang: 'en-GB' }).ipa).toBe('ˈkɑː');
  });
});

const SENTENCE = 'the thing with strong street wives and bad bed';
const FOREIGN = ['en', 'ru', 'hi', 'zh'].flatMap((target) =>
  ['en', 'ru', 'hi', 'zh']
    .filter((first) => first !== target)
    .map((first) => `${target}-x-${first}`)
);
const EXAMPLE = new globalThis.URL(
  '../examples/accents/en-x-th-stopping.json',
  import.meta.url
);

/** The error `run` throws (or null). */
function thrown(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

/** Run the CLI and collect its output. */
async function cli(args) {
  const stdout = [];
  const stderr = [];
  const code = await runCli(args, {
    stderr: (line) => stderr.push(line),
    stdout: (line) => stdout.push(line),
  });
  return { code, stdout, stderr };
}

describe('foreign accents', () => {
  it('speak English with Russian sounds at half strength', () => {
    expect(say(SENTENCE, 'en', { code: 'en-x-ru', strength: 0.5 })).toBe(
      'zə ˈsink ˈvis ˈstronk ˈstrit ˈvajvs ənt ˈbɛt ˈbɛt'
    );
    expect(say('pit', 'en', { code: 'en-x-ru', strength: 0.5 })).toBe('ˈp˭it');
    expect(say('pit', 'en', 'en-x-ru')).toBe('ˈp˭it');
  });

  it('scale with the strength', () => {
    expect(say('thing', 'en', { code: 'en-x-ru', strength: 0 })).toBe(
      say('thing')
    );
    expect(say('thing', 'en', { code: 'en-x-ru', strength: 1 })).toBe('ˈsʲink');
    expect(
      textToIpa('thing', { lang: 'en', accent: 'en-x-ru', accentLevel: 0 }).ipa
    ).toBe(say('thing'));
    const silent = textToIpa('thing', {
      lang: 'en',
      accent: { code: 'en-x-ru', strength: 0 },
    });
    expect(silent.accent).toBe('en-x-ru');
    expect(silent.accentLevel).toBe(0);
  });

  it('add a prothetic vowel in Hindi English', () => {
    expect(say('school', 'en', 'en-x-hi')).toBe('ɪˈskul');
  });

  it('break up clusters and final consonants in Chinese English', () => {
    const [bed, street] = say('bed street', 'en', 'en-x-zh').split(' ');
    expect(bed.endsWith('ə')).toBe(true);
    const kinds = parseIpa(street)
      .tokens.filter((token) => token.phoneme)
      .slice(0, 2)
      .map((token) => token.phoneme.kind);
    expect(kinds).not.toEqual(['consonant', 'consonant']);
  });

  it('are valid accent files for every pair of languages', () => {
    expect(FOREIGN.length).toBe(12);
    for (const code of FOREIGN) {
      const [target, , first] = code.split('-');
      const definition = foreignAccent(target, first);
      expect(definition.code).toBe(code);
      expect(loadAccent(JSON.stringify(definition)).code).toBe(code);
      expect(getAccent(code).code).toBe(code);
      const { ipa } = textToIpa(LANGUAGES[target].sample, {
        lang: target,
        accent: code,
      });
      expect(parseIpa(ipa).unknown).toEqual([]);
    }
  });
});

describe('regional accents', () => {
  it('give each language its own regional pronunciations', () => {
    expect(say('хорошо говорит', 'ru', 'ru-x-north')).toBe('xoroˈʂo ɡovoˈrʲit');
    expect(say('город снег друг его', 'ru', 'ru-x-south')).toBe(
      'ˈɣorət snʲex drux jɪˈvo'
    );
    expect(say('ज़रा फ़ोन शहर', 'hi', 'hi-x-east')).toBe('d͡ʒəɾaː pʰoːn səɦəɾ');
    expect(say('是', 'zh', 'zh-TW')).toBe('sɹ̩˥˩');
    expect(say('一点儿', 'zh', 'zh-TW')).toBe('i˥˩ tjɛn˨˩');
    expect(say('女儿', 'zh', 'zh-TW')).toContain('ɚ');
    expect(say('南', 'zh', 'zh-x-south')).toBe('lan˧˥');
    expect(say('price about', 'en', 'en-CA')).toBe('ˈpɹʌɪs əˈbʌʊt');
  });

  it('leave the standard accent unchanged', () => {
    expect(say('город снег', 'ru')).toBe(say('город снег', 'ru', 'ru-RU'));
    expect(say('一点儿', 'zh')).toBe('i˥˩ tjaɻ˨˩˦');
  });
});

describe('accent files', () => {
  it('load from a file and apply their rules from their minimum strength', () => {
    const definition = loadAccent(readFileSync(EXAMPLE, 'utf8'));
    expect(definition.code).toBe('en-x-th-stopping');
    const text = 'the three red rivers';
    expect(say(text, 'en', definition)).toBe('d̪ə ˈt̪ɾi ˈɾɛd ˈɾɪvɚz');
    expect(say(text, 'en', { ...definition })).toBe('d̪ə ˈt̪ɾi ˈɾɛd ˈɾɪvɚz');
    expect(
      textToIpa(text, { lang: 'en', accent: definition, accentLevel: 0.4 }).ipa
    ).toBe('d̪ə ˈt̪ɹi ˈɹɛd ˈɹɪvɚz');
    expect(applyAccent('ˈθɹi', definition)).toBe('ˈt̪ɾi');
    expect(applyAccent('ˈθɹi', definition, 0)).toBe('ˈθɹi');
  });

  it('reject a wrong format, unknown units and too many rules', () => {
    const base = {
      format: 'voice-simulator/accent',
      version: 1,
      code: 'en-x-t',
      language: 'en',
    };
    expect(loadAccent(base).base).toBe('en-US');
    const format = thrown(() => loadAccent({ ...base, format: 'other' }));
    expect(format instanceof TypeError).toBe(true);
    expect(format.message).toContain('format');
    const unit = thrown(() =>
      loadAccent({ ...base, rules: [{ map: { θ: 'Ж' } }] })
    );
    expect(unit instanceof TypeError).toBe(true);
    expect(unit.message).toContain('rules[0].map');
    const rules = Array.from({ length: 501 }, () => ({ map: { θ: 's' } }));
    const many = thrown(() => loadAccent({ ...base, rules }));
    expect(many instanceof TypeError).toBe(true);
    expect(many.message).toContain('rules');
    expect(loadAccent({ ...base, rules: rules.slice(1) }).rules.length).toBe(
      500
    );
    expect(thrown(() => loadAccent('{')) instanceof TypeError).toBe(true);
    expect(thrown(() => loadAccent({ ...base, version: 2 })).message).toContain(
      'version'
    );
  });

  it('reject an unknown code of the language and ignore another language', () => {
    const error = thrown(() =>
      textToIpa('город', { lang: 'ru', accent: 'ru-south' })
    );
    expect(error instanceof RangeError).toBe(true);
    expect(textToIpa('город', { lang: 'ru', accent: 'en-x-ru' }).accent).toBe(
      'ru-RU'
    );
    expect(getAccent('ru-south')).toBe(null);
  });
});

describe('docs/accents.md', () => {
  it('is current and lists every code', () => {
    // Git may check the file out with CRLF line endings on Windows.
    const text = readFileSync(ACCENTS_DOC_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(text).toBe(accentsMarkdown());
    for (const entry of Object.values(ACCENTS).flat()) {
      expect(text).toContain(`### \`${entry.code}\``);
    }
  });
});

describe('explainAccent', () => {
  it('ranks the accents by how many differences they explain', () => {
    const [best] = explainAccent('ˈɡorət', 'ˈɣorət', 'ru');
    expect(best).toEqual({ code: 'ru-x-south', explained: 1, total: 1 });
  });
});

describe('accent wiring', () => {
  it('keeps the plain output when no accent is asked for', () => {
    const plain = prepareUtterance(SENTENCE, { lang: 'en' });
    const none = prepareUtterance(SENTENCE, {
      lang: 'en',
      accent: { code: 'en-x-ru', strength: 0 },
    });
    expect(none.ipa).toBe(plain.ipa);
    expect(none.plan.duration).toBe(plain.plan.duration);
    expect(none.head).toEqual(plain.head);
    expect(plain.accent).toBe('en-US');
  });

  it('passes prosody and articulation to the planner and the head', () => {
    const definition = loadAccent(readFileSync(EXAMPLE, 'utf8'));
    const accented = prepareUtterance('three', {
      lang: 'en',
      accent: definition,
    });
    expect(accented.head.lipPosture).toBe(DEFAULT_HEAD.lipPosture + 0.2);
    expect(accented.accentLevel).toBe(1);
    const half = accentSettings('en', definition, { level: 0.5 });
    expect(Math.round(half.prosody.range * 1e9) / 1e9).toBe(1.1);
    expect(Math.round(half.prosody.rate * 1e9) / 1e9).toBe(0.95);
    expect(Math.round(half.articulation.lipPosture * 1e9) / 1e9).toBe(0.1);
    const slow = prepareUtterance(SENTENCE, { lang: 'en', accent: definition });
    const plain = prepareUtterance(SENTENCE, { lang: 'en' });
    expect(slow.plan.duration).toBeGreaterThan(plain.plan.duration);
  });

  it('is a CLI option with a code, a file and a level', async () => {
    const plain = await cli(['ipa', '--lang', 'en', 'thing']);
    const russian = await cli([
      'ipa',
      '--lang',
      'en',
      '--accent',
      'en-x-ru',
      'thing',
    ]);
    expect(russian.code).toBe(0);
    expect(russian.stdout).toEqual(['ˈsʲink']);
    expect(russian.stdout).not.toEqual(plain.stdout);
    const file = await cli(['ipa', '--accent', EXAMPLE.pathname, 'three']);
    expect(file.stdout).toEqual(['ˈt̪ɾi']);
    const level = await cli([
      'ipa',
      '--accent',
      'en-x-ru',
      '--accent-level',
      '0',
      'thing',
    ]);
    expect(level.stdout).toEqual(plain.stdout);
    expect((await cli(['ipa', '--accent-level', '2', 'thing'])).code).toBe(1);
    expect(
      (await cli(['ipa', '--lang', 'ru', '--accent', 'ru-south', 'город'])).code
    ).toBe(1);
  });

  it('comes from a voice file unless an option names another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accent-voice-'));
    try {
      const file = join(dir, 'voice.json');
      writeFileSync(
        file,
        JSON.stringify(saveVoice({ head: DEFAULT_HEAD, accent: 'en-x-ru' }))
      );
      const voiced = await cli([
        'timeline',
        '--json',
        '--voice',
        file,
        'thing',
      ]);
      expect(JSON.parse(voiced.stdout[0]).ipa).toBe('ˈsʲink');
      const own = await cli([
        'timeline',
        '--json',
        '--voice',
        file,
        '--accent',
        'en-GB',
        'thing',
      ]);
      expect(JSON.parse(own.stdout[0]).accent).toBe('en-GB');
      const check = await cli(['voice', 'check', file]);
      expect(check.stdout[0]).toContain('accent en-x-ru');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a server field: a code or an object, never a path', () => {
    const options = (params) =>
      synthesisOptions({ text: 'thing', ...params }).options;
    expect(options({ accent: 'en-x-ru' }).accent).toBe('en-x-ru');
    expect(
      options({ accent: { code: 'en-x-ru', strength: 0.5 } }).accent
    ).toEqual({ code: 'en-x-ru', strength: 0.5 });
    expect(
      options({ lang: 'en', accent: JSON.parse(readFileSync(EXAMPLE, 'utf8')) })
        .accent.code
    ).toBe('en-x-th-stopping');
    expect(options({ accentLevel: '0.5' }).accentLevel).toBe(0.5);
    expect(thrown(() => options({ accent: 'ru-south' })).status).toBe(400);
    expect(
      thrown(() => options({ lang: 'en', accent: EXAMPLE.pathname })).status
    ).toBe(400);
    expect(thrown(() => options({ accentLevel: '2' })).status).toBe(400);
    expect(thrown(() => options({ accent: { format: 'x' } })).status).toBe(400);
  });
});

describe('accent acoustics', () => {
  const first = (result) => consonants(result)[0];

  it('keeps the fricative g of southern Russian loud', () => {
    const plain = renderAccent('город', 'ru', 'ru-RU');
    const south = renderAccent('город', 'ru', 'ru-x-south');
    expect(consonantDip(plain, first(plain))).toBeGreaterThan(20);
    expect(consonantDip(south, first(south))).toBeLessThan(10);
  });

  it('shortens the aspiration of p in Russian English', () => {
    const plain = renderAccent('pit', 'en', 'en-US');
    const russian = renderAccent('pit', 'en', 'en-x-ru');
    expect(burstToVoicing(russian, first(russian))).toBeLessThanOrEqual(
      burstToVoicing(plain, first(plain)) / 2
    );
  });

  it('devoices a final d in Russian English', () => {
    const russian = renderAccent('bad', 'en', 'en-x-ru');
    expect(voicedShare(russian, consonants(russian).at(-1))).toBeLessThan(0.2);
  });

  it('merges 是 and 四 in Taiwan', () => {
    const apart = (accent, measure) => {
      const shi = measure(renderAccent('是', 'zh', accent));
      const si = measure(renderAccent('四', 'zh', accent));
      return Math.abs(shi - si) / Math.max(shi, si);
    };
    const fricative = (result) => segmentCentroid(result, first(result));
    const whole = (result) => measureVoice(result, 'centroid');
    expect(apart('zh-TW', fricative)).toBeLessThan(0.1);
    expect(apart('zh-TW', whole)).toBeLessThan(0.1);
    // The plain contrast: 14.7 % over the whole syllable; the fricatives
    // alone differ by 0.4 % (s, ʃ and ʂ have nearly the same noise
    // spectrum on this tier, experiments/issue-57-sibilants.mjs).
    expect(apart('zh-CN', whole)).toBeGreaterThan(0.1);
  });

  it('evens out the vowel durations in Chinese English', () => {
    const text = 'The tiger is the biggest animal of the family.';
    const plain = vowelNpvi(renderAccent(text, 'en', 'en-US'));
    const chinese = vowelNpvi(renderAccent(text, 'en', 'en-x-zh'));
    expect(plain - chinese).toBeGreaterThanOrEqual(10);
  });
});
