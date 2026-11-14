// Issue 46: does splitting a Mandarin date, time, sum or unit into one
// word per part change its IPA (tone sandhi works inside a word only)?
// Run: node experiments/issue-46-zh-split.mjs
import { chineseWordToIpa } from '../src/g2p/chinese.js';
import { CHINESE } from '../src/g2p/verbalize-zh.js';

const ipa = (text) => chineseWordToIpa(text).ipa;
const differs = [];
const check = (label, parts) => {
  const whole = ipa(parts.join(''));
  const split = parts.map(ipa).join(' ');
  if (whole !== split) {
    differs.push({ label, parts, whole, split });
  }
};
for (const year of [1999, 2000, 2005, 2024, 1985]) {
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const [text] = CHINESE.date({ year, month, day });
      const y = text.slice(0, text.indexOf('年') + 1);
      const m = text.slice(y.length, text.indexOf('月') + 1);
      check(`date ${year}-${month}-${day}`, [
        y,
        m,
        text.slice(y.length + m.length),
      ]);
    }
  }
}
for (let hours = 0; hours <= 24; hours++) {
  for (let minutes = 1; minutes < 60; minutes++) {
    const [text] = CHINESE.time(hours, minutes);
    const at = text.indexOf('点') + 1;
    check(`time ${hours}:${minutes}`, [text.slice(0, at), text.slice(at)]);
  }
}
console.log(`differences: ${differs.length}`);
for (const item of differs.slice(0, 15)) {
  console.log(JSON.stringify(item));
}
