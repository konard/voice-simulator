// Smallest box depth (cm) that contains the lips and nostrils of the most
// extreme heads, with the box centred on the head (the app's box setting).
import {
  DEFAULT_HEAD,
  HEAD_PARAMETERS,
  enclosureBounds,
  randomHeadConfig,
} from '../src/index.js';

function smallestDepth(head) {
  for (let depth = 10; depth <= 200; depth += 2) {
    try {
      enclosureBounds(head, { width: 30, height: 44, depth });
      return depth;
    } catch {
      // Too shallow: try a deeper box.
    }
  }
  return Infinity;
}

const heads = [DEFAULT_HEAD];
for (const parameter of HEAD_PARAMETERS) {
  for (const value of [parameter.min, parameter.max]) {
    heads.push({ ...DEFAULT_HEAD, [parameter.key]: value });
  }
}
const extreme = Object.fromEntries(
  HEAD_PARAMETERS.map((parameter) => [parameter.key, parameter.max])
);
heads.push({ ...DEFAULT_HEAD, ...extreme });
for (let seed = 1; seed <= 200; seed++) {
  heads.push(randomHeadConfig(seed));
}
const depths = heads.map(smallestDepth);
console.log('default head', depths[0]);
console.log('largest over', heads.length, 'heads', Math.max(...depths));
