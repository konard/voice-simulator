/**
 * Hillenbrand, Getty, Clark and Wheeler (1995, JASA 97(5):3099-3111):
 * steady-state f0 and F1-F3 (Hz) of American English vowels from 45 men,
 * 48 women and 46 children, averaged over the tokens of the public data
 * file (docs/case-studies/issue-9/research/5-female-child-voices.md).
 * The male means calibrate the vowel space; the female and child means
 * check that the presets scale it like real speakers do.
 */
export const HILLENBRAND = Object.freeze({
  male: Object.freeze({
    f0: 131,
    i: [343, 2323, 3001],
    ɪ: [429, 2034, 2687],
    e: [476, 2090, 2692],
    ɛ: [588, 1803, 2604],
    æ: [591, 1930, 2595],
    ʌ: [621, 1181, 2548],
    ɑ: [756, 1309, 2535],
    ɔ: [656, 1023, 2521],
    o: [498, 910, 2459],
    ʊ: [469, 1123, 2435],
    u: [380, 992, 2355],
    ɝ: [475, 1379, 1711],
  }),
  female: Object.freeze({
    f0: 220,
    i: [437, 2761, 3373],
    ɪ: [484, 2369, 3057],
    e: [535, 2526, 3050],
    ɛ: [727, 2063, 2953],
    æ: [676, 2335, 2973],
    ʌ: [760, 1416, 2901],
    ɑ: [921, 1526, 2832],
    ɔ: [804, 1188, 2824],
    o: [555, 1036, 2828],
    ʊ: [519, 1229, 2829],
    u: [460, 1106, 2735],
    ɝ: [524, 1588, 1930],
  }),
  child: Object.freeze({
    f0: 237,
    i: [452, 3082, 3702],
    ɪ: [513, 2556, 3409],
    e: [565, 2649, 3323],
    ɛ: [740, 2279, 3297],
    æ: [718, 2497, 3289],
    ʌ: [738, 1538, 3126],
    ɑ: [992, 1689, 2937],
    ɔ: [836, 1303, 2951],
    o: [599, 1140, 3006],
    ʊ: [571, 1506, 3076],
    u: [493, 1404, 2992],
    ɝ: [586, 1721, 2154],
  }),
});
