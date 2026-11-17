import { render } from '../../tests/helpers/recognition-modes.js';
import {
  glottalPeriods,
  pulseF0,
  jitterPercent,
  voicedShare,
} from '../../src/analysis/mode-features.js';
for (const label of [null, 'C', 'V̰', 'V!']) {
  const a = render('en', label);
  console.log(
    label,
    a.sampleRate,
    a.samples.length,
    glottalPeriods(a.samples, a.sampleRate).map((r) => r.periods.length),
    pulseF0(a.samples, a.sampleRate),
    jitterPercent(a.samples, a.sampleRate),
    voicedShare(a.samples, a.sampleRate)
  );
}
