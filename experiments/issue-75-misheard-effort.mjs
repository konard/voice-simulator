/**
 * A loud sentence whose words recognition partly mishears: does
 * recognizeModes() still hear it as one sentence-wide `f`? The words are
 * grouped as wideband recognition heard 你好，你今天怎么样？ in issue 75
 * (你好 | 泥 | 今天 | 怎么样); the misheard tone of the second 你 moves that
 * word's neutral pitch away from the others.
 * node experiments/issue-75-misheard-effort.mjs [tone ipa...]
 * Unlicense.
 */
import { render, recognize } from '../tests/helpers/recognition-modes.js';

const tones = process.argv.slice(2);
const audio = render('zh', 'f', '你好，你今天怎么样？');
const w = audio.timeline.words;
const join = (a, b, ipa) => ({
  ...w[a],
  end: w[b].end,
  ipa:
    ipa ??
    w
      .slice(a, b + 1)
      .map((x) => x.ipa)
      .join(''),
  text: w
    .slice(a, b + 1)
    .map((x) => x.text)
    .join(''),
});
for (const tone of tones.length ? tones : ['ni˨˩', 'ni˧˥', 'ni˥˩']) {
  const words = [join(0, 1), join(2, 2, tone), join(3, 4), join(5, 7)];
  const heard = recognize(
    { ...audio, timeline: { ...audio.timeline, words } },
    'zh',
    {
      trace: (e) =>
        e.stage === 'words' &&
        console.log(
          '  pitch',
          e.features
            .filter((f) => f.vowels)
            .map((f) => f.pitch.toFixed(0))
            .join(' ')
        ),
    }
  );
  console.log(
    tone,
    JSON.stringify(heard.modes.map((m) => [m.notation, m.from, m.to]))
  );
}
