import { performance } from 'node:perf_hooks';
import { createSessionHost } from '../examples/universal-app/src/engine/session-worker.js';
import { loadVoice } from '../src/index.js';
import {
  COPY_RATE,
  copyFixture,
  female,
} from '../tests/helpers/copy-app-fixture.js';

const sampleRate = Number(process.argv[2] ?? COPY_RATE);
const seconds = Number(process.argv[3] ?? 8);
const level = process.argv[4] ?? 'low';
const paced = process.argv.includes('--paced');
const languages = process.argv.includes('--all') ? undefined : ['en'];
const samples = copyFixture(seconds, sampleRate);
console.log({
  sampleRate,
  pitch: female.pitch,
  length: female.vocalTractLength,
});
const start = performance.now();
let sent = 0;
const signature = ({
  type,
  state,
  reason,
  voicedSeconds,
  time,
  load,
  voice,
  ipa,
  words,
  samples,
  sampleRate,
  message,
}) => {
  switch (type) {
    case 'state':
      return { state, reason, voicedSeconds, time };
    case 'load':
      return { load };
    case 'voice': {
      const {
        head: { pitch, vocalTractLength },
      } = loadVoice(voice);
      return { pitch, vocalTractLength };
    }
    case 'final':
      return { ipa, span: words.at(-1)?.end - words[0]?.start };
    case 'audio':
      return { duration: samples.length / sampleRate };
    case 'error':
      return { message };
  }
};
const host = createSessionHost({
  post(event) {
    const data = signature(event);
    if (data) {
      console.log(
        ((performance.now() - start) / 1000).toFixed(3),
        (sent / sampleRate).toFixed(3),
        event.type,
        data
      );
    }
  },
});
await host.handle({ type: 'start', sampleRate, languages, level });
const stride = sampleRate / 50;
for (let from = 0; from < samples.length; from += stride) {
  sent = from + stride;
  await host.handle({ type: 'chunk', samples: samples.subarray(from, sent) });
  if (paced) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, start + (sent / sampleRate) * 1000 - performance.now())
      )
    );
  }
}
await host.handle({ type: 'stop' });
await host.handle({ type: 'repeat', id: 1, tier: 'minimal' });
