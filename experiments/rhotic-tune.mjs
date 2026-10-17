// Search rhotic constriction settings that lower F3 the most (target ~1700 Hz).
import { constrict } from '../src/articulation/tract-shape.js';
import { vowelShape } from '../src/articulation/vowel-space.js';
import { tubeFormants } from '../src/acoustics/transfer.js';

const results = [];
for (const pal of [0.72, 0.76, 0.8, 0.84]) {
  for (const palArea of [0.15, 0.25, 0.4]) {
    for (const ph of [0.2, 0.3, 0.4]) {
      for (const lip of [0, 1]) {
        const s = vowelShape({ height: 0.5, backness: 0.5, rounded: 0 });
        constrict(s.areas, pal, 0.05, palArea, 1);
        constrict(s.areas, ph, 0.08, 0.9, 1);
        constrict(s.areas, 1, 0.04, 1.2, lip);
        const f = tubeFormants(s.areas, s.length, { count: 3 });
        results.push([
          f[2],
          pal,
          palArea,
          ph,
          lip,
          f.map(Math.round).join(' '),
        ]);
      }
    }
  }
}
results.sort((a, b) => a[0] - b[0]);
console.log(results.slice(0, 8));
