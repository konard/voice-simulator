// Print what parseMarkup reads from a text (SSML, or inline with --markup).
// Usage: node experiments/issue-50-markup.mjs [--markup] "<speak>…</speak>"
import { parseMarkup } from '../src/markup/index.js';
const args = process.argv.slice(2);
const markup = args.includes('--markup') ? true : undefined;
const inputs = args.filter((arg) => arg !== '--markup');
for (const input of inputs) {
  try {
    const result = parseMarkup(input, { markup });
    const { spans, ...rest } = result;
    delete rest.offsets;
    console.log(JSON.stringify(input));
    console.log(' ', JSON.stringify(rest));
    for (const span of spans) {
      console.log(
        '  span',
        span.start,
        span.end,
        JSON.stringify(result.text.slice(span.start, span.end)),
        JSON.stringify(span.mode)
      );
    }
  } catch (error) {
    console.log(
      JSON.stringify(input),
      '->',
      error.name,
      error.message,
      error.position
    );
  }
}
