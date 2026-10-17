// Render the example app's SpokenText to HTML for a few languages to check
// the word and syllable spans. Run after `npm install --prefix examples/universal-app`:
//   node experiments/issue-5-spoken-text.mjs
import { createElement as h } from '../examples/universal-app/node_modules/react/index.js';
import { renderToStaticMarkup } from '../examples/universal-app/node_modules/react-dom/server.js';
import { prepareUtterance } from '../src/index.js';
import { SpokenText } from '../examples/universal-app/src/components/SpokenText.js';
import { highlightAt } from '../examples/universal-app/src/components/highlight.js';

const samples = [
  ['Hello, simulated mountain! On 3/5/2024.', 'en'],
  ['Привет, звуковых миров.', 'ru'],
  ['你好，声音', 'zh'],
  ['नमस्ते दुनिया', 'hi'],
];

for (const [text, lang] of samples) {
  const prepared = prepareUtterance(text, { lang });
  console.log(
    renderToStaticMarkup(
      h(SpokenText, {
        text,
        lang: prepared.lang,
        timeline: prepared.timeline,
        t: { spoken: 'Spoken text' },
      })
    )
  );
  const steps = [];
  for (let time = 0; time < prepared.timeline.duration; time += 0.1) {
    const current = highlightAt(prepared.timeline, time);
    steps.push(current ? `${current.word}.${current.syllable}` : '-');
  }
  console.log(steps.join(' '));
}
