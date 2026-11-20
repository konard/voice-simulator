/** Audio to timed IPA through the simulator's own articulatory controls. Unlicense. */
import { fitVoice } from '../analysis/voice-fit.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { parseIpa } from '../ipa/parse.js';
import { syllabifyTokens } from '../ipa/syllables.js';
import { buildCodebook } from './codebook.js';
import { decoderLanguage, decoderTemplates } from './decode-model.js';
import { pathArcs } from './decode-search.js';
import { prepareDecode } from './decode-spans.js';
import { DECODE_WEIGHTS } from './decode-weights.js';
import { trackFormants } from './formants.js';
import { analyzeFrames, workingRate } from './frontend.js';
import { invertArticulation } from './inversion.js';
import { findLandmarks } from './landmarks.js';
import { trackPitch } from './pitch.js';

export function decoderSettings(sampleRate, options) {
  const { beam = 32, nbest = 1 } = options;
  if (
    !Number.isSafeInteger(beam) ||
    beam < 1 ||
    !Number.isSafeInteger(nbest) ||
    nbest < 1 ||
    nbest > 10
  ) {
    throw new RangeError(
      'Expected a positive integer beam and an nbest from 1 to 10'
    );
  }
  return {
    beam,
    nbest,
    weights: DECODE_WEIGHTS,
    rate: workingRate(
      sampleRate,
      options.rate === undefined
        ? null
        : workingRate(Math.min(sampleRate, options.rate))
    ),
    hop: options.hop ?? 0.005,
    language: decoderLanguage(options),
  };
}

const books = new Map();

export function decoderCodebook(voice) {
  const key = JSON.stringify(voice);
  if (!books.has(key)) {
    if (books.size >= 4) {
      books.delete(books.keys().next().value);
    }
    // Bound cold-start work. The tuning-sentence comparison in experiments/
    // issue-66-codebook-size.mjs measures this table against larger ones.
    books.set(key, buildCodebook(voice, { size: 256, cache: new Map() }));
  }
  return books.get(key);
}

export function analyzeForDecode(samples, sampleRate, options, settings) {
  const frames = analyzeFrames(samples, sampleRate, settings);
  const pitch = trackPitch(frames);
  const hasSpeech = frames.speech.subarray(0, frames.count).some(Boolean);
  const voice = options.voice
    ? normalizeHeadConfig(options.voice)
    : hasSpeech
      ? fitVoice(samples, sampleRate, {
          refine: false,
          language: settings.language.language,
        }).head
      : DEFAULT_HEAD;
  const formants = trackFormants(frames, {
    pitch,
    vocalTractLength: voice.vocalTractLength,
  });
  const landmarks = findLandmarks(frames);
  const articulation = invertArticulation(frames, {
    voice,
    pitch,
    formants,
    codebook: hasSpeech
      ? decoderCodebook(voice)
      : buildCodebook(voice, { size: 1 }),
  });
  return {
    frames,
    tracks: { pitch, formants, landmarks, articulation },
    voice,
  };
}

export function prepareIpaDecode(analysis, settings, bounds, templatesForTime) {
  const { frames, tracks, voice } = analysis;
  const templates = decoderTemplates(voice, settings.language.symbols);
  const prepared = prepareDecode(
    frames,
    tracks.landmarks,
    tracks.articulation,
    templates,
    bounds ?? {
      from: frames.startTime,
      to: frames.startTime + frames.sampleCount / frames.rate,
    },
    templatesForTime
  );
  return { templates, prepared };
}

export function segmentsOf(path, times, templates, language) {
  return pathArcs(path).map(
    ({ unit, from, to, pause, cost, confidence, long = false }) => {
      const start = times[from];
      const end = times[to];
      const template = templates[unit];
      return {
        ipa: pause
          ? ''
          : template.ipa + (long && language.long.has(template.ipa) ? 'ː' : ''),
        kind: pause ? 'pause' : template.kind,
        start,
        end,
        confidence,
        long,
        cost,
      };
    }
  );
}

function syllablesOf(segments, language) {
  const syllables = [];
  let first = 0;
  while (first < segments.length) {
    if (segments[first].kind === 'pause') {
      first++;
      continue;
    }
    let end = first + 1;
    while (end < segments.length && segments[end].kind !== 'pause') {
      end++;
    }
    const tokens = segments
      .slice(first, end)
      .map(({ ipa }) => parseIpa(ipa).tokens[0]);
    let start = first;
    for (const syllable of syllabifyTokens(tokens, { language })) {
      const afterLast = start + syllable.length;
      syllables.push({
        ipa: joinSegments(segments.slice(start, afterLast)),
        start: segments[start].start,
        end: segments[afterLast - 1].end,
        segments: [start, afterLast],
      });
      start = afterLast;
    }
    first = end;
  }
  return syllables;
}

export function joinSegments(segments) {
  return segments.map(({ ipa }) => ipa).join('');
}

export function latticeOf(times, edges, templates) {
  return {
    times,
    edges: edges.map(({ from, to, unit, pause, cost }) => ({
      from,
      to,
      ipa: pause ? '' : templates[unit].ipa,
      cost,
    })),
  };
}

export function resultOf(
  analysis,
  settings,
  prepared,
  templates,
  search,
  { prefix = [], lattice } = {}
) {
  const { times } = prepared;
  const { language } = settings;
  const prefixCost = prefix.reduce((sum, { cost }) => sum + cost, 0);
  const nbest = search.paths.map((path) => {
    const segments = prefix.concat(
      segmentsOf(path, times, templates, language)
    );
    return {
      ipa: joinSegments(segments),
      cost: prefixCost + path.cost,
      confidence: 0,
      segments,
    };
  });
  if (!nbest.length && prefix.length) {
    nbest.push({
      ipa: joinSegments(prefix),
      cost: prefixCost,
      confidence: 0,
      segments: prefix,
    });
  }
  const total = nbest.reduce(
    (sum, item) => sum + Math.exp(nbest[0].cost - item.cost),
    0
  );
  for (const item of nbest) {
    item.confidence = Math.exp(nbest[0].cost - item.cost) / total;
  }
  const { ipa = '', segments = [] } = nbest[0] ?? {};
  return {
    ipa,
    segments,
    syllables: syllablesOf(segments, language.language),
    nbest,
    lattice: lattice ?? latticeOf(times, search.edges, templates),
    ...analysis,
  };
}
