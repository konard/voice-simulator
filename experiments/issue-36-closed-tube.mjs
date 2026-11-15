// Lowest resonance of a 17 cm tube of 3 cm² closed at both ends, from the
// pressure in its middle: the yielding walls make it a mass-spring system
// resonating near 190 Hz (Fant 1972), where a rigid tube has none.
// Run: node experiments/issue-36-closed-tube.mjs
import { impulseSpectrum, resonances } from '../src/acoustics/analysis.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND, tubeSpectrum } from '../src/acoustics/transfer.js';

const LENGTH = 17;
const SECTIONS = 34;
const areas = Array.from({ length: SECTIONS }, (_, i) =>
  i === SECTIONS - 1 ? 0 : 3
);
for (const walls of [true, false]) {
  const solver = new Waveguide({ sections: SECTIONS, piriform: false, walls });
  solver.setShape(areas, 0, 10);
  solver.setLength(LENGTH);
  solver.glottalReflection = 1;
  const rate = (SECTIONS * SPEED_OF_SOUND) / LENGTH;
  const response = new Float64Array(Math.round(0.5 * rate));
  for (let i = 0; i < response.length; i++) {
    solver.step(i === 0 ? 1 : 0, 0, 0);
    response[i] = solver.right[SECTIONS / 2] + solver.left[SECTIONS / 2];
  }
  // The injected volume stays in the closed tube: remove the static
  // pressure it leaves so that its step does not hide the resonances.
  const tail = response.subarray(Math.round(0.9 * response.length));
  const rest = tail.reduce((sum, value) => sum + value, 0) / tail.length;
  for (let i = 0; i < response.length; i++) {
    response[i] -= rest;
  }
  const spectrum = impulseSpectrum(response, rate, {
    from: 20,
    to: 1500,
    step: 1,
  });
  const peaks = resonances(spectrum, { count: 2, from: 20 });
  let best = 0;
  for (
    let i = 0;
    i < spectrum.magnitudes.length && spectrum.frequencies[i] < 600;
    i++
  ) {
    if (spectrum.magnitudes[i] > spectrum.magnitudes[best]) {
      best = i;
    }
  }
  console.log(
    `  strongest below 600 Hz: ${spectrum.frequencies[best]} Hz; levels (dB) at 50/100/150/190/250/400/1000: ${[
      50, 100, 150, 190, 250, 400, 1000,
    ]
      .map((f) => (20 * Math.log10(spectrum.magnitudes[f - 20])).toFixed(0))
      .join(' ')}`
  );
  const tube = tubeSpectrum(
    areas.map((a) => Math.max(a, 1e-4)),
    LENGTH,
    {
      walls,
      output: 'pressure',
      probe: SECTIONS / 2,
      step: 1,
      minFrequency: 20,
      maxFrequency: 1500,
    }
  );
  const tubePeaks = resonances(tube, { count: 2, from: 20 });
  const show = (list) =>
    list
      .map(
        ({ frequency: f, bandwidth: b }) => `${f.toFixed(0)}/${b.toFixed(0)}`
      )
      .join(' ');
  console.log(
    `walls ${walls}: waveguide ${show(peaks)}  tube ${show(tubePeaks)}`
  );
}
