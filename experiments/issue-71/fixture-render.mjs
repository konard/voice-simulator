/** Bounded proof that transcription-only setup preserves all 60 fixtures. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { synthesize } from '../../src/index.js';
import { BASELINE_TEXT } from '../../src/recognition/mode-baseline.js';
import {
  LANGUAGES,
  LABELS,
  HEAD,
  render,
} from '../../tests/helpers/recognition-modes.js';

let beforeMs = 0;
let afterMs = 0;
let cases = 0;
for (const lang of LANGUAGES) {
  const options = {
    lang,
    head: HEAD,
    tier: 'minimal',
    seed: 1,
    engine: 'js',
    markup: true,
  };
  for (const label of LABELS) {
    const started = performance.now();
    const neutral = synthesize(BASELINE_TEXT[lang], options);
    const expected = synthesize(`{${label} ${neutral.ipa} ${label}}`, {
      ...options,
      ipa: true,
    });
    const prepared = performance.now();
    const actual = render(lang, label);
    const finished = performance.now();
    beforeMs += prepared - started;
    afterMs += finished - prepared;
    assert.equal(actual.ipa, expected.ipa);
    assert.deepEqual(actual.timeline.words, expected.timeline.words);
    assert.deepEqual(actual.samples, expected.samples);
    cases++;
  }
}
console.log(JSON.stringify({ cases, beforeMs, afterMs }));
