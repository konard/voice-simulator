/*
 * Example configuration of the listening test (issue 20).
 *
 * `node scripts/listening-test.mjs build` writes config.js next to this
 * file; to write one by hand, copy this file to config.js and change it.
 * Paths are relative to index.html. config.js and stimuli/ are not
 * committed (see .gitignore).
 */
globalThis.LISTENING_TEST_CONFIG = {
  id: 'baseline-en',
  title: 'Voice quality test',
  instructions: 'Text shown before the first trial.',
  volume: 'stimuli/volume.wav',
  trials: [
    {
      type: 'mushra',
      id: 'en-01',
      text: 'Optional text of the sentence.',
      reference: 'stimuli/en-01/reference.wav',
      conditions: {
        reference: 'stimuli/en-01/reference.wav',
        anchor35: 'stimuli/en-01/anchor35.wav',
        anchor70: 'stimuli/en-01/anchor70.wav',
        studio: 'stimuli/en-01/studio.wav',
      },
    },
    {
      type: 'abx',
      id: 'abx-01',
      a: 'stimuli/abx-01/a.wav',
      b: 'stimuli/abx-01/b.wav',
    },
    {
      type: 'intelligibility',
      id: 'sus-01',
      audio: 'stimuli/sus-01/medium.wav',
      text: 'The reference words.',
      maxPlays: 2,
    },
    {
      type: 'choice',
      id: 'emotion-en-1-sad',
      audio: 'stimuli/emotion-en-1/sad.wav',
      choices: ['neutral', 'happy', 'sad', 'angry', 'afraid', 'bored'],
      answer: 'sad',
      lang: 'en',
      maxPlays: 2,
    },
  ],
};
