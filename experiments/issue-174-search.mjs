/** Compare the wider and low word searches on the same 8 kHz input. Unlicense. */
import { readFileSync } from 'node:fs';
import { cpuUsage } from 'node:process';
import { decodeAudio } from '../src/audio/formats.js';
import { resample } from '../src/audio/resample.js';
import { synthesize } from '../src/index.js';
import { HMM_LOW_MULTILINGUAL_SEARCH } from '../src/recognition/hmm-decode.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';

const rate = 8000;
const languages = ['en', 'ru', 'hi', 'zh'];
const warm = synthesize('Hello world.', { tier: 'telephone', seed: 1 });
const language = (decoded) => decoded.modelLanguage ?? null;
const text = (decoded) => decoded.words.map(({ text: word }) => word).join(' ');

hmmAudioToIpa(warm.samples, rate, {
  languages,
  search: HMM_LOW_MULTILINGUAL_SEARCH,
});
for (const file of ['synthetic', ...process.argv.slice(2)]) {
  const audio = file === 'synthetic' ? warm : decodeAudio(readFileSync(file));
  const samples = resample(audio.samples, audio.sampleRate, rate);
  const seconds = samples.length / rate;
  const searches = {};
  for (const [name, search] of [
    ['wide', undefined],
    ['low', HMM_LOW_MULTILINGUAL_SEARCH],
  ]) {
    const start = cpuUsage();
    const decoded = hmmAudioToIpa(samples, rate, { languages, search });
    const { user, system } = cpuUsage(start);
    searches[name] = {
      rtf: (user + system) / 1e6 / seconds,
      language: language(decoded),
      text: text(decoded),
      ipa: decoded.ipa,
    };
  }
  console.log(JSON.stringify({ file, seconds, ...searches }));
}
