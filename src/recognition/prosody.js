/** Recover lexical prosody before word search and phrase prosody after it. */
import { analyzeFrames } from './frontend.js';
import { trackPitch } from './pitch.js';
import { findWhisper, whisperAt, whisperTones } from './whisper.js';
import { quantile } from './mode-features.js';
import {
  bestTone,
  mean,
  pitchAt,
  span,
  voicedBetween,
} from './prosody-features.js';
import { levelDb, averageSpectrum } from '../analysis/mode-features.js';
import { parseIpa } from '../ipa/parse.js';
import { DIPHTHONGS } from '../ipa/syllables.js';
import { TONE_CONTOURS } from '../g2p/pinyin.js';
import {
  toneCurve,
  sampleToneTargets,
  scaledToneIntervals,
} from '../articulation/tone-model.js';
export { markProsody } from './prosody-mark.js';

const LETTERS = '˩˨˧˦˥';
const TONES = Object.values(TONE_CONTOURS).map((letters) => [
  letters,
  Array.from(letters, (letter) => LETTERS.indexOf(letter) + 1),
]);
const PAUSE = 0.2;
function balanceDb(samples, rate, from, to) {
  const { power, binWidth } = averageSpectrum(samples, rate, from, to);
  const split = Math.min(power.length, Math.ceil(500 / binWidth));
  let high = 0;
  let low = 0;
  for (let i = 0; i < power.length; i++) {
    if (i < split) {
      low += power[i];
    } else {
      high += power[i];
    }
  }
  return 10 * Math.log10(Math.max(1e-20, high) / Math.max(1e-20, low));
}

// The aligned target spans a diphthong. Each vowel inside it still has
// its own observed frames, duration, and prominence.
function sharesTone(previous, token, gap, language) {
  return (
    previous &&
    !previous.tone?.length &&
    gap < 0.01 &&
    (language === 'zh' || DIPHTHONGS.has(previous.base + token.base))
  );
}

function collectNuclei(sounds, language) {
  const nuclei = [];
  let previousEnd = 0;
  let group = 0;
  let last;
  let previousVowel;
  for (const sound of sounds) {
    const token = parseIpa(sound.ipa).tokens[0];
    const kind = token?.kind;
    const pause = kind === 'pause' || sound.start - previousEnd >= PAUSE;
    if (pause && last) {
      last.syllableEnd = Math.min(
        last.syllableEnd,
        kind === 'pause' ? sound.start : previousEnd
      );
      last = undefined;
      group++;
    }
    if (kind === 'vowel') {
      const joins =
        last &&
        sharesTone(previousVowel, token, sound.start - previousEnd, language);
      if (joins) {
        last.parts.push(sound);
        last.end = sound.end;
      } else {
        if (last) {
          last.syllableEnd = sound.start;
        }
        last = {
          sound,
          parts: [sound],
          end: sound.end,
          syllableEnd: sound.end,
          group,
        };
        nuclei.push(last);
      }
    }
    previousVowel = kind === 'vowel' ? token : undefined;
    if (last) {
      last.syllableEnd = Math.max(last.syllableEnd, sound.end);
    }
    previousEnd = sound.end;
  }
  return nuclei;
}

function resamplePoints(frames) {
  return Array.from({ length: 10 }, (_, i) => {
    const at = (i * (frames.length - 1)) / 9;
    const low = Math.floor(at);
    return frames[low] + (frames[Math.ceil(at)] - frames[low]) * (at - low);
  });
}

function errorOf(observed, predicted) {
  return (
    Math.sqrt(
      mean(
        observed.map((value, i) => (0.5 + i / 9) * (value - predicted[i]) ** 2)
      )
    ) / 3
  );
}

function toneFit(pitch, start, end, nucleusStart, shift, scale) {
  const points = [];
  for (
    let i = Math.max(
      0,
      Math.ceil((nucleusStart - pitch.startTime) / pitch.hop)
    );
    i < pitch.count;
    i++
  ) {
    const time = pitchAt(pitch, i);
    if (time >= end) {
      break;
    }
    const value = pitch.semitones[i];
    if (value !== null) {
      points.push({ time: time - start, value });
    }
  }
  if (points.length < 3) {
    return null;
  }
  const observed = resamplePoints(points.map((point) => point.value));
  const times = resamplePoints(points.map((point) => point.time));
  const initial = voicedBetween(
    pitch,
    Math.max(0, start - 0.025),
    start + 0.005
  );
  const value = initial.length ? quantile(initial) : observed[0];
  const duration = end - start;
  return { observed, times, value, duration, shift, scale };
}

/** The two comparisons use the same target model and residual weights. */
export function toneCosts(frames, duration, scale, previous, reduced, fit) {
  if (frames.length < 3 || duration <= 0) {
    return null;
  }
  const observed = resamplePoints(frames);
  return Object.fromEntries(
    TONES.map(([letters, levels]) => {
      const curve = toneCurve(levels, {
        start: observed[0],
        scale,
        duration,
        count: 10,
        previous,
      });
      const raw = errorOf(observed, curve);
      let distance = raw;
      if (fit) {
        const intervals = scaledToneIntervals(
          levels,
          fit.duration,
          fit.scale,
          previous
        ).map((x) => ({
          ...x,
          from: x.from + fit.shift,
          to: x.to + fit.shift,
        }));
        const estimate = sampleToneTargets(
          intervals,
          { value: fit.value, velocity: 0, acceleration: 0 },
          fit.times
        );
        distance = 0.05 * raw + 0.95 * errorOf(fit.observed, estimate);
      }
      return [
        letters,
        Math.max(0, Math.min(1, distance) - (!letters && reduced ? 0.3 : 0)),
      ];
    })
  );
}

export function prominence(rows, whispered = []) {
  const result = new Float64Array(rows.length);
  [0.4, 0.2, 0.2, 0.2].forEach((weight, feature) => {
    const usable = (row, i) =>
      Number.isFinite(row[feature]) && !(feature === 3 && whispered[i]);
    const values = rows.filter(usable).map((row) => row[feature]);
    const centre = mean(values);
    const sd = Math.sqrt(mean(values.map((value) => (value - centre) ** 2)));
    if (sd > 1e-9) {
      rows.forEach((row, i) => {
        if (usable(row, i)) {
          result[i] += (weight * (row[feature] - centre)) / sd;
        }
      });
    }
  });
  return result.map((score, i) => (whispered[i] ? score / 0.8 : score));
}

function measureWhisperNucleus(
  nucleus,
  frames,
  meanDuration,
  measured,
  scores
) {
  const { parts, sound, syllableEnd } = nucleus;
  const tones = whisperTones(frames, {
    start: sound.start,
    vowelStart: sound.start,
    end: syllableEnd,
    meanDuration,
  });
  for (const part of parts) {
    measured.set(part, {
      ...part,
      whispered: true,
      tones,
      prominence: scores.get(part),
    });
  }
}

function measureNuclei(
  nuclei,
  { samples, sampleRate, pitch, range, voice, frames, whisperSpans }
) {
  const parts = nuclei.flatMap((nucleus) => nucleus.parts);
  const inWhisper = ({ start, end }) =>
    Boolean(whisperAt(whisperSpans, (start + end) / 2));
  const rows = parts.map(({ start, end }) => {
    const from = start * sampleRate;
    const to = end * sampleRate;
    const voiced = voicedBetween(pitch, start, end);
    return [
      end - start,
      levelDb(samples, from, to),
      balanceDb(samples, sampleRate, from, to),
      voiced.reduce((highest, value) => Math.max(highest, value), -Infinity),
    ];
  });
  const prominenceScores = prominence(rows, parts.map(inWhisper));
  const scores = new Map(parts.map((part, i) => [part, prominenceScores[i]]));
  const bounds = new Map();
  for (const { group, sound, end } of nuclei) {
    const first = bounds.get(group)?.[0] ?? sound.start;
    bounds.set(group, [first, end]);
  }
  const scale = Number.isFinite(voice?.pitchRange)
    ? 1.2 + 0.35 * voice.pitchRange
    : Math.max(1.7, Math.min(3.5, range / 4));
  let previous;
  const measured = new Map();
  const meanDuration = mean(
    nuclei.map(({ sound, syllableEnd }) => syllableEnd - sound.start)
  );
  nuclei.forEach((nucleus, i) => {
    const { parts, sound, end, syllableEnd, group } = nucleus;
    if (inWhisper(sound)) {
      measureWhisperNucleus(nucleus, frames, meanDuration, measured, scores);
      previous = undefined;
      return;
    }
    const before = nuclei[i - 1];
    const after = nuclei[i + 1];
    const duration = syllableEnd - sound.start;
    const beforeEnd = before?.group === group ? before.end : sound.start;
    const previousTone = before?.group === group ? previous : undefined;
    const [first, last] = bounds.get(group);
    const shift =
      (-(voice?.declination ?? 2) * (sound.start - first)) /
      Math.max(0.2, last - first);
    const reduced =
      before?.group === group &&
      after?.group === group &&
      duration <
        0.3 *
          (before.syllableEnd -
            before.sound.start +
            after.syllableEnd -
            after.sound.start);
    // The forward model begins moving during the onset and switches to the
    // next target at the end of the vowel. Align the same curve to its voiced
    // samples as a second comparison, so the next onset cannot dominate it.
    const fit = toneFit(pitch, beforeEnd, end, sound.start, shift, scale);
    for (const [j, part] of parts.entries()) {
      const partEnd = parts[j + 1]?.start ?? syllableEnd;
      const tones = toneCosts(
        voicedBetween(pitch, part.start, partEnd),
        partEnd - part.start,
        range / 4,
        previousTone,
        reduced,
        fit
      );
      measured.set(part, { ...part, tones, prominence: scores.get(part) });
    }
    previous = Array.from(
      bestTone(measured.get(parts.at(-1)).tones),
      (letter) => LETTERS.indexOf(letter) + 1
    );
  });
  return measured;
}

/** Analyze the vowel sounds of a timed IPA decoding. Times are in seconds. */
export function measureProsody(samples, sampleRate, sounds, options = {}) {
  let frames = options.frames;
  const analysis = () => (frames ??= analyzeFrames(samples, sampleRate));
  const track = options.pitch ?? trackPitch(analysis());
  const whisperSpans =
    options.whisperSpans ?? findWhisper(samples, sampleRate, analysis(), track);
  const voice = options.voice?.head ?? options.voice;
  const voicePitch = voice?.pitch;
  const median =
    voicePitch > 0 && Number.isFinite(voicePitch) ? voicePitch : track.median;
  const raw = Array.from(track.f0.subarray(0, track.count), (f0) =>
    f0 > 0 ? 12 * Math.log2(f0 / median) : null
  );
  // Octave errors occur at vowel onsets and offsets when the window also
  // contains frication or a closure. Exclude those rows from prosodic cues.
  const trackOffset =
    track.median > 0 ? 12 * Math.log2(track.median / median) : 0;
  const semitones = raw.map((value, i) =>
    value !== null &&
    Math.abs(value - trackOffset) <= 10 &&
    !whisperAt(whisperSpans, pitchAt(track, i))
      ? value
      : null
  );
  // Store linear energy per hop so intervals can be compared in decibels.
  const energy = Float64Array.from(semitones, (_, i) => {
    const from = Math.round(pitchAt(track, i) * sampleRate);
    const to = Math.round((pitchAt(track, i) + track.hop) * sampleRate);
    return 10 ** (levelDb(samples, from, to) / 10);
  });
  const pitch = { ...track, semitones, energy };
  const range = Math.max(4, span(semitones));
  const nuclei = collectNuclei(sounds, options.language);
  const scored = measureNuclei(nuclei, {
    samples,
    sampleRate,
    pitch,
    range,
    voice,
    frames: whisperSpans.length ? analysis() : frames,
    whisperSpans,
  });
  return {
    sounds: sounds.map((sound) => scored.get(sound) ?? sound),
    pitch,
    median,
    range,
    whisperSpans,
  };
}
