// Lossless chain-matrix formants of a vowel area function with and without
// blind side branches (piriform fossae, vallecula) to separate the pouch
// effect of the area function from the 3D solver (issue 9 preset study).
// Usage: node experiments/issue-9-pouch-tube.mjs [vowels]
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const C = 35000;
const head = normalizeHeadConfig({});
const vowels = (process.argv[2] ?? 'i,ɑ,u,ə').split(',');

// Matrices of [[a, jb], [jc, d]] with real a b c d (lossless tube algebra).
function section(k, area, length) {
  const z = 1 / area;
  return [
    Math.cos(k * length),
    z * Math.sin(k * length),
    Math.sin(k * length) / z,
    Math.cos(k * length),
  ];
}
function stub(k, area, depth) {
  return [1, 0, area * Math.tan(k * depth), 1];
}
function mul([a1, b1, c1, d1], [a2, b2, c2, d2]) {
  // (a1 + jb1 jc2) etc: j*j = -1
  return [
    a1 * a2 - b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    d1 * d2 - c1 * b2,
  ];
}
function d22(f, areas, length, branches) {
  const k = (2 * Math.PI * f) / C;
  const dl = length / areas.length;
  let m = [1, 0, 0, 1];
  for (let i = 0; i < areas.length; i++) {
    const x = i * dl;
    for (const b of branches) {
      if (b.at >= x && b.at < x + dl) {
        m = mul(m, stub(k, b.area, b.depth));
      }
    }
    m = mul(m, section(k, areas[i], dl));
  }
  return m[3];
}
function formants(areas, length, branches) {
  const out = [];
  let prev = d22(20, areas, length, branches);
  for (let f = 25; f < 5000 && out.length < 4; f += 5) {
    const v = d22(f, areas, length, branches);
    if (Math.sign(v) !== Math.sign(prev) && Math.abs(v - prev) < 5) {
      out.push(f);
    }
    prev = v;
  }
  return out;
}
const scale = head.vocalTractLength / 16.5;
const sets = {
  none: [],
  piriform: [{ at: 2.4 * scale, area: 0.5, depth: 2 * scale }],
  both: [
    { at: 2.4 * scale, area: 0.5, depth: 2 * scale },
    { at: 3.6 * scale, area: 0.6, depth: 1 * scale },
  ],
};
for (const v of vowels) {
  const s = tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(v) }), rhotic: 0 },
    head
  );
  const row = Object.entries(sets).map(
    ([name, b]) => `${name} ${formants(s.areas, s.length, b).join(' ')}`
  );
  console.log(`/${v}/ ${row.join(' | ')}`);
}
