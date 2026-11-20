/** Extract and refit speaker parameters from timed phonemes. Unlicense. */
import {
  emptyState,
  addValue,
  statisticsResult,
} from '../analysis/voice-fit-statistics.js';
import { measureVoiceFit } from '../analysis/voice-fit.js';
import { channelTargets, planUtterance } from '../articulation/plan.js';
import { sampleState, tractShape } from '../articulation/tract-shape.js';
import { parseIpa } from '../ipa/parse.js';
import {
  renderedResponse,
  RESPONSE_GRID,
  responseFormants,
  tractResponse,
} from '../recognition/codebook-features.js';
import { inverseFilter } from '../recognition/inverse-filter.js';
import {
  OFFSET_CHANNELS,
  bound,
  halfway,
  jackknifeError,
  quantile,
  setParameter,
  vowelPitch,
} from './numerics.js';

export function usableReading({ segments }) {
  const phones = segments.filter(
    ({ kind, confidence }) => kind !== 'pause' && confidence >= 0.5
  );
  const vowels = new Set(
    phones
      .filter(({ kind }) => kind === 'vowel')
      .map(({ ipa }) => parseIpa(ipa).tokens[0]?.phoneme?.symbol)
      .filter(Boolean)
  );
  return phones.length >= 10 && vowels.size >= 3;
}

function applyStress(tokens, syllable, stress, stressed) {
  const vowel = tokens.find(({ kind }) => kind === 'vowel');
  if (stress && vowel && !stressed.has(syllable)) {
    vowel.stress = stress;
    stressed.add(syllable);
  }
}

function tokenPlan(segments, words, voice, settings) {
  const syllables = words.flatMap((word) => word.syllables);
  const stressed = new Set();
  const tokens = [];
  const indices = [];
  let word = 0;
  let syllable = 0;
  for (const segment of segments) {
    const middle = (segment.start + segment.end) / 2;
    while (words[word]?.end <= middle) {
      word++;
    }
    while (syllables[syllable]?.end <= middle) {
      syllable++;
    }
    const current = syllables[syllable];
    const stress =
      middle >= current?.start && current.stress >= 1 ? current.stress : 0;
    const parsed = parseIpa(segment.ipa || '|').tokens;
    applyStress(parsed, syllable, stress, stressed);
    for (const token of parsed) {
      token.word = word;
    }
    tokens.push(...parsed);
    indices.push({ segment, tokens: parsed, stress });
  }
  const plan = planUtterance(tokens, { ...voice, language: settings.language });
  const durations = new Map();
  for (const segment of plan.segments) {
    durations.set(
      segment.token,
      (durations.get(segment.token) ?? 0) + segment.duration
    );
  }
  for (const item of indices) {
    item.duration = item.tokens.reduce(
      (sum, token) => sum + (durations.get(token) ?? 0),
      0
    );
  }
  return indices;
}

function vowelReference(ipa, voice) {
  const plan = planUtterance(ipa, voice);
  const index = plan.segments.findIndex(({ kind }) => kind === 'vowel');
  const vowel = plan.segments[index];
  const state = sampleState(plan, (vowel.start + vowel.end) / 2);
  const response = new Float64Array(RESPONSE_GRID.length);
  if (state.velum >= 0.1) {
    renderedResponse(state, voice.head, response, RESPONSE_GRID);
  } else {
    const shape = tractShape(state, voice.head);
    tractResponse(shape.areas, shape.length, RESPONSE_GRID, response);
  }
  return {
    formants: responseFormants(response, new Float64Array(8)).subarray(0, 3),
    target: OFFSET_CHANNELS.map(
      (key) => channelTargets(plan.segments, key)[index].value
    ),
  };
}

function noteVowel(item, { center, from, to }, tracks, reference, source) {
  const { pitch, formants, articulation } = tracks;
  const f0 = [];
  const measured = [[], [], []];
  const measures = [];
  for (let row = from; row < to; row++) {
    if (pitch.f0[row] > 0) {
      f0.push(pitch.f0[row]);
      if (item.stress && source?.reliable[row]) {
        measures.push([pitch.f0[row], source.rd[row], source.cpp[row]]);
      }
    }
    for (let k = 0; k < 3; k++) {
      const index = row * 4 + k;
      if (formants.valid[index]) {
        measured[k].push(formants.frequency[index]);
      }
    }
  }
  const ratios = measured.map(
    (values, k) => reference.formants[k] / quantile(values)
  );
  const tractRatio = ratios.every(
    (value) => Number.isFinite(value) && value > 0
  )
    ? ratios.reduce((sum, value) => sum + value, 0) / 3
    : NaN;
  const position = OFFSET_CHANNELS.map((key, k) =>
    articulation.confidence[center] > 0
      ? articulation.channels[key][center] - reference.target[k]
      : NaN
  );
  return { f0, tractRatio, position, measures };
}

function middleRows(segment, frames) {
  const length = segment.end - segment.start;
  const row = (second) => (second - frames.startTime) / frames.hop;
  return {
    from: Math.max(0, Math.ceil(row(segment.start + length / 4))),
    to: Math.min(frames.count, Math.ceil(row(segment.end - length / 4))),
    center: Math.round(row((segment.start + segment.end) / 2)),
  };
}

function eligible({ kind, confidence, start, end }) {
  return kind !== 'pause' && confidence >= 0.6 && end - start >= 0.06;
}

export function* phoneObservations(reading, voice, settings) {
  const { decoded, words } = reading;
  const { frames, tracks, segments } = decoded;
  if (!tracks?.articulation || !segments.length) {
    return [];
  }
  const items = tokenPlan(segments, words, voice, settings);
  yield;
  const source = items.some(
    ({ stress, segment }) => stress && segment.kind === 'vowel'
  )
    ? inverseFilter(frames, { pitch: tracks.pitch })
    : null;
  yield;
  const references = new Map();
  const output = [];
  for (const item of items) {
    const { segment, duration, tokens } = item;
    if (!eligible(segment)) {
      continue;
    }
    const note = {
      durationRatio:
        duration > 0 ? duration / (segment.end - segment.start) : NaN,
      end: segment.end,
    };
    if (segment.kind === 'vowel') {
      const ipa = tokens.find(({ kind }) => kind === 'vowel')?.phoneme.symbol;
      const rows = middleRows(segment, frames);
      if (ipa && rows.from < rows.to) {
        if (!references.has(ipa)) {
          references.set(ipa, vowelReference(ipa, voice));
          yield;
        }
        Object.assign(
          note,
          noteVowel(item, rows, tracks, references.get(ipa), source),
          { ipa }
        );
      }
    }
    output.push(note);
    yield;
  }
  return output;
}

function pitchAndSource(head, tokens) {
  const { pitch, pitchRange } = vowelPitch(
    tokens.flatMap(({ f0 }) => f0 ?? [])
  );
  setParameter(head, 'pitch', pitch);
  setParameter(head, 'pitchRange', pitchRange);
  const state = emptyState();
  for (const token of tokens) {
    for (const [f0, rd, cpp] of token.measures ?? []) {
      addValue(state, 'f0', f0);
      addValue(state, 'rd', rd);
      addValue(state, 'cpp', cpp);
      state.voicedFrames++;
    }
  }
  if (state.voicedFrames >= 20) {
    const source = statisticsResult(state, { parts: ['source'] });
    for (const key of ['breathiness', 'tenseness']) {
      if (source.parameters[key].frames) {
        head[key] = source.head[key];
      }
    }
  }
}

export function refit(voice, tokens) {
  const head = { ...voice.head };
  const articulationOffsets = { ...voice.articulationOffsets };
  const ratios = (key) =>
    tokens.map((token) => token[key]).filter(Number.isFinite);
  setParameter(
    head,
    'vocalTractLength',
    head.vocalTractLength * quantile(ratios('tractRatio'))
  );
  setParameter(
    head,
    'speechRate',
    head.speechRate * quantile(ratios('durationRatio'))
  );
  pitchAndSource(head, tokens);
  const samples = new Map();
  for (const { ipa, position } of tokens) {
    if (position?.every(Number.isFinite)) {
      if (!samples.has(ipa)) {
        samples.set(ipa, []);
      }
      samples.get(ipa).push(position);
    }
  }
  for (const [ipa, readings] of samples) {
    if (readings.length >= 3) {
      const current = Object.hasOwn(articulationOffsets, ipa)
        ? articulationOffsets[ipa]
        : {};
      articulationOffsets[ipa] = Object.fromEntries(
        OFFSET_CHANNELS.map((key, k) => [
          key,
          bound(
            (current[key] ?? 0) +
              readings.reduce((sum, row) => sum + row[k], 0) / readings.length,
            -0.15,
            0.15
          ),
        ])
      );
    }
  }
  return { ...voice, head, articulationOffsets };
}

export function* uncertaintyFor(voice, tokens) {
  const folds = [];
  for (let fold = 0; fold < 4; fold++) {
    folds.push(
      refit(
        voice,
        tokens.filter((_, index) => index % 4 !== fold)
      ).head
    );
    yield;
  }
  return Object.fromEntries(
    Object.keys(voice.head).map((key) => [
      key,
      jackknifeError(folds.map((head) => head[key])),
    ])
  );
}

export function scoreVoice(voice, fit, snapshot, settings) {
  return measureVoiceFit(fit, snapshot, settings.sampleRate, voice.head, {
    engine: 'js',
    maxDuration: snapshot.length / settings.sampleRate,
    articulationOffsets: voice.articulationOffsets,
  });
}

export function* controlledRefit(voice, tokens, objective, limit, seed) {
  let candidate = seed ?? refit(voice, tokens);
  for (let attempt = 0; attempt <= 3; attempt++) {
    yield;
    const distance = objective(candidate);
    if (distance <= limit) {
      return { candidate, distance };
    }
    candidate = halfway(voice, candidate);
  }
  return { candidate: voice, distance: limit };
}
