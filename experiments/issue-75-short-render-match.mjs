/** Check whether render verification transfers to native 16 kHz audio. Unlicense. */
import { performance } from 'node:perf_hooks';
import {
  compareRecordings,
  copyRecording,
  errorRate,
  presetHeadConfig,
  renderScore,
  saveVoice,
  synthesize,
  toScore,
} from '../src/index.js';
import {
  decodeFrontEnd,
  decoderSettings,
} from '../src/recognition/decode-pipeline.js';
import { matchSimulation } from '../src/recognition/simulation-match.js';

const sampleRate = 16000;
const options = { language: 'en', rate: sampleRate };
const settings = decoderSettings(sampleRate, options);
const recordings = ['Hello world.', 'Pass me.', 'We see rain.'];
const voices = ['female', 'male'];
const engine = process.argv.includes('--rust') ? 'rust' : 'js';

function replay(samples, match, voice) {
  if (!match) {
    return null;
  }
  const render = { tier: 'minimal', sampleRate, seed: 1, engine };
  const model = synthesize(match.ipa, {
    ...render,
    lang: 'en',
    ipa: true,
    head: voice,
  });
  const score = toScore(
    model.plan,
    {
      languages: [{ language: 'en' }],
      words: model.timeline.words,
      modes: [],
    },
    saveVoice({ head: voice })
  );
  score.duration = samples.length / sampleRate;
  const output = renderScore(score, render);
  let error = 0;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    error += (samples[i] - output.samples[i]) ** 2;
    energy += samples[i] ** 2;
  }
  const cents = compareRecordings({ samples, sampleRate }, output, {
    formants: false,
  }).f0.rmseCents;
  let renderedCost;
  const confirmed = matchSimulation(
    output.samples,
    sampleRate,
    {
      languages: ['en'],
      voice,
      sourceRate: sampleRate,
      matchKnownVoice: true,
      trace({ stage, cost }) {
        if (stage === 'verification') {
          renderedCost = Math.min(renderedCost ?? Infinity, cost);
        }
      },
    },
    () => decodeFrontEnd(output.samples, sampleRate, settings)
  );
  return {
    cents,
    waveformError: error / energy,
    renderedCost,
    confirmed: confirmed?.ipa,
  };
}

for (const preset of voices) {
  const voice = presetHeadConfig(preset);
  for (const text of recordings) {
    const render = { tier: 'minimal', sampleRate, seed: 1, engine };
    const { samples, ipa } = synthesize(text, { ...render, head: voice });
    const start = performance.now();
    if (process.argv.includes('--copy')) {
      const { recognition, metrics, score } = copyRecording(
        samples,
        sampleRate,
        {
          ...render,
          languages: ['en'],
        }
      );
      console.log(
        JSON.stringify({
          preset,
          text,
          engine,
          heard: recognition.text,
          phoneError: errorRate(ipa, recognition.ipa, 'phone').rate,
          pitchCents: metrics.f0.rmseCents,
          timingMs: metrics.timingError,
          matchedPreset: score.voice.preset ?? null,
          seconds: (performance.now() - start) / 1000,
        })
      );
      continue;
    }
    let proposals = [];
    let lowestCost;
    const match = matchSimulation(
      samples,
      sampleRate,
      {
        languages: ['en'],
        voice,
        sourceRate: sampleRate,
        matchKnownVoice: true,
        trace(event) {
          if (event.stage === 'proposals') {
            proposals = event.proposals.map((item) => item.ipa + item.mark);
          } else if (!lowestCost || event.cost < lowestCost.cost) {
            lowestCost = { ipa: event.ipa, cost: event.cost };
          }
        },
      },
      () => decodeFrontEnd(samples, sampleRate, settings)
    );
    console.log(
      JSON.stringify({
        preset,
        text,
        ipa,
        matched: match?.ipa ?? null,
        proposals,
        lowestCost,
        replayCents: replay(samples, match, voice),
        seconds: (performance.now() - start) / 1000,
      })
    );
  }
}
