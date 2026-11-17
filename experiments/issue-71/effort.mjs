/** Focused bounded effort/ramp trace. Unlicense. */
import {
  render,
  recognize,
  LANGUAGES,
  dominant,
} from '../../tests/helpers/recognition-modes.js';
for (const lang of LANGUAGES) {
  for (const label of ['pp', 'p', 'f', 'ff', 'V̰', 'C']) {
    const audio = render(lang, label);
    let e;
    const result = recognize(audio, lang, {
      trace: (r) => {
        if (r.stage === 'words') {
          e = r;
        }
      },
    });
    console.log(
      JSON.stringify({
        lang,
        label,
        actual: dominant(result.modes),
        modes: result.modes,
        baseline: e.baseline,
        features: e.features,
        labels: e.labels,
      })
    );
  }
}
for (const lang of ['en']) {
  const audio = render(
    lang,
    null,
    '[crescendo] one two three four five six [/crescendo]'
  );
  const events = [];
  const result = recognize(audio, lang, { trace: (r) => events.push(r) });
  console.log(
    JSON.stringify({ lang, label: 'crescendo', modes: result.modes, events })
  );
}
