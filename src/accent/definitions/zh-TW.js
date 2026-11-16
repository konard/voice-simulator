/**
 * Taiwan Mandarin: retroflexes merge with the dental sibilants (`是`
 * sɹ̩˥˩), no erhua (`一点儿` i˥˩ tjɛn˨˩, while `女儿` keeps its ɚ), a low
 * third tone (˨˩ without the rise) and with a strong accent in for iŋ. The
 * erhua and the third tone are g2p switches.
 */
export default {
  format: 'voice-simulator/accent',
  version: 1,
  code: 'zh-TW',
  name: 'Taiwan Mandarin',
  language: 'zh',
  base: 'zh-CN',
  g2p: { erhua: false, lowThird: true },
  rules: [
    { map: { ʂ: 's', ʈ͡ʂ: 't͡s', ʈ͡ʂʰ: 't͡sʰ' } },
    { map: { ɻ̩: 'ɹ̩' } },
    { map: { iŋ: 'in' }, min: 0.67 },
  ],
  phonotactics: null,
  prosody: { tunes: 'zh', range: 1, rate: 1, stressLengthening: 1 },
  articulation: {},
};
