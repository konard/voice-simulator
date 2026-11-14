// Audit of function words, clitics and pinyin input for the plan of issue 11.
// Run: node experiments/issue-11-audit-m3c.mjs > experiments/issue-11-audit-m3c.txt
import { planUtterance, textToIpa } from '../src/index.js';

const show = (lang, text) =>
  console.log(
    `${lang} ${text}: ${JSON.stringify(textToIpa(text, { lang }).ipa)}`
  );

console.log('# 1. English function words');
for (const text of [
  'the apple and the pear',
  'the end',
  'a cup of tea for you',
  'I can do it',
  'Yes, I can.',
  // eslint-disable-next-line local/no-changelog-comments -- a test sentence
  'I used to live there',
  'I have to go',
  'He was at home',
  'What are you looking at?',
  'She gave it to him',
  'an apple',
  'to and from the office',
]) {
  show('en', text);
}

console.log('# 2. Russian prepositions and particles');
for (const text of [
  'Ключ от замка',
  'в лесу',
  'с братом',
  'к дому',
  'из города',
  'под окном',
  'без сахара',
  'об этом',
  'Я не знаю',
  'Он же сказал',
  'на гору',
  'за город',
  'из дома',
  'от брата',
  'в доме',
  'на работе',
  'через дорогу',
  'перед домом',
  'для меня',
  'с Иваном',
  'из-за дома',
  'как же',
  'вот бы',
  'знаешь ли',
  'О боже',
  // The phrases of the tests of issue 86.
  'из парка',
  'в парке',
  'без меня',
  'под домом',
  'от мамы',
  'к маме',
  'к вам',
  'до завтра',
  'по дороге',
  'у меня',
  'со мной',
  'обо мне',
  'от Ивана',
  'из-под дома',
  'не для меня',
  'друг же',
  'сказал бы',
  'Он сказал, в доме',
  'Да, на.',
  'на',
  'в',
  'не',
  'бы',
  'на́ гору',
  'н+а гору',
  'в office',
]) {
  show('ru', text);
}

console.log('# 3. Latin input in Chinese mode');
for (const text of [
  'ni3hao3',
  'nǐ hǎo',
  'nihao',
  'beijing',
  'Zhōngguó',
  'zhong1guo2',
  'nü3',
  'nv3',
  'lüè',
  'lve4',
  "xi'an",
  "Xī'ān",
  'xian1',
  'ni3 hao5',
  'ma',
  'ma0',
  'iPhone',
  'zhongg',
  'shanghai ren',
]) {
  show('zh', text);
}

console.log('# 4. Tone sandhi across spaces');
for (const text of [
  '你好',
  '你 好',
  '我很好',
  '我 很 好',
  'wo3hen3hao3',
  'wo3 hen3 hao3',
  'wǒ hěn hǎo',
  'nǐ hǎo ma',
  '你好吗',
  '你 好 吗',
  '不对',
  '不 对',
  '一个',
  '一 个',
  'bu4 dui4',
]) {
  show('zh', text);
}

console.log('# 5. Planned vowel durations (ms) with strong and weak forms');
for (const ipa of [
  'ə ˈkʌp ˈʌv ˈti ˈfɔɹ ˈju',
  'ə ˈkʌp əv ˈti fɚ ju',
  'ˈaɪ ˈkæn ˈdu ˈɪt',
  'aɪ kən ˈdu ɪt',
]) {
  const plan = planUtterance(ipa, { language: 'en' });
  const vowels = plan.segments
    .filter((segment) => segment.kind === 'vowel')
    .map((segment) => Math.round((segment.end - segment.start) * 1000));
  console.log(
    `${ipa}: ${plan.duration.toFixed(3)} s, vowels ${vowels.join(' ')}`
  );
}
