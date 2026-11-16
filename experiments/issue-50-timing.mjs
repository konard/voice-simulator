// How long parseMarkup() takes on SSML of the maximum length (20 000
// characters) and on inline tags of the same length: the median of 21 runs
// after 5 warm-up runs. The issue asks for less than 50 ms on Node.js.
// Run: node experiments/issue-50-timing.mjs
import { performance } from 'node:perf_hooks';
import { MARKUP_LIMITS, parseMarkup } from '../src/markup/index.js';

const unit =
  '<s>Hello <emphasis>there</emphasis>, <prosody rate="fast" pitch="+2st">' +
  'my <vs:phonation name="breathy">good</vs:phonation></prosody> friend' +
  '<break time="200ms"/></s> ';
/** Whole copies of `piece` that fit in `room` characters. */
const body = (piece, room) => piece.repeat(Math.floor(room / piece.length));
const ssml = `<speak>${body(unit, MARKUP_LIMITS.maxLength - 15)}</speak>`;
const inlineUnit =
  'Hello [loud]there[/loud], [fast]my [breathy]good[/breathy][/fast] friend [pause 0.2] ';
const inline = body(inlineUnit, MARKUP_LIMITS.maxLength);

function median(run) {
  for (let index = 0; index < 5; index++) {
    run();
  }
  const times = [];
  for (let index = 0; index < 21; index++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return times.sort((left, right) => left - right)[10];
}

for (const [name, text, options] of [
  ['SSML', ssml, {}],
  ['inline', inline, { markup: true }],
]) {
  let result;
  const time = median(() => {
    result = parseMarkup(text, options);
  });
  console.log(
    `${name}: ${text.length} characters, ${result.spans.length} spans, ` +
      `${result.breaks.length} breaks, ${result.warnings.length} warnings, ` +
      `median ${time.toFixed(2)} ms (limit 50 ms): ${time < 50 ? 'ok' : 'SLOW'}`
  );
}
