// Peak levels of the resonances of a uniform tube (17.5 cm, 3 cm², no
// pouches, no nose) in the 2D sheet and the 1D waveguide: does the sheet
// lose more at high frequencies? Usage:
// node experiments/issue-37-tube-levels.mjs [area] [dx]
import { Fdtd2d } from '../src/acoustics/fdtd2d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const area = Number(process.argv[2] ?? 3);
const dx = Number(process.argv[3] ?? 0.6);
const head = {
  ...DEFAULT_HEAD,
  vocalTractLength: 17.5,
  ...(process.env.WALL ? { wallLoss: Number(process.env.WALL) } : {}),
};
const tube = new Array(44).fill(area);
const impulse = (solver, rate) => {
  const response = new Float64Array(Math.round(rate * 0.2));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return { response, rate };
};
const level = ({ response, rate }, frequency) => {
  const omega = (2 * Math.PI * frequency) / rate;
  let re = 0;
  let im = 0;
  for (let n = 0; n < response.length; n++) {
    re += response[n] * Math.cos(omega * n);
    im -= response[n] * Math.sin(omega * n);
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-30);
};
/** Level (dB) and -3 dB bandwidth (Hz) of the peak near each odd quarter wave. */
function peaks(result) {
  const out = [];
  for (let k = 1; k <= 15; k += 2) {
    const guess = (k * SPEED_OF_SOUND) / (4 * 17.5);
    let best = -Infinity;
    let at = guess;
    for (let f = guess * 0.85; f <= guess * 1.15; f += 5) {
      const value = level(result, f);
      if (value > best) {
        best = value;
        at = f;
      }
    }
    let low = at;
    while (low > at * 0.8 && level(result, low) > best - 3) {
      low -= 5;
    }
    let high = at;
    while (high < at * 1.2 && level(result, high) > best - 3) {
      high += 5;
    }
    out.push({ at, best, bandwidth: high - low });
  }
  return out;
}
const sheet = new Fdtd2d({ head, dx, piriform: false, vallecula: false });
sheet.setShape(tube, 0);
sheet.setLength(17.5);
const a = peaks(impulse(sheet, 1 / sheet.stepDuration({ length: 17.5 })));
const wave = new Waveguide({ sections: 44, piriform: false, head });
wave.setShape(tube, 0);
wave.setLength(17.5);
const b = peaks(impulse(wave, (44 * SPEED_OF_SOUND) / 17.5));
console.log(`uniform tube ${area} cm², 2D dx ${dx}`);
console.log('peak Hz (2D/wg)   level re F1 dB (2D/wg)   bandwidth Hz (2D/wg)');
for (let i = 0; i < a.length; i++) {
  console.log(
    `${Math.round(a[i].at)}/${Math.round(b[i].at)}`.padEnd(18),
    `${(a[i].best - a[0].best).toFixed(1)}/${(b[i].best - b[0].best).toFixed(1)}`.padEnd(
      24
    ),
    `${a[i].bandwidth}/${b[i].bandwidth}`
  );
}
