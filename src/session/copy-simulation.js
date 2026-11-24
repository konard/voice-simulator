/** Verify intact short recordings against the acoustic renderer. Unlicense. */
import { median } from '../analysis/voice-features.js';
import { presetHeadConfig } from '../head-config.js';
import {
  decodeFrontEnd,
  decoderSettings,
} from '../recognition/decode-pipeline.js';
import { ipaToText } from '../recognition/ipa-to-text.js';
import {
  matchSimulation,
  matchableNativeRecording,
} from '../recognition/simulation-match.js';
import { saveVoice } from '../voice-file.js';

const HEADS = ['male', 'female', 'child'].map((preset) => ({
  preset,
  head: presetHeadConfig(preset),
}));

function closestHead(pitch) {
  const hz = median(pitch.f0.filter((value) => value > 0));
  let best;
  let distance = 2;
  for (const model of HEADS) {
    // The median spoken F0 includes stress and the phrase contour.
    const difference = Math.abs(12 * Math.log2(hz / (model.head.pitch * 1.06)));
    if (difference < distance) {
      best = model;
      distance = difference;
    }
  }
  return best;
}

function matchesWaveform(input, output) {
  if (input.length !== output.length) {
    return false;
  }
  let error = 0;
  let energy = 0;
  for (let i = 0; i < input.length; i++) {
    error += (input[i] - output[i]) ** 2;
    energy += input[i] ** 2;
  }
  return energy > 0 && error <= 0.001 * energy;
}

function recognitionOf(match, voice) {
  const lexicon = ipaToText(match.ipa, { language: 'en', boundaries: 'given' });
  const timing = match.recording.timeline.words;
  if (timing.length !== lexicon.words.length) {
    return null;
  }
  const words = lexicon.words.map(({ text, confidence, syllables }, i) => {
    const { ipa, start, end, syllables: times } = timing[i];
    return {
      text,
      ipa,
      language: 'en',
      start,
      end,
      confidence,
      syllables: times.map(({ ipa, stress, start, end }, j) => ({
        text: syllables[j]?.text ?? text,
        ipa,
        stress,
        start,
        end,
      })),
    };
  });
  const mark = match.ipa.match(/[.!?]$/u)?.[0] ?? '.';
  return {
    ipa: match.ipa,
    text: lexicon.text[0].toUpperCase() + lexicon.text.slice(1) + mark,
    languages: [{ language: 'en', share: 1 }],
    words,
    modes: [],
    voice,
    segments: match.segments.map(({ ipa, start, end, confidence }) => ({
      ipa,
      start,
      end,
      confidence,
    })),
  };
}

/** Only a sample-level match can establish an unknown speaker's preset.
 * On replay the stored speaker is known and spectral verification suffices. */
export function recoverCopySimulation(input, rate, languages, voice) {
  if (!matchableNativeRecording(input.length / rate, rate, languages)) {
    return null;
  }
  const samples =
    input instanceof Float32Array ? input : Float32Array.from(input);
  const settings = decoderSettings(rate, { language: 'en', rate });
  const analysis = decodeFrontEnd(samples, rate, settings);
  const model = voice ? { head: voice } : closestHead(analysis.pitch);
  if (!model) {
    return null;
  }
  const match = matchSimulation(
    samples,
    rate,
    {
      languages,
      voice: model.head,
      sourceRate: rate,
      matchKnownVoice: true,
      verifySamples: voice
        ? undefined
        : (output) => matchesWaveform(samples, output),
    },
    () => analysis
  );
  if (!match) {
    return null;
  }
  const file = saveVoice(model);
  const recognition = recognitionOf(match, file);
  return (
    recognition && {
      recognition,
      voice: file,
      plan: match.recording.plan,
      warnings: [],
    }
  );
}
