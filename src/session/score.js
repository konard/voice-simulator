/** Portable copy-synthesis scores and their renderer. Unlicense. */
import { phonationF0, pitchBeforePhonation } from '../acoustics/glottis.js';
import { renderPlan } from '../acoustics/voice.js';
import { interpolateGaps, planUtterance } from '../articulation/plan.js';
import { formatIpa, parseIpa } from '../ipa/parse.js';
import { DEFAULT_AUDIO_TIER } from '../perf/lod.js';
import { toPlanModes } from '../recognition/modes.js';
import { getAudioTier } from '../synthesize.js';
import { loadVoice } from '../voice-file.js';
import { groupPhones, sampleTrack, warpPlan } from './warp.js';

const FORMAT = 'voice-simulator/score';
export const REFINED_CHANNELS = ['height', 'backness', 'rounding'];
const isPhone = (token) => token.kind === 'vowel' || token.kind === 'consonant';

export function planRecording(ipa, language, voice, modes) {
  return planProsody(parseIpa(ipa).tokens, language, voice, modes);
}

function planProsody(tokens, language, voice, modes) {
  const { head, articulationOffsets } = loadVoice(voice);
  const plan = planUtterance(tokens, {
    head: { ...head, vibrato: 0 },
    language,
    articulationOffsets,
    modes: toPlanModes(modes.filter(({ from, to }) => from >= 0 && to > from)),
  });
  return { ...plan, modes };
}

export function toScore(plan, recognition, voice) {
  const { channels, frameRate: rate } = plan;
  return {
    format: FORMAT,
    version: 1,
    duration: plan.duration,
    voice,
    language: recognition.languages[0]?.language,
    ipa: formatIpa(plan.tokens),
    words: recognition.words,
    segments: groupPhones(plan.segments).map(({ token, start, end }) => ({
      ipa: formatIpa([token]),
      start,
      end,
    })),
    f0: {
      rate,
      values: Array.from(channels.f0, (hz, i) =>
        channels.voicing[i] > 0.05 && channels.whisper[i] < 1
          ? phonationF0(hz, channels.creak[i], channels.falsetto[i])
          : 0
      ),
    },
    loudness: { rate, values: Array.from(channels.loudness) },
    modes: recognition.modes,
  };
}

function editedTokens(score) {
  const original = parseIpa(score.ipa ?? '').tokens;
  if (original.filter(isPhone).length !== score.segments.length) {
    const tokens = [];
    const pause = parseIpa('a a').tokens[1];
    let wordIndex = 0;
    for (const segment of score.segments) {
      const previous = wordIndex;
      while (segment.start >= (score.words[wordIndex + 1]?.start ?? Infinity)) {
        wordIndex++;
      }
      if (tokens.length && wordIndex !== previous) {
        tokens.push({ ...pause });
      }
      tokens.push({ ...scorePhone(segment.ipa), word: wordIndex });
    }
    return tokens;
  }
  let i = 0;
  return original.map((token) => {
    if (!isPhone(token)) {
      return token;
    }
    const { ipa } = score.segments[i++];
    if (ipa === formatIpa([token])) {
      return token;
    }
    return { ...scorePhone(ipa), word: token.word };
  });
}

function scorePhone(ipa) {
  const { tokens, unknown } = parseIpa(ipa);
  if (unknown.length || tokens.length !== 1 || !isPhone(tokens[0])) {
    throw new TypeError(`Expected one IPA phoneme, got ${ipa}`);
  }
  return tokens[0];
}

function setTrack(plan, key, track) {
  if (
    !track ||
    !Number.isFinite(track.rate) ||
    track.rate <= 0 ||
    !Array.isArray(track.values) ||
    !track.values.length ||
    track.values.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new TypeError(`Invalid score channel ${key}`);
  }
  const values =
    key === 'f0'
      ? interpolateGaps(
          Float32Array.from(track.values, (hz) => hz || NaN),
          plan.head.pitch
        )
      : track.values;
  const { channels, frameRate } = plan;
  const channel = channels[key];
  for (let i = 0; i < channel.length; i++) {
    if (key === 'f0' && channels.whisper[i] >= 1) {
      continue;
    }
    const value = sampleTrack(values, (i * track.rate) / frameRate);
    channel[i] =
      key === 'f0'
        ? pitchBeforePhonation(value, channels.creak[i], channels.falsetto[i])
        : value;
  }
}

function checkScore(score) {
  if (
    score?.format !== FORMAT ||
    score.version !== 1 ||
    !Number.isFinite(score.duration) ||
    score.duration < 0 ||
    !Array.isArray(score.segments) ||
    !Array.isArray(score.words) ||
    !Array.isArray(score.modes)
  ) {
    throw new TypeError('Expected a version 1 voice-simulator score');
  }
  let previousStart = 0;
  for (const { ipa, start, end } of score.segments) {
    if (
      typeof ipa !== 'string' ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previousStart ||
      end <= start
    ) {
      throw new TypeError(
        'Score segments need IPA and ordered, positive times'
      );
    }
    previousStart = start;
  }
}

export function scorePlan(score) {
  checkScore(score);
  const base = planProsody(
    editedTokens(score),
    score.language,
    score.voice,
    score.modes
  );
  const plan = warpPlan(base, score.segments, {
    byIndex: true,
    clamp: false,
    duration: score.planDuration ?? score.duration,
  });
  setTrack(plan, 'f0', score.f0);
  setTrack(plan, 'loudness', score.loudness);
  for (const key of REFINED_CHANNELS) {
    if (score.articulation?.[key]) {
      setTrack(plan, key, score.articulation[key]);
    }
  }
  return plan;
}

export function scoreRenderSettings(defaults, options) {
  const tier = getAudioTier(
    options.tier ?? defaults?.tier ?? DEFAULT_AUDIO_TIER
  );
  return {
    ...tier,
    sampleRate: options.sampleRate ?? defaults?.sampleRate ?? tier.sampleRate,
    seed: options.seed ?? defaults?.seed ?? 1,
    engine: options.engine,
  };
}

export function renderScore(score, options = {}) {
  const plan = scorePlan(score);
  const settings = scoreRenderSettings(score.render, options);
  const { sampleRate } = settings;
  const draft = renderPlan(plan, settings);
  const samples = new Float32Array(Math.round(score.duration * sampleRate));
  samples.set(draft.subarray(0, samples.length));
  return { samples, sampleRate, duration: samples.length / sampleRate };
}
