/**
 * Southern Mandarin: Taiwan Mandarin plus, with a strong accent, l for an
 * initial n (`南` lan˧˥).
 */
export default {
  format: 'voice-simulator/accent',
  version: 1,
  code: 'zh-x-south',
  name: 'Southern Mandarin',
  language: 'zh',
  base: 'zh-TW',
  g2p: {},
  rules: [{ map: { n: 'l' }, after: '#', min: 0.67 }],
  phonotactics: null,
  prosody: { tunes: 'zh', range: 1, rate: 1, stressLengthening: 1 },
  articulation: {},
};
