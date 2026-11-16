/**
 * Speech markup (issue 50): the SSML subset, inline tags, the ExtIPA/VoQS
 * marks of IPA strings and the mode spans of the plan. See docs/markup.md.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  MARKUP_LIMITS,
  MarkupError,
  isSsml,
  parseMarkup,
} from '../src/markup/index.js';
import {
  MODE_DEFAULTS,
  composeMode,
  createMode,
  emotionOf,
} from '../src/markup/modes.js';
import { formatIpa, parseIpa } from '../src/ipa/parse.js';
import { textToIpa } from '../src/g2p/index.js';
import { modeAt, planUtterance } from '../src/articulation/plan.js';
import { prepareUtterance } from '../src/synthesize.js';

const ssml = (body) => parseMarkup(`<speak>${body}</speak>`);
const inline = (text) => parseMarkup(text, { markup: true });
/** The mode of the only span of a parse. */
const only = (parsed) => {
  expect(parsed.spans.length).toBe(1);
  return parsed.spans[0].mode;
};
const near = (value, target, tolerance = 1e-6) =>
  expect(Math.abs(value - target) <= tolerance).toBe(true);
const throwsMarkup = (run) => {
  try {
    run();
  } catch (error) {
    expect(error instanceof MarkupError).toBe(true);
    expect(typeof error.position).toBe('number');
    return error;
  }
  throw new Error('expected a MarkupError');
};

describe('parseMarkup', () => {
  it('leaves plain text alone', () => {
    const text = 'a < b [1] 2 * 3';
    const parsed = parseMarkup(text);
    expect(parsed.text).toBe(text);
    expect(parsed.spans).toEqual([]);
    expect(parsed.breaks).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.offsets).toEqual(Array.from(text, (_, index) => index));
    expect(parseMarkup('<speak>a</speak>', { markup: false }).text).toBe(
      '<speak>a</speak>'
    );
    expect(isSsml('  <speak>a</speak>')).toBe(true);
    expect(isSsml('<speaker>')).toBe(false);
  });
});

describe('parseMarkup: SSML', () => {
  it('reads the SSML subset', () => {
    const prosody = ssml('<prosody rate="fast" pitch="+2st">a b</prosody> c');
    expect(prosody.text).toBe('a b c');
    expect(prosody.spans.length).toBe(1);
    expect(prosody.spans[0].start).toBe(0);
    expect(prosody.spans[0].end).toBe(3);
    expect(prosody.spans[0].mode.rate).toBe(1.3);
    expect(prosody.spans[0].mode.pitch).toBe(2);

    // speak, lang
    expect(parseMarkup('<speak xml:lang="ru-RU">да</speak>').lang).toBe(
      'ru-RU'
    );
    expect(only(ssml('<lang xml:lang="ru">да</lang> yes')).lang).toBe('ru');
    // p, s: a sentence break unless the text ends in punctuation
    expect(ssml('<p>a b</p><p>c.</p><s>d</s>').text.trim()).toBe('a b. c. d.');
    // break
    expect(
      ssml(
        'a<break time="300ms"/>b<break time="1.5s"/>c' +
          '<break strength="x-strong"/>d<break/>e<break strength="none"/>f'
      ).breaks.map((item) => item.seconds)
    ).toEqual([0.3, 1.5, 1.2, 0.4, 0]);
    // prosody: rate, pitch, range, volume and vs:gain
    const levels = only(
      ssml(
        '<prosody rate="80%" pitch="x-low" range="high" volume="loud">a</prosody>'
      )
    );
    near(levels.rate, 0.8);
    expect(levels.pitch).toBe(-6);
    expect(levels.range).toBe(1.5);
    near(levels.effort, 0.65);
    near(only(ssml('<prosody pitch="+50%">a</prosody>')).pitch, 7.02, 0.01);
    near(
      only(
        parseMarkup('<speak><prosody pitch="240Hz">a</prosody></speak>', {
          head: { pitch: 120 },
        })
      ).pitch,
      12
    );
    expect(only(ssml('<prosody range="-50%">a</prosody>')).range).toBe(0.5);
    near(only(ssml('<prosody volume="-6dB">a</prosody>')).effort, 0.35);
    expect(only(ssml('<prosody volume="silent">a</prosody>')).gain).toBe(-120);
    expect(only(ssml('<prosody vs:gain="-6dB">a</prosody>')).gain).toBe(-6);
    // emphasis
    const emphasis = ssml(
      '<emphasis>a</emphasis> <emphasis level="reduced">b</emphasis>'
    );
    expect(emphasis.spans.map((span) => span.mode.emphasis)).toEqual([1, -0.5]);
    // say-as: the words share the range of the element
    const sayAs = ssml(
      '<say-as interpret-as="characters">abc</say-as> ' +
        '<say-as interpret-as="date">x</say-as>'
    );
    expect(sayAs.sources[0].original).toBe('abc');
    expect(sayAs.warnings.length).toBe(1);
    expect(sayAs.warnings[0].message).toContain('date');
    // phoneme
    const phoneme = ssml(
      '<phoneme alphabet="ipa" ph="ˈtəmeɪtoʊ">tomato</phoneme>'
    );
    expect(phoneme.overrides).toEqual([{ start: 0, end: 6, ipa: 'ˈtəmeɪtoʊ' }]);
    // sub
    const sub = ssml('<sub alias="World Wide Web">WWW</sub>');
    expect(sub.text).toBe('World Wide Web');
    expect(sub.sources[0].original).toBe('WWW');
    // vs:effort, vs:phonation, vs:emotion, vs:sound
    const whisper = only(ssml('<vs:effort level="whisper">a</vs:effort>'));
    expect(whisper.phonation.whisper).toBe(1);
    const ramp = only(ssml('<vs:effort value="0.75" to="1">a</vs:effort>'));
    expect([ramp.effort, ramp.effortEnd]).toEqual([0.75, 1]);
    expect(
      only(ssml('<vs:phonation name="breathy">a</vs:phonation>')).phonation
        .breathy
    ).toBe(0.67);
    expect(
      only(ssml('<vs:phonation name="lax" degree="1">a</vs:phonation>'))
        .phonation.tension
    ).toBe(-1);
    const angry = only(
      ssml('<vs:emotion name="angry" intensity="0.8">a</vs:emotion>')
    ).emotion;
    expect([angry.name, angry.intensity]).toEqual(['angry', 0.8]);
    const sounds = parseMarkup(
      '<speak xmlns:vs="urn:voice-simulator:markup:1">a ' +
        '<vs:sound name="laugh"/><vs:sound name="cough" duration="0.5s"/> b' +
        '</speak>'
    ).sounds;
    expect(sounds.map((sound) => [sound.name, sound.duration])).toEqual([
      ['laugh', null],
      ['cough', 0.5],
    ]);
    // entities, numeric references, comments, unknown elements
    const kept = ssml('<foo>kept</foo> &lt;&amp;&#65;&#x42;<!-- c -->');
    expect(kept.text).toBe('kept <&AB');
    expect(kept.warnings[0].message).toContain('foo');
  });

  it('composes nested spans', () => {
    expect(
      only(
        ssml(
          '<prosody rate="50%" pitch="+1st">' +
            '<prosody rate="200%">a</prosody></prosody>'
        )
      ).rate
    ).toBe(1);
    // A span that composes back to the neutral mode is no span.
    expect(
      ssml('<prosody rate="50%"><prosody rate="200%">a</prosody></prosody>')
        .spans
    ).toEqual([]);
    expect(
      only(
        ssml(
          '<prosody pitch="+3st"><prosody pitch="+2st">a</prosody></prosody>'
        )
      ).pitch
    ).toBe(5);
    expect(only(inline('[soft][loud]a[/loud][/soft]')).effort).toBe(0.75);
    const outer = createMode({ rate: 2, gain: -6 });
    const inner = composeMode(outer, { rate: 3, gain: -10, effort: 0.25 });
    expect([inner.rate, inner.gain, inner.effort]).toEqual([4, -16, 0.25]);
    expect(composeMode(MODE_DEFAULTS, { pitch: 40 }).pitch).toBe(24);
  });
});

describe('parseMarkup: inline tags and limits', () => {
  it('reads inline tags only when asked', () => {
    const text = '[whisper]Hello[/whisper] *world* [laugh] [pause 0.3] ok';
    expect(parseMarkup(text).text).toBe(text);
    const parsed = inline(text);
    expect(parsed.text.replace(/\s+/gu, ' ')).toBe('Hello world ok');
    expect(parsed.spans[0].mode.phonation.whisper).toBe(1);
    expect(parsed.spans[1].mode.emphasis).toBe(1);
    expect(parsed.sounds.map((sound) => sound.name)).toEqual(['laugh']);
    expect(parsed.breaks.map((item) => item.seconds)).toEqual([0.3]);
    expect(inline('[fast]a[/fast]').spans[0].mode.rate).toBe(1.3);
    expect(inline('[pitch +2]a[/pitch]').spans[0].mode.pitch).toBe(2);
    expect(inline('[angry 0.8]a[/angry]').spans[0].mode.emotion.intensity).toBe(
      0.8
    );
    expect(inline('[lang ru]да[/lang]').spans[0].mode.lang).toBe('ru');
    expect(inline('[ipa həˈloʊ]').overrides[0].ipa).toBe('həˈloʊ');
    // `[ipa X]` alone is one word; with `[/ipa]` it covers the words.
    const word = textToIpa('A [ipa təˈmɑːtəʊ] please.', {
      lang: 'en',
      markup: true,
    });
    expect(word.ipa).toBe('ə təˈmɑːtəʊ ˈpliz .');
    expect([word.words[1].sourceStart, word.words[1].sourceEnd]).toEqual([
      2, 17,
    ]);
    expect(
      textToIpa('A [ipa təˈmɑːtəʊ]tomato[/ipa] please.', {
        lang: 'en',
        markup: true,
      }).ipa
    ).toBe('ə təˈmɑːtəʊ ˈpliz .');
    expect(inline('2 * 3 * 4').text).toBe('2 * 3 * 4');
  });

  it('keeps escaped brackets', () => {
    const parsed = inline('\\[whisper\\] a \\* b \\\\');
    expect(parsed.text).toBe('[whisper] a * b \\');
    expect(parsed.spans).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('warns about unknown and unclosed tags', () => {
    const unknown = inline('a [foo] b');
    expect(unknown.text).toBe('a [foo] b');
    expect(unknown.warnings).toEqual([
      { position: 2, message: 'unknown tag [foo]' },
    ]);
    const unclosed = inline('[whisper]a b');
    expect(unclosed.spans[0].end).toBe(unclosed.text.length);
    expect(unclosed.warnings.length).toBe(1);
    expect(unclosed.warnings[0].message).toContain('whisper');
    expect(inline('a [/fast] b').warnings.length).toBe(1);
  });

  it('reads names such as constructor as unknown, not as Object members', () => {
    const tag = inline('[constructor]a[/constructor]');
    expect(tag.text).toBe('[constructor]a[/constructor]');
    expect(tag.spans).toEqual([]);
    expect(tag.warnings[0]).toEqual({
      position: 0,
      message: 'unknown tag [constructor]',
    });
    expect(inline('a [hasownproperty] b').warnings).toEqual([
      { position: 2, message: 'unknown tag [hasownproperty]' },
    ]);
    const parsed = ssml(
      'a<break strength="constructor"/>b ' +
        '<emphasis level="constructor">c</emphasis> ' +
        '<vs:emotion name="constructor">d</vs:emotion>'
    );
    expect(parsed.breaks.map((item) => item.seconds)).toEqual([0.4]);
    expect(parsed.spans[0].mode.emphasis).toBe(1);
    expect(parsed.warnings.map((item) => item.message)).toEqual([
      'unknown break strength constructor',
      'unknown emphasis level constructor',
      'unknown emotion constructor',
    ]);
    expect(emotionOf({ name: 'constructor' }).arousal).toBe(0);
  });

  it('rejects entities and doctypes', () => {
    throwsMarkup(() =>
      parseMarkup('<!DOCTYPE speak [<!ENTITY x "y">]><speak>&x;</speak>')
    );
    throwsMarkup(() => parseMarkup('<speak>&foo;</speak>'));
    const deep = `${'<s>'.repeat(MARKUP_LIMITS.maxDepth + 1)}a${'</s>'.repeat(
      MARKUP_LIMITS.maxDepth + 1
    )}`;
    expect(MARKUP_LIMITS.maxDepth).toBe(32);
    throwsMarkup(() => parseMarkup(`<speak>${deep}</speak>`));
    const long = `<speak>${'a'.repeat(20001 - 15)}</speak>`;
    expect(long.length).toBe(20001);
    throwsMarkup(() => parseMarkup(long));
    throwsMarkup(() => parseMarkup('<speak><p>a</speak>'));
    for (const input of [
      '<speak><![CDATA[x]]></speak>',
      '<speak><?pi x?>a</speak>',
      '<?xml version="1.0"?><speak>a</speak>',
      '<speak>&nbsp;</speak>',
      `<speak>${'<s/>'.repeat(MARKUP_LIMITS.maxElements + 1)}</speak>`,
      '<speak>a<break time="11s"/></speak>',
    ]) {
      throwsMarkup(() => parseMarkup(input));
    }
    // Inline parsing never throws.
    expect(inline('[[[ ]]] [/x] [pause zz').text.length > 0).toBe(true);
  });

  it('maps offsets back to the input', () => {
    const input = '<speak>Hello <emphasis>world</emphasis>.</speak>';
    const parsed = parseMarkup(input);
    expect(parsed.text).toBe('Hello world.');
    expect(input[parsed.offsets[6]]).toBe('w');
    const { timeline } = prepareUtterance(input, {
      lang: 'en',
      tier: 'minimal',
    });
    const world = timeline.words.find((word) => word.text === 'world');
    expect([world.sourceStart, world.sourceEnd]).toEqual([23, 28]);
    expect(input.slice(23, 28)).toBe('world');
    const sub = textToIpa(
      '<speak>I like <sub alias="World Wide Web">WWW</sub>.</speak>',
      { lang: 'en' }
    );
    const shared = sub.words.filter((word) => word.original === 'WWW');
    expect(shared.length).toBe(3);
    expect(new Set(shared.map((word) => word.sourceStart)).size).toBe(1);
  });
});

/** One IPA span per row of the table of IPA marks (docs/markup.md). */
const IPA_ROWS = [
  ['{pp ma pp} ma', { effort: 0 }],
  ['{p ma p} ma', { effort: 0.25 }],
  ['{𝆏𝆏 ma 𝆏𝆏} ma', { effort: 0 }],
  ['{𝆏 ma 𝆏} ma', { effort: 0.25 }],
  ['{f ma f} ma', { effort: 0.75 }],
  ['{ff ma ff} ma', { effort: 1 }],
  ['{𝆑 ma 𝆑} ma', { effort: 0.75 }],
  ['{𝆑𝆑 ma 𝆑𝆑} ma', { effort: 1 }],
  ['{crescendo ma } ma', { effortEnd: 0.75 }],
  ['{diminuendo ma } ma', { effortEnd: 0.25 }],
  ['{allegro ma allegro} ma', { rate: 1.3 }],
  ['{lento ma lento} ma', { rate: 0.75 }],
  ['{1V̤ ma V̤} ma', { phonation: { breathy: 0.33 } }],
  ['{V̤ ma V̤} ma', { phonation: { breathy: 0.67 } }],
  ['{3V̤ ma V̤} ma', { phonation: { breathy: 1 } }],
  ['{V̰ ma V̰} ma', { phonation: { creaky: 0.67 } }],
  ['{C ma C} ma', { phonation: { creaky: 1 } }],
  ['{3V͈ ma V͈} ma', { phonation: { tension: 1 } }],
  ['{1V͉ ma V͉} ma', { phonation: { tension: -0.33 } }],
  ['{F ma F} ma', { phonation: { falsetto: 0.67 } }],
  ['{V! ma V!} ma', { phonation: { harsh: 0.67 } }],
  ['{W ma W} ma', { phonation: { whisper: 1 } }],
  ['{1W ma W} ma', { effort: 0.25, phonation: { whisper: 1 } }],
  ['{3W ma W} ma', { effort: 0.75, phonation: { whisper: 1 } }],
  ['{1Ṿ ma Ṿ} ma', { phonation: { whisper: 0.25 } }],
  ['{Ṿ ma Ṿ} ma', { phonation: { whisper: 0.5 } }],
  ['{3Ṿ ma Ṿ} ma', { phonation: { whisper: 0.75 } }],
  ['ˈˈma ma', { emphasis: 1 }],
];

describe('IPA marks', () => {
  it('writes and reads the same IPA marks', () => {
    for (const [ipa, change] of IPA_ROWS) {
      const parsed = parseIpa(ipa);
      expect([ipa, parsed.unknown]).toEqual([ipa, []]);
      expect(parsed.modes.length).toBe(1);
      const expected = createMode({
        ...MODE_DEFAULTS,
        ...change,
        effortEnd: change.effortEnd ?? change.effort ?? 0.5,
        phonation: { ...MODE_DEFAULTS.phonation, ...change.phonation },
      });
      for (const [field, value] of Object.entries(expected)) {
        expect([ipa, field, parsed.modes[0].mode[field]]).toEqual([
          ipa,
          field,
          value,
        ]);
      }
      const written = formatIpa(parsed.tokens, parsed.modes);
      const again = parseIpa(written);
      expect([written, again.unknown]).toEqual([written, []]);
      expect([written, again.modes]).toEqual([written, parsed.modes]);
    }
    // `{V … V}` (modal) sets every phonation value back to 0.
    const modal = parseIpa('{V̤ ma {V ma V} V̤}');
    expect(modal.modes.length).toBe(1);
    expect(modal.modes[0].to).toBe(1);
    for (const ipa of ['{W ma W}', 'a̤', 'a̰', 'ạ', '⸨cough⸩ ma', 'ma (.) ma']) {
      expect([ipa, parseIpa(ipa).unknown]).toEqual([ipa, []]);
    }
    const tokens = parseIpa('a̤ a̰ ạ').tokens.filter(
      (token) => token.kind === 'vowel'
    );
    expect([tokens[0].breathy, tokens[1].creaky, tokens[2].whispered]).toEqual([
      true,
      true,
      true,
    ]);
    const timed = parseIpa('ma (.) ma (..) ma (...) ma (1.2) ma').tokens;
    expect(
      timed.filter((token) => token.kind === 'pause').map((t) => t.seconds)
    ).toEqual([0.2, 0.4, 0.8, 1.2]);
    const sound = parseIpa('⸨cough⸩ ma').tokens[0];
    expect([sound.kind, sound.name]).toEqual(['sound', 'cough']);
    expect(parseIpa('{zz ma zz}').unknown.length > 0).toBe(true);
  });

  it('writes the marks of a marked-up text', () => {
    expect(
      textToIpa('[whisper]Hello[/whisper] world.', {
        lang: 'en',
        markup: true,
      }).ipa
    ).toBe('{W həˈloʊ W} ˈwɝld .');
    expect(
      textToIpa('<speak>Hello <emphasis>world</emphasis>.</speak>', {
        lang: 'en',
      }).ipa
    ).toBe('həˈloʊ ˈˈwɝld .');
    const plain = textToIpa('Hello world.', { lang: 'en' });
    expect([plain.ipa, plain.modes, plain.warnings]).toEqual([
      'həˈloʊ ˈwɝld .',
      [],
      [],
    ]);
  });
});

describe('plan modes', () => {
  const marked = (text) => {
    const result = textToIpa(text, { lang: 'en', markup: true });
    return { result, plan: planUtterance(result.ipa, { modes: result.modes }) };
  };
  const plainPlan = (text) =>
    planUtterance(textToIpa(text, { lang: 'en' }).ipa);
  const words = 'Hello there, my good friend';

  it('text and IPA give the same plan', () => {
    const text = '[whisper]Hello[/whisper] world.';
    const fromText = prepareUtterance(text, { lang: 'en', markup: true });
    const fromIpa = prepareUtterance(fromText.ipa, { ipa: true });
    expect(fromText.plan.modes.length > 1).toBe(true);
    expect(fromIpa.plan.modes).toEqual(fromText.plan.modes);
  });

  it('fills plan.modes', () => {
    for (const text of [
      `[fast]${words}[/fast], and [soft]more[/soft] [laugh] ok.`,
      'plain words.',
      '[pause 0.5] [whisper]a[/whisper]',
    ]) {
      const { plan } = marked(text);
      const { modes } = plan;
      expect(modes.length > 0).toBe(true);
      expect(modes[0].start).toBe(0);
      near(modes.at(-1).end, plan.duration, 1e-9);
      for (let index = 0; index < modes.length; index++) {
        const span = modes[index];
        expect(span.end > span.start).toBe(true);
        if (index > 0) {
          expect(span.start).toBe(modes[index - 1].end);
        }
        expect(Object.keys(createMode()).every((key) => key in span)).toBe(
          true
        );
      }
      expect(modeAt(plan, -1)).toBe(modes[0]);
      expect(modeAt(plan, plan.duration + 1)).toBe(modes.at(-1));
    }
    const { plan } = marked('[fast]a b[/fast] c.');
    expect(modeAt(plan, plan.duration * 0.2).rate).toBe(1.3);
  });

  it('changes rate, pitch and level', () => {
    const wordTime = (plan, from, to) =>
      plan.segments
        .filter((s) => s.token && s.token.word >= from && s.token.word < to)
        .reduce((sum, s) => sum + s.duration, 0);
    const plainLong = plainPlan(`${words}, and more.`);
    const fast = marked(`[fast]${words}[/fast], and more.`);
    const span = fast.result.modes[0];
    const ratio =
      wordTime(fast.plan, span.from, span.to) /
      wordTime(plainLong, span.from, span.to);
    near(ratio, 0.77, 0.05);

    const plain = plainPlan(`${words}.`);
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const high = marked(`[pitch +12]${words}.[/pitch]`);
    const f0 = mean(Array.from(high.plan.channels.f0));
    near(f0 / mean(Array.from(plain.channels.f0)), 2, 0.06);

    const soft = marked(`[soft]${words}.[/soft]`);
    const peak = (plan) => Math.max(...plan.channels.loudness);
    near(peak(soft.plan) / peak(plain), 0.32, 0.02);
  });

  it('times pauses and sounds exactly', () => {
    const { plan } = marked(
      'Wait [pause 1.5] now [laugh] then [cough 0.5] ok.'
    );
    const timed = plan.segments.filter((segment) => segment.timed);
    expect(
      timed.map((segment) => [
        segment.sound ?? 'pause',
        Number(segment.duration.toFixed(6)),
      ])
    ).toEqual([
      ['pause', 1.5],
      ['laugh', 0.3],
      ['cough', 0.5],
    ]);
    expect(plan.sounds.map((sound) => sound.name)).toEqual(['laugh', 'cough']);
  });
});
