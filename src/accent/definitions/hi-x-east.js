/**
 * Eastern Hindi (Bihari, Bhojpuri): no z, f or ʃ of Persian loans
 * (`ज़रा फ़ोन शहर` d͡ʒəɾaː pʰoːn səɦəɾ), diphthongal ɛː and ɔː, and with a
 * strong accent b for an initial ʋ.
 */
export default {
  format: 'voice-simulator/accent',
  version: 1,
  code: 'hi-x-east',
  name: 'Eastern Hindi',
  language: 'hi',
  base: 'hi-IN',
  g2p: {},
  rules: [
    { map: { z: 'd͡ʒ', f: 'pʰ', ʃ: 's', ɛː: 'əɪ', ɔː: 'əʊ' } },
    { map: { ʋ: 'b' }, after: '#', min: 0.67 },
  ],
  phonotactics: null,
  prosody: { tunes: 'hi', range: 1, rate: 1, stressLengthening: 1 },
  articulation: {},
};
