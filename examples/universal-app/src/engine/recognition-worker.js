import { createRecognitionEngine } from '../../../../src/recognition/engine.js';
import { LANGUAGES } from '../../../../src/g2p/index.js';
import { createRecognizer } from '../../../../src/recognition/recognizer.js';
import { verifyFile } from './recognition-file.js';

let active;
const loading = createRecognitionEngine({ engine: 'auto', threads: 1 });
const languageCodes = Object.keys(LANGUAGES);
const send = (id, type, payload) =>
  globalThis.postMessage({ id, type, ...payload });

function fail(id, { message, code }) {
  active = null;
  send(id, 'error', { message, code });
}

function start(
  {
    id,
    sampleCount,
    sampleRate,
    languages,
    level,
    decoder,
    oov,
    whisper,
    modes,
    minVoiced,
    synthesisVoice,
  },
  kernels
) {
  // The recognition settings of the page (issue 170); undefined keeps each
  // default of createRecognizer.
  const options = {
    sampleRate,
    sampleCount,
    level,
    decoder,
    oov,
    whisper,
    modes,
    minVoiced,
    threads: 1,
    kernels,
    languages: languages?.map((language) =>
      languageCodes.find((code) => code === language)
    ),
  };
  const recognizer = createRecognizer(options);
  const emit = (type, payload) => send(id, type, payload);
  const file = verifyFile({ ...options, synthesisVoice }, emit);
  const report = file ? file.emit : emit;
  for (const type of ['syllable', 'partial', 'final']) {
    recognizer.on(type, (payload) => report(type, payload));
  }
  recognizer.on('error', (error) => fail(id, error));
  active = { id, recognizer, file };
}

async function receive(data) {
  const { id, type, samples } = data;
  try {
    if (type === 'start') {
      start(data, await loading);
    } else if (active && active.id === id) {
      if (type === 'chunk') {
        active.file?.push(samples);
        active.recognizer.push(samples);
        if (active) {
          send(id, 'chunk');
        }
      } else if (type === 'stop') {
        const { file, recognizer } = active;
        const result = file ? file.finish(recognizer) : recognizer.flush();
        active = null;
        send(id, 'result', { result });
      } else if (type === 'reset') {
        active = null;
      }
    }
  } catch (error) {
    fail(id, error);
  }
}

let messages = Promise.resolve();
globalThis.addEventListener('message', ({ data }) => {
  messages = messages.then(() => receive(data));
  return messages;
});
