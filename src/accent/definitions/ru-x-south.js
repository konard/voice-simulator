/**
 * Southern Russian: a fricative ɣ for г, devoiced to x at the end of a
 * word (`город снег друг его` ˈɣorət snʲex drux jɪˈvo). The g2p switch
 * `fricativeG` gives it from spelling; the rules give the same from
 * standard IPA (for applyAccent and explainAccent).
 */
export default {
  format: 'voice-simulator/accent',
  version: 1,
  code: 'ru-x-south',
  name: 'Southern Russian (fricative g)',
  language: 'ru',
  base: 'ru-RU',
  g2p: { fricativeG: true },
  rules: [
    { map: { ɡ: 'ɣ', ɡʲ: 'ɣʲ' } },
    { map: { ɣ: 'x', ɣʲ: 'xʲ' }, before: '#' },
  ],
  phonotactics: null,
  prosody: { tunes: 'ru', range: 1, rate: 1, stressLengthening: 1 },
  articulation: {},
};
