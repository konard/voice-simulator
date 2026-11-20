/** Probe bounded three-word proposals with a known simulator head. Unlicense. */
import {
  analyzeFrames,
  findWhisper,
  ipaToText,
  resample,
  trackPitch,
} from '../src/index.js';
import { matchSimulation } from '../src/recognition/simulation-match.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

for (const text of process.argv.slice(2)) {
  const { samples, sampleRate, head } = renderWhisper(`[whisper] ${text}`);
  const rate = 16000;
  const recording = resample(samples, sampleRate, rate);
  const frames = analyzeFrames(recording, rate);
  const pitch = trackPitch(frames);
  const whisperSpans = findWhisper(recording, rate, frames, pitch);
  const match = matchSimulation(
    recording,
    rate,
    {
      languages: ['en'],
      voice: head,
      sourceRate: sampleRate,
      trace: (stage) => console.log(JSON.stringify(stage)),
      matchKnownVoice: true,
    },
    () => ({ frames, pitch, whisperSpans })
  );
  console.log(
    JSON.stringify({
      text,
      reading: match?.ipa,
      lexical: match && ipaToText(match.ipa, { language: 'en' }).text,
    })
  );
}
