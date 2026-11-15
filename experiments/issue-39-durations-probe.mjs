// Prints the token durations (ms) of the planned test words of issue 39.
import { planUtterance } from '../src/articulation/plan.js';
import { textToIpa } from '../src/g2p/index.js';

const show = (ipa, language = 'en') => {
  const plan = planUtterance(ipa, { language });
  const parts = plan.segments
    .filter((segment) => segment.token)
    .map(
      (segment) =>
        `${segment.token.symbol}${segment.kind === 'release' ? '+' : ''}:${Math.round(segment.duration * 1000)}`
    );
  console.log(
    `${language} ${ipa.padEnd(14)} ${plan.duration.toFixed(3)} s  ${parts.join(' ')}`
  );
};

for (const ipa of [
  'ˈbæd',
  'ˈbæt',
  'ˈstɪk',
  'ˈstɪki',
  'ˈstɪkinəs',
  'ˈstɑ',
  'ˈsɑ',
  'ˈmɑmɑ.',
  'ˈmɑmɑ ˈmɑmɑ.',
]) {
  show(ipa);
}
show('məlɐˈko', 'ru');
show('kaːl', 'hi');
show('kəl', 'hi');
show(textToIpa('ma1ma5', { lang: 'zh' }).ipa, 'zh');
