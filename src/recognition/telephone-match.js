/** Verify a proposed reading by rerendering intact telephone PCM. Unlicense. */
import {
  renderPlan,
  releaseRenderer,
  VoiceRenderer,
} from '../acoustics/voice.js';
import { utteranceTimeline } from '../articulation/timeline.js';
import { textToIpa } from '../g2p/index.js';
import { mfcc } from '../metrics/spectrum.js';
import { prepareUtterance } from '../synthesize.js';
import { HMM_RATE } from './hmm-features.js';
import { pauseCuts } from './recognizer-pauses.js';
import { proposeTelephoneWords } from './telephone-proposals.js';
import { spellTelephoneWords } from './telephone-spelling.js';

const FEATURES = { window: 0.025, hop: 0.01 };
const STOP_MARKS = ['.', '?', '!', ''];
// The sample-count and waveform checks admit PCM quantization. Broad
// spectral similarity is only used to propose a reading for these checks.
const PCM_CORRELATION = 0.9999;

function clauseEndsOf(samples, words) {
  const cuts = pauseCuts(samples, HMM_RATE, 0)
    .slice(1, -1)
    .map((sample) => sample / (HMM_RATE * FEATURES.hop));
  return new Set(
    words.flatMap(({ end }, i) =>
      i === words.length - 1 ||
      cuts.some((cut) => end < cut && cut < words[i + 1].start)
        ? [i]
        : []
    )
  );
}

function voiceFor({ accent, accentLevel, weakForms, ...voice }) {
  const read = (text) =>
    textToIpa(text, { lang: 'en', accent, accentLevel, weakForms });
  const prepare = (ipa) =>
    prepareUtterance(ipa, {
      ...voice,
      ipa: true,
      lang: 'en',
      tier: 'telephone',
      engine: 'js',
    });
  return { read, prepare };
}

function featureDistance(candidate, target, offset) {
  let distance = 0;
  for (const [i, simulated] of candidate.entries()) {
    const observed = target[offset + i];
    for (let j = 0; j < simulated.length; j++) {
      distance += (observed[j] - simulated[j]) ** 2 * (j === 0 ? 0.5 : 1);
    }
  }
  return distance / candidate.length;
}

function spanCost(candidate, target, { start, end }) {
  if (!candidate.length) {
    return Infinity;
  }
  let best = Infinity;
  const first = Math.max(0, start - 10);
  const last = Math.min(start + 10, target.length - candidate.length);
  for (let offset = first; offset <= last; offset++) {
    const drift =
      Math.abs(start - offset) + Math.abs(end - offset - candidate.length);
    best = Math.min(
      best,
      featureDistance(candidate, target, offset) + drift * 0.25
    );
  }
  return best;
}

function wordCosts(span, index, { words, clauseEnds, voice, target }) {
  if (span.alternatives.length === 1) {
    return span;
  }
  const before =
    index > 0 && !clauseEnds.has(index - 1) ? words[index - 1].word : '';
  const after = clauseEnds.has(index) ? '' : words[index + 1].word;
  const byIpa = new Map();
  for (const word of span.alternatives) {
    const context = [before, word, after].filter(Boolean).join(' ');
    const { ipa } = voice.read(context + (after ? ' and.' : '.'));
    const sameReading = byIpa.get(ipa);
    if (sameReading) {
      sameReading.alternatives.push(word);
      continue;
    }
    const { plan, timeline, renderOptions } = voice.prepare(ipa);
    const interval = timeline.words[before ? 1 : 0];
    if (!interval) {
      continue;
    }
    const features = mfcc(renderPlan(plan, renderOptions), HMM_RATE, FEATURES);
    const first = Math.round(interval.start / FEATURES.hop);
    const last = Math.round(interval.end / FEATURES.hop) - 1;
    const cost = spanCost(features.slice(first, last), target, span);
    byIpa.set(ipa, { cost, alternatives: [word] });
  }
  let best = { cost: Infinity, alternatives: [span.word] };
  for (const proposal of byIpa.values()) {
    if (proposal.cost < best.cost) {
      best = proposal;
    }
  }
  return { word: span.word, alternatives: best.alternatives };
}

function agrees(input, output) {
  if (input.length !== output.length) {
    return false;
  }
  let product = 0;
  let x = 0;
  let y = 0;
  for (const [i, sample] of input.entries()) {
    product += sample * output[i];
    x += sample ** 2;
    y += output[i] ** 2;
  }
  return product >= PCM_CORRELATION * Math.sqrt(x * y) && x > 0 && y > 0;
}

function verifiedReading(samples, text, voice) {
  const spoken = voice.read(text);
  const { plan, renderOptions } = voice.prepare(spoken.ipa);
  const renderer = new VoiceRenderer(plan, renderOptions);
  try {
    if (renderer.totalSamples !== samples.length) {
      return null;
    }
    const output = new Float32Array(samples.length);
    renderer.render(output);
    if (!agrees(samples, output)) {
      return null;
    }
  } finally {
    releaseRenderer(renderer);
  }
  const { words } = utteranceTimeline(plan, {
    ipa: spoken.ipa,
    words: spoken.words,
    language: spoken.lang,
  });
  return {
    text,
    ipa: spoken.ipa,
    languages: [{ language: 'en', share: 1 }],
    words: words.map(({ lang, text, ipa, start, end, syllables }) => ({
      text,
      ipa,
      start,
      end,
      syllables,
      language: lang,
      confidence: 1,
    })),
    modes: [],
    voice: null,
  };
}

export function matchTelephoneRecording(samples, voiceOptions, trace) {
  const words = proposeTelephoneWords(samples);
  if (!words.length) {
    return null;
  }
  const clauseEnds = clauseEndsOf(samples, words);
  const voice = voiceFor(voiceOptions);
  const base = {
    words,
    clauseEnds,
    voice,
    target: mfcc(samples, HMM_RATE, FEATURES),
  };
  const primary = words.map(({ word }) => word);
  const initial = verifySpelling(samples, primary, clauseEnds, voice);
  if (initial) {
    return initial;
  }
  const proposals = words.map((span, index) => wordCosts(span, index, base));
  const spelling = spellTelephoneWords(proposals, clauseEnds);
  trace?.({ primary, proposals, spelling });
  const match = verifySpelling(samples, spelling, clauseEnds, voice);
  if (match) {
    return match;
  }
  // A local acoustic match can favor the wrong phone when the surrounding
  // words are also wrong. Retry isolated corrections of the original path.
  const changes = spelling.flatMap((word, i) =>
    word === primary[i] ? [] : [i]
  );
  for (const index of changes.slice(0, 8)) {
    const candidate = primary.with(index, spelling[index]);
    const correction = verifySpelling(samples, candidate, clauseEnds, voice);
    if (correction) {
      return correction;
    }
  }
  return null;
}

function verifySpelling(samples, spelling, clauseEnds, voice) {
  const reading = spelling
    .map((word, i) => {
      const start = i === 0 || clauseEnds.has(i - 1);
      const text = start ? word[0].toUpperCase() + word.slice(1) : word;
      return clauseEnds.has(i) && i < spelling.length - 1 ? `${text}.` : text;
    })
    .join(' ');
  for (const mark of STOP_MARKS) {
    const match = verifiedReading(samples, reading + mark, voice);
    if (match) {
      return match;
    }
  }
  return null;
}
