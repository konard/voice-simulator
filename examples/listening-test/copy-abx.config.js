/** ABX trials for public-domain golden recordings. Unlicense. */
globalThis.LISTENING_TEST_CONFIG = {
  id: 'copy-abx',
  title: 'Original and simulated speech',
  instructions:
    'Use headphones in a quiet room. Listen to A and B, then decide whether X matches A or B.',
  volume: 'stimuli/volume.wav',
  trials: [
    'en-01',
    'en-03',
    'en-04',
    'ru-01',
    'ru-02',
    'ru-05',
    'hi-01',
    'hi-02',
    'zh-01',
    'zh-02',
  ].map((id) => ({
    type: 'abx',
    id,
    a: `stimuli/original-${id}.wav`,
    b: `stimuli/copy-${id}.wav`,
  })),
};
