// Which head parameter keeps the back-vowel F2 from rising for the female
// preset: tube formants of /i ɑ u/ with one female value at a time on the
// male head.
// Usage: node experiments/issue-9-preset-sensitivity.mjs [preset=female]
import { tubeFormants } from '../src/acoustics/transfer.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { presetHeadConfig } from '../src/head-config.js';

const male = presetHeadConfig('male');
const other = presetHeadConfig(process.argv[2] ?? 'female');
const KEYS = [
  'vocalTractLength',
  'pharynxRatio',
  'pharynxWidth',
  'oralWidth',
  'mouthWidth',
  'lipThickness',
  'jawRange',
  'tongueSize',
];

function formants(head) {
  return ['i', 'ɑ', 'u']
    .map((vowel) => {
      const shape = tractShape(
        { ...vowelTarget({ phoneme: getPhoneme(vowel) }), rhotic: 0 },
        head
      );
      return tubeFormants(shape.areas, shape.length, { count: 2 })
        .map(Math.round)
        .join('/');
    })
    .join('  ');
}

console.log(`male             ${formants(male)}`);
for (const key of KEYS) {
  console.log(
    `${key.padEnd(16)} ${formants({ ...male, [key]: other[key] })}  (${male[key]} -> ${other[key]})`
  );
}
console.log(`all              ${formants(other)}`);
