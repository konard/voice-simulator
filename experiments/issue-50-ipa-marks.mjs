// Probe of the IPA marks of issue 50: parse, format and round-trip.
// Run: node experiments/issue-50-ipa-marks.mjs
import { parseIpa, formatIpa } from '../src/ipa/parse.js';

const cases = [
  '{W ma W}',
  'a̤',
  'a̰',
  'ạ',
  '⸨cough⸩ ma',
  'ma (.) ma',
  'ma (1.5) ma , ma',
  '{3V̤ ma ma V̤} ma',
  '{f {crescendo ma ma } f}',
  '{allegro ma allegro} {lento ma lento}',
  '{Ṿ ma Ṿ} {1Ṿ ma Ṿ} {C ma C} {V͈ ma V͈} {1V͉ ma V͉} {F ma F} {V! ma V!}',
  '{pp ma pp} {p ma p} {ff ma ff} {𝆏 ma 𝆏}',
  '{1W ma W} {3W ma W} {V ma V}',
  'həˈloʊ ˈˈwɝld .',
  '{W həˈloʊ W} ˈwɝld .',
  'ma ⸨laugh⸩. ma',
  '{X ma X} ma} {W} ⸨boo⸩',
];
for (const text of cases) {
  const { tokens, unknown, modes } = parseIpa(text);
  const written = formatIpa(tokens, modes);
  const again = parseIpa(written);
  const same = JSON.stringify(again.modes) === JSON.stringify(modes);
  console.log(
    JSON.stringify(text),
    '->',
    JSON.stringify(written),
    'unknown',
    JSON.stringify(unknown),
    'modes',
    modes.map((span) => `${span.from}-${span.to}`).join(','),
    same ? 'round-trip ok' : 'ROUND-TRIP DIFFERS',
    'words',
    tokens.map((token) => token.word).join('')
  );
}
