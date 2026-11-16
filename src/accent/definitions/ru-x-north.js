/**
 * Northern Russian (okanye): an unstressed о keeps its o, `хорошо говорит`
 * xoroˈʂo ɡovoˈrʲit. Which unstressed vowel was an о is a matter of
 * spelling, so this accent is a switch of the Russian g2p and has no IPA
 * rules (applyAccent and explainAccent cannot predict it from IPA alone).
 */
export default {
  format: 'voice-simulator/accent',
  version: 1,
  code: 'ru-x-north',
  name: 'Northern Russian (okanye)',
  language: 'ru',
  base: 'ru-RU',
  g2p: { okanye: true },
  rules: [],
  phonotactics: null,
  prosody: { tunes: 'ru', range: 1, rate: 1, stressLengthening: 1 },
  articulation: {},
};
