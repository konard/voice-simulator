/** Compare an inverse-filtered LPC envelope with the full-speech envelope. Unlicense. */
import {
  analyzeFrames,
  articulationPlan,
  buildCodebook,
  GRID,
  invertArticulation,
  melCepstralDistortion,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  synthesize,
  trackFormants,
  trackPitch,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { normalizeEnvelope } from '../src/recognition/codebook-features.js';
import {
  block,
  filter,
  hann,
  highPass,
  integrate,
} from '../src/recognition/inverse-dsp.js';
import { lpcAutocorrelation, lpcLevel } from '../src/recognition/lpc.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const renderOptions = { solver: 'waveguide', engine: 'js', seed: 1 };

function predictor(samples, window, order) {
  const a = new Float64Array(order);
  const first = samples.length - window.length;
  const weighted = window.map((weight, n) => samples[first + n] * weight);
  lpcAutocorrelation(weighted, order, a, new Float64Array(order));
  return a;
}

// Use the final tract predictor of the IAIF pass in inverse-dsp.js. Keep
// filter history before the analysis window to limit integration transients.
function tractPredictor(s, window, tractOrder, sourceOrder) {
  const leak = 0.99;
  const u1 = filter(s, predictor(s, window, 1));
  const g1 = integrate(filter(s, predictor(u1, window, tractOrder)), leak);
  const u2 = integrate(filter(s, predictor(g1, window, sourceOrder)), leak);
  return predictor(u2, window, tractOrder);
}

function filteredBook(book, frames, pitch, blend) {
  const { rate, hop, speech, sampleCount, samples } = frames;
  const sourceOrder = 2 * Math.round(rate / 4000);
  const tractOrder = 2 * Math.round(rate / 2000) + 4;
  const history = Math.round(0.05 * rate);
  const windows = new Map();
  const input = highPass(samples.subarray(0, sampleCount), rate);
  let t = 0;
  return {
    ...book,
    query(original, k, out) {
      while (!speech[t]) {
        t++;
      }
      const center = Math.round(t * hop * rate);
      const f0 = pitch.f0[t++];
      if (!(f0 > 0)) {
        return book.query(original, k, out);
      }
      const length = Math.round(Math.max(0.032, 2.5 / f0) * rate);
      if (!windows.has(length)) {
        windows.set(length, hann(length));
      }
      const extended = block(
        input,
        center - Math.ceil(history / 2),
        length + history
      );
      const a = tractPredictor(
        extended,
        windows.get(length),
        tractOrder,
        sourceOrder
      );
      const envelope = normalizeEnvelope(
        GRID.map((frequency, i) =>
          Number.isFinite(original[i])
            ? lpcLevel(a, tractOrder, 1, frequency / book.lengthScale, rate)
            : NaN
        )
      );
      return book.query(
        envelope.map((level, i) => blend * level + (1 - blend) * original[i]),
        k,
        out
      );
    },
  };
}

function measure({ plan, samples }, sampleRate, voice, codebook, steady) {
  const frames = analyzeFrames(samples, sampleRate);
  const pitch = trackPitch(frames);
  const formants = trackFormants(frames, {
    pitch,
    vocalTractLength: voice.vocalTractLength,
  });
  const indices = steady
    ? plan.segments
        .filter(({ kind }) => kind === 'vowel')
        .map(({ start, end }) => Math.round((start + end) / (2 * frames.hop)))
    : Array.from({ length: frames.count }, (_, t) => t).filter(
        (t) => frames.speech[t] && frames.periodicity[t] >= 0.45
      );
  for (const blend of [0, 0.5, 1]) {
    const track = invertArticulation(frames, {
      voice,
      codebook: blend ? filteredBook(codebook, frames, pitch, blend) : codebook,
      formants,
      pitch,
    });
    let correct = 0;
    let height = 0;
    let backness = 0;
    for (const t of indices) {
      const state = sampleState(plan, t * frames.hop);
      const h = track.channels.height[t] - state.height;
      const b = track.channels.backness[t] - state.backness;
      correct += Number(Math.abs(h) <= 0.15 && Math.abs(b) <= 0.2);
      height += h * h;
      backness += b * b;
    }
    console.log({
      sampleRate,
      pitch: voice.pitch,
      blend,
      steady,
      correct,
      frames: indices.length,
      height: Math.sqrt(height / indices.length),
      backness: Math.sqrt(backness / indices.length),
      mcd: steady
        ? undefined
        : melCepstralDistortion(
            samples,
            renderPlan(articulationPlan(track), {
              ...renderOptions,
              sampleRate,
            }),
            sampleRate
          ),
    });
  }
}

const vowels = Object.keys(VOWELS);
for (const preset of ['male', 'female']) {
  const voice = presetHeadConfig(preset);
  const codebook = buildCodebook(voice, { size: 5000 });
  const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
    head: voice,
    durations: vowels.map(() => 0.3),
  });
  const samples = renderPlan(plan, { ...renderOptions, sampleRate: 16000 });
  measure({ plan, samples }, 16000, voice, codebook, true);
  if (preset === 'male') {
    for (const sampleRate of [16000, 8000]) {
      const audio = synthesize(LANDMARK_SENTENCES[0][1], {
        ...renderOptions,
        head: voice,
        sampleRate,
      });
      measure(audio, sampleRate, voice, codebook, false);
    }
  }
}
