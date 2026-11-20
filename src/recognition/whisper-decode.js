/** Segmental comparison against synthesized whisper spectra. Unlicense. */
import { parseIpa } from '../ipa/parse.js';
import { synthesize } from '../synthesize.js';
import { analyzeFrames } from './frontend.js';
import { whisperAt } from './whisper.js';
import { whisperRowAt, whisperSpectrum } from './whisper-spectrum.js';

const POINTS = [0.1, 0.3, 0.5, 0.7, 0.9];
export const WHISPER_WEIGHTS = { duration: 1.1, class: 0, phonotactic: 0.08 };
const tables = new Map();

function sampleTrajectory(spectrum, start, end, width, output) {
  for (let i = 0; i < POINTS.length; i++) {
    spectrum.sample(start + POINTS[i] * (end - start), output, i * width);
  }
  return output;
}

export function renderWhisperReference(ipa, settings, voice, [before, after]) {
  const { plan, samples, sampleRate } = synthesize(
    `{W ${before}${ipa}${after} W}`,
    {
      head: voice,
      ipa: true,
      tier: 'minimal',
      engine: 'js',
      seed: 1,
    }
  );
  const frames = analyzeFrames(samples, sampleRate, settings);
  const token = plan.tokens[parseIpa(before).tokens.length];
  const segments = plan.segments.filter((segment) => segment.token === token);
  const width = frames.melBands + 1;
  const start = segments[0].start;
  const end = segments.at(-1).end;
  return {
    duration: end - start,
    values: sampleTrajectory(
      whisperSpectrum(frames, 0, samples.length / sampleRate),
      start,
      end,
      width,
      new Float32Array(POINTS.length * width)
    ),
  };
}

export function whisperReferences(templates, settings, voice) {
  const key = JSON.stringify([
    voice,
    settings.rate,
    settings.hop,
    settings.vowelContexts,
  ]);
  if (!tables.has(key)) {
    if (tables.size >= 4) {
      tables.delete(tables.keys().next().value);
    }
    tables.set(key, new Map());
  }
  const table = tables.get(key);
  return templates.map(({ ipa, kind }) => {
    if (!table.has(ipa)) {
      const contexts =
        kind === 'vowel'
          ? (settings.vowelContexts ?? [
              ['m', 'm'],
              ['', 'p'],
              ['p', ''],
            ])
          : [
              ['a', 'a'],
              ['i', 'i'],
              ['u', 'u'],
            ];
      table.set(
        ipa,
        contexts.map((context) =>
          renderWhisperReference(ipa, settings, voice, context)
        )
      );
    }
    return table.get(ipa);
  });
}

export function whisperDistance(input, reference, width, vowel) {
  let sum = 0;
  for (let i = 0; i < input.length; i += width) {
    let spectral = 0;
    for (let j = 0; j < width - 1; j++) {
      const delta = input[i + j] - reference[i + j];
      spectral += delta * delta;
    }
    const level =
      (input[i + width - 1] - reference[i + width - 1]) / (vowel ? 20 : 13);
    sum += spectral / (width - 1) + level * level;
  }
  return sum / (input.length / width);
}

export function createWhisperScorer(frames, spans, templates, settings, voice) {
  const active = spans.filter(
    ({ start, end }) => whisperRowAt(frames, start) < whisperRowAt(frames, end)
  );
  if (!active.length) {
    return null;
  }
  const data = active.map(({ start, end }) =>
    whisperSpectrum(frames, start, end)
  );
  const table = whisperReferences(templates, settings, voice);
  const width = frames.melBands + 1;
  const input = new Float32Array(POINTS.length * width);
  return (start, end) => {
    const span = whisperAt(active, (start + end) / 2);
    if (!span) {
      return null;
    }
    sampleTrajectory(data[active.indexOf(span)], start, end, width, input);
    const duration = end - start;
    const terms = new Float64Array(templates.length * 3);
    const long = new Uint8Array(templates.length);
    for (let unit = 0; unit < templates.length; unit++) {
      let best = Infinity;
      let durationTerm = 0;
      for (const { values, duration: nominal } of table[unit]) {
        const ratio = duration / nominal;
        const timing = 2 * Math.log(ratio) ** 2;
        const acoustic =
          duration *
            8 *
            whisperDistance(
              input,
              values,
              width,
              templates[unit].kind === 'vowel'
            ) +
          0.85;
        const score = acoustic + WHISPER_WEIGHTS.duration * timing;
        if (score < best) {
          best = score;
          durationTerm = timing;
          long[unit] = Number(ratio > 1.6);
        }
      }
      terms[unit * 3] = best - WHISPER_WEIGHTS.duration * durationTerm;
      terms[unit * 3 + 1] = durationTerm;
    }
    return { terms, long, whisper: true };
  };
}
