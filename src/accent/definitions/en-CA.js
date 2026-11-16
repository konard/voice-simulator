/**
 * Canadian English: General American with the cot–caught merger (ɔ → ɑ)
 * and Canadian raising of aɪ and aʊ before a voiceless consonant
 * (`price about` ˈpɹʌɪs əˈbʌʊt).
 */
export default {
  format: 'voice-simulator/accent',
  version: 1,
  code: 'en-CA',
  name: 'Canadian English',
  language: 'en',
  base: 'en-US',
  g2p: {},
  rules: [
    { map: { ɔ: 'ɑ' } },
    { map: { aɪ: 'ʌɪ', aʊ: 'ʌʊ' }, before: 'voiceless' },
  ],
  phonotactics: null,
  prosody: { tunes: 'en', range: 1, rate: 1, stressLengthening: 1 },
  articulation: {},
};
