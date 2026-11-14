// Erhua in the planned utterance: IPA, vowel segments and duration.
// Run: node experiments/issue-43-erhua.mjs > experiments/issue-43-erhua.txt
import { planUtterance, prepareUtterance, textToIpa } from '../src/index.js';

for (const text of ['花儿', '一点儿', '小孩儿', '事儿', '女儿', 'hua1r']) {
  const { ipa } = textToIpa(text, { lang: 'zh' });
  const plan = planUtterance(ipa);
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const { timeline } = prepareUtterance(text, { lang: 'zh', tier: 'minimal' });
  console.log(
    JSON.stringify({
      text,
      ipa,
      vowelSegments: vowels.length,
      duration: Number(plan.duration.toFixed(4)),
      syllables: timeline.words.map((word) =>
        word.syllables.map((syllable) => syllable.text ?? null)
      ),
    })
  );
}
