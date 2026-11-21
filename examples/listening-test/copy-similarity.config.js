/** Speaker-similarity trials using public-domain LibriVox readers. Unlicense. */
globalThis.LISTENING_TEST_CONFIG = {
  id: 'copy-similarity',
  title: 'Speaker similarity',
  instructions:
    'Use headphones in a quiet room. Compare the speaker of each sound with the reference speaker. Rate from 0 (different speaker) to 100 (same speaker), regardless of the words or audio quality.',
  volume: 'stimuli/volume.wav',
  trials: [
    ['en-03', 'en-04', 'en-01'],
    ['en-04', 'en-03', 'en-02'],
    ['ru-01', 'ru-02', 'ru-04'],
    ['ru-05', 'ru-06', 'ru-04'],
  ].map(([id, reference, anchor]) => ({
    type: 'mushra',
    id,
    text: 'Same speaker?',
    reference: `stimuli/original-${reference}.wav`,
    conditions: {
      reference: `stimuli/original-${reference}.wav`,
      copy: `stimuli/copy-${id}.wav`,
      default: `stimuli/default-${id}.wav`,
      anchor: `stimuli/original-${anchor}.wav`,
    },
  })),
};
