// Prints the examples of docs/markup.md: one input per row of the three
// tables (SSML, inline tags, IPA marks) with the IPA that textToIpa()
// writes and the mode fields that change.
// Run: node experiments/issue-50-doc-examples.mjs
import { textToIpa } from '../src/g2p/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { MODE_DEFAULTS } from '../src/markup/modes.js';

/** The fields of a mode that differ from MODE_DEFAULTS. */
function changed(mode) {
  const out = [];
  for (const [key, value] of Object.entries(mode)) {
    const base = MODE_DEFAULTS[key];
    if (value && typeof value === 'object') {
      for (const [inner, innerValue] of Object.entries(value)) {
        if (innerValue !== base[inner]) {
          out.push(`${key}.${inner} ${innerValue}`);
        }
      }
    } else if (value !== base) {
      out.push(`${key} ${value}`);
    }
  }
  return out.join(', ');
}

const SSML = [
  '<speak xml:lang="en-GB">Hello.</speak>',
  '<speak><p>Hello there</p><p>Goodbye</p></speak>',
  '<speak>Wait<break time="300ms"/>now<break strength="strong"/>go.</speak>',
  '<speak><prosody rate="fast" pitch="+2st">Hello there</prosody> friend.</speak>',
  '<speak><prosody pitch="200Hz" range="x-high">Hello</prosody> there.</speak>',
  '<speak><prosody volume="x-soft">Hello</prosody> there.</speak>',
  '<speak><prosody vs:gain="-6dB">Hello</prosody> there.</speak>',
  '<speak>Hello <emphasis>world</emphasis>.</speak>',
  '<speak><say-as interpret-as="characters">abc</say-as>.</speak>',
  '<speak>A <phoneme alphabet="ipa" ph="təˈmɑːtəʊ">tomato</phoneme>.</speak>',
  '<speak>Say <lang xml:lang="ru">привет</lang>.</speak>',
  '<speak><sub alias="World Wide Web">WWW</sub>.</speak>',
  '<speak><vs:effort level="whisper">Hello</vs:effort> there.</speak>',
  '<speak><vs:effort value="0.5" to="0.75">Hello there</vs:effort>.</speak>',
  '<speak><vs:phonation name="breathy">Hello</vs:phonation> there.</speak>',
  '<speak><vs:emotion name="sad" intensity="0.8">Hello</vs:emotion> there.</speak>',
  '<speak>Hello <vs:sound name="laugh"/> there.</speak>',
];
const INLINE = [
  '[whisper]Hello[/whisper] there.',
  '[soft]Hello[/soft] [loud]there[/loud] [shout]now[/shout].',
  '[effort 0.75]Hello[/effort] there.',
  '[fast]Hello[/fast] [slow]there[/slow] [rate 1.5]now[/rate].',
  '[high]Hello[/high] [low]there[/low] [pitch -2]now[/pitch].',
  '[breathy]Hello[/breathy] [creaky 1]there[/creaky].',
  '[pressed]Hello[/pressed] [lax]there[/lax].',
  '[falsetto]Hello[/falsetto] [harsh]there[/harsh].',
  '[angry 0.8]Hello[/angry] there.',
  'Say [lang ru]привет[/lang].',
  'A [ipa təˈmɑːtəʊ] please.',
  'Wait [pause 0.3] now.',
  'Hello [laugh] there [cough 0.5] ok.',
  'Hello *world*.',
  'Literal \\[1\\] and \\*.',
];
const IPA = [
  '{pp həˈloʊ pp} ˈwɝld',
  '{𝆏 həˈloʊ 𝆏} ˈwɝld',
  '{ff həˈloʊ ff} ˈwɝld',
  '{crescendo həˈloʊ ˈwɝld }',
  '{diminuendo həˈloʊ ˈwɝld }',
  '{allegro həˈloʊ allegro} ˈwɝld',
  '{lento həˈloʊ lento} ˈwɝld',
  '{3V̤ həˈloʊ V̤} ˈwɝld',
  '{V̰ həˈloʊ V̰} ˈwɝld',
  '{C həˈloʊ C} ˈwɝld',
  '{V͈ həˈloʊ V͈} {1V͉ ˈwɝld V͉}',
  '{F həˈloʊ F} {V! ˈwɝld V!}',
  '{W həˈloʊ W} {1W ˈwɝld W}',
  '{Ṿ həˈloʊ Ṿ} ˈwɝld',
  '{V̤ həˈloʊ {V ˈwɝld V} V̤}',
  'həˈloʊ (.) ˈwɝld (1.2) ˈbaɪ',
  '⸨laugh⸩ həˈloʊ ⸨cough 0.5⸩',
  'həˈloʊ ˈˈwɝld',
  'a̤ a̰ ạ',
];
console.log('## SSML');
for (const input of SSML) {
  const result = textToIpa(input);
  console.log(input);
  console.log(`  ipa: ${result.ipa}`);
  for (const span of result.modes) {
    console.log(`  words ${span.from}-${span.to}: ${changed(span.mode)}`);
  }
  for (const warning of result.warnings) {
    console.log(`  warning: ${warning.message}`);
  }
}
console.log('## Inline');
for (const input of INLINE) {
  const result = textToIpa(input, { lang: 'en', markup: true });
  console.log(input);
  console.log(`  ipa: ${result.ipa}`);
  for (const span of result.modes) {
    console.log(`  words ${span.from}-${span.to}: ${changed(span.mode)}`);
  }
}
console.log('## IPA');
for (const input of IPA) {
  const result = parseIpa(input);
  const extra = result.tokens
    .filter((token) => token.kind === 'sound' || token.seconds !== undefined)
    .map((token) =>
      token.kind === 'sound'
        ? `sound ${token.name}${token.duration ? ` ${token.duration}` : ''}`
        : `pause ${token.seconds}`
    );
  console.log(input, JSON.stringify(result.unknown));
  for (const span of result.modes) {
    console.log(`  words ${span.from}-${span.to}: ${changed(span.mode)}`);
  }
  if (extra.length) {
    console.log(`  ${extra.join(', ')}`);
  }
}
