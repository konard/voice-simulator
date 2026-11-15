// Hindi questions: rise or fall at the end, and the planned pitch (Hz)
// 20 ms after the start and 20 ms before the end of the last vowel.
// Run: node experiments/issue-45-hindi-questions.mjs > experiments/issue-45-hindi-questions.txt
import { prepareUtterance, textToIpa } from '../src/index.js';

for (const text of [
  // Polar questions with the particle: rise.
  'क्या तुम आओगे?',
  'क्या आप ठीक हैं?',
  'क्या यह आपकी किताब है?',
  'क्या वह घर पर है?',
  // Polar question without the particle: rise.
  'तुम आओगे?',
  // क्या meaning "what": fall.
  'तुम क्या खाओगे?',
  'यह क्या है?',
  'तुम्हारा नाम क्या है?',
  'क्या हुआ?',
  'क्या बात है?',
  // Question words in any position: fall.
  'आप कहाँ जा रहे हैं?',
  'आप कल कहाँ जा रहे हैं?',
  'वह आदमी कौन है?',
  'तुम इतनी देर से क्यों आए?',
  // Known limit: a two-word question with the subject left out falls.
  'क्या आओगे?',
]) {
  const { plan } = prepareUtterance(text, { lang: 'hi', tier: 'minimal' });
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const at = (time) =>
    Math.round(plan.channels.f0[Math.round(time * plan.frameRate)]);
  const last = vowels.at(-1);
  console.log(
    JSON.stringify({
      text,
      ipa: textToIpa(text, { lang: 'hi' }).ipa,
      lastVowelStart: at(last.start + 0.02),
      lastVowelEnd: at(last.end - 0.02),
    })
  );
}
