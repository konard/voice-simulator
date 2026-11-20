/** Audio to timed IPA through the simulator's own articulatory controls. Unlicense. */
import { fitVoice } from '../analysis/voice-fit.js';
import { NoVoicedSpeechError } from '../analysis/voice-fit-statistics.js';
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
import { measure } from './profile.js';
import { trackPitch } from './pitch.js';
import {
  clipWhisperSpans,
  findWhisper,
  whisperAt,
  whisperTones,
} from './whisper.js';
import {
  whisperModeSpans,
  whisperVoicing,
  wrapWhisperIpa,
} from './whisper-result.js';
import { createWhisperScorer } from './whisper-decode.js';
import { whisperFormantFrames } from './whisper-spectrum.js';

export function decoderWhisperSpans(whisper) {
  if (whisper !== 'auto' && whisper !== false && !Array.isArray(whisper)) {
    throw new TypeError('whisper must be "auto", false, or a list of spans');
  }
  const spans = Array.isArray(whisper)
    ? whisper
        .map(({ start, end, confidence = 1 }) => {
          if (
            !Number.isFinite(start) ||
            start < 0 ||
            !Number.isFinite(end) ||
            end <= start ||
            !Number.isFinite(confidence) ||
            confidence < 0 ||
            confidence > 1
          ) {
            throw new RangeError('invalid whisper span');
          }
          return { start, end, confidence };
        })
        .sort((a, b) => a.start - b.start)
    : whisper;
  if (
    Array.isArray(spans) &&
    spans.some((span, i) => i > 0 && spans[i - 1].end > span.start)
  ) {
    throw new RangeError('whisper spans must not overlap');
  }
  return spans;
}

export function decoderSettings(sampleRate, options) {
  const { beam = 32, nbest = 1, whisper = 'auto' } = options;
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
    profile: options.profile,
    beam,
    nbest,
    whisper: decoderWhisperSpans(whisper),
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

export function fitDecoderVoice(
  samples,
  sampleRate,
  language,
  fallback,
  profile
) {
  try {
    return fitVoice(samples, sampleRate, { refine: false, language, profile })
      .head;
  } catch (error) {
    if (error instanceof NoVoicedSpeechError) {
      return fallback;
    }
    throw error;
  }
}

export function decodeFrontEnd(samples, sampleRate, settings) {
  const { profile } = settings;
  const frames = measure(profile, 'Front end', () =>
    analyzeFrames(samples, sampleRate, settings)
  );
  const pitch = measure(profile, 'Pitch', () => trackPitch(frames));
  const whisperSpans =
    settings.whisper === 'auto'
      ? findWhisper(samples, sampleRate, frames, pitch)
      : clipWhisperSpans(settings.whisper || [], samples.length / sampleRate);
  return { frames, pitch, whisperSpans };
}

export function analyzeForDecode(
  samples,
  sampleRate,
  options,
  settings,
  frontEnd = decodeFrontEnd(samples, sampleRate, settings)
) {
  const { frames, pitch, whisperSpans } = frontEnd;
  const hasSpeech = frames.speech.subarray(0, frames.count).some(Boolean);
  const voice = options.voice
    ? normalizeHeadConfig(options.voice)
    : hasSpeech
      ? fitDecoderVoice(
          samples,
          sampleRate,
          settings.language.language,
          DEFAULT_HEAD,
          settings.profile
        )
      : DEFAULT_HEAD;
  const spectralFrames = whisperFormantFrames(frames, whisperSpans);
  const { profile } = settings;
  const formants = measure(profile, 'Formants', () =>
    trackFormants(spectralFrames, {
      pitch,
      vocalTractLength: voice.vocalTractLength,
    })
  );
  const landmarks = measure(profile, 'Landmarks', () => findLandmarks(frames));
  const articulation = measure(profile, 'Inversion', () =>
    invertArticulation(spectralFrames, {
      voice,
      pitch,
      formants,
      codebook: hasSpeech
        ? decoderCodebook(voice)
        : buildCodebook(voice, { size: 1 }),
    })
  );
  return {
    frames,
    whisperSpans,
    tracks: { pitch, formants, landmarks, articulation },
    voice,
  };
}

export function prepareIpaDecode(analysis, settings, bounds, templatesForTime) {
  const { frames, tracks, voice } = analysis;
  const templates = decoderTemplates(voice, settings.language.symbols);
  const { whisperSpans = [] } = analysis;
  const whisperScore = createWhisperScorer(
    frames,
    whisperSpans,
    templates,
    settings,
    voice
  );
  const prepared = prepareDecode(
    frames,
    tracks.landmarks,
    tracks.articulation,
    templates,
    bounds ?? {
      from: frames.startTime,
      to: frames.startTime + frames.sampleCount / frames.rate,
    },
    { templatesForTime, whisperSpans, whisperScore }
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

export function syllablesOf(segments, language) {
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

function addWhisperTones(segments, syllables, spans, frames) {
  const meanDuration =
    syllables.reduce(
      (sum, syllable) => sum + syllable.end - syllable.start,
      0
    ) / syllables.length;
  for (const syllable of syllables) {
    const {
      start,
      end,
      segments: [from, to],
    } = syllable;
    const sounds = segments.slice(from, to);
    const first = sounds.findIndex(({ kind }) => kind === 'vowel');
    const vowel = first >= 0 ? sounds[first] : undefined;
    if (vowel && whisperAt(spans, (start + end) / 2)) {
      syllable.tones = whisperTones(frames, {
        start,
        end,
        vowelStart: vowel.start,
        meanDuration,
      });
      const carrier =
        from + sounds.findLastIndex(({ kind }) => kind === 'vowel');
      segments[carrier] = {
        ...segments[carrier],
        whispered: true,
        tones: syllable.tones,
      };
    }
  }
}

export function syllablesWithWhisper(segments, language, spans, frames) {
  const syllables = syllablesOf(segments, language);
  if (language === 'zh') {
    addWhisperTones(segments, syllables, spans, frames);
  }
  return syllables;
}

export function normalizeReadingConfidence(readings) {
  const minimum = Math.min(...readings.map(({ cost }) => cost));
  const total = readings.reduce(
    (sum, { cost }) => sum + Math.exp(minimum - cost),
    0
  );
  for (const item of readings) {
    item.confidence = Math.exp(minimum - item.cost) / total;
  }
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
  const spans = analysis.whisperSpans ?? [];
  const annotate = (segments) =>
    whisperVoicing(segments, analysis.frames, spans, prefix.length);
  const formatted = (segments) =>
    wrapWhisperIpa(segments, whisperModeSpans(segments, spans));
  const prefixCost = prefix.reduce((sum, { cost }) => sum + cost, 0);
  const nbest = search.paths.map((path) => {
    const segments = annotate(
      prefix.concat(segmentsOf(path, times, templates, language))
    );
    return {
      ipa: formatted(segments),
      cost: prefixCost + path.cost,
      confidence: 0,
      segments,
    };
  });
  if (!nbest.length && prefix.length) {
    nbest.push({
      ipa: formatted(prefix),
      cost: prefixCost,
      confidence: 0,
      segments: prefix.slice(),
    });
  }
  normalizeReadingConfidence(nbest);
  const { ipa = '', segments = [] } = nbest[0] ?? {};
  const syllables = syllablesWithWhisper(
    segments,
    language.language,
    spans,
    analysis.frames
  );
  return {
    ipa,
    segments,
    syllables,
    modes: whisperModeSpans(segments, spans),
    nbest,
    language: language.language,
    lattice: lattice ?? latticeOf(times, search.edges, templates),
    ...analysis,
  };
}
