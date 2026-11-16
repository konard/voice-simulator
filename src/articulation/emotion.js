/**
 * Emotions and attitudes (issue 55): what `[angry]`, `[sad 0.5]`,
 * `<vs:emotion name="happy">` and `<vs:emotion arousal="0.5">` change in
 * the voice. The markup carries an emotion (`mode.emotion`, see
 * src/markup/modes.js); `emotionChanges()` turns it into a change of the
 * other mode fields, and the planner (src/articulation/modes.js,
 * `realiseEmotions()`) applies that change to every span as if it were an
 * outer span, so `[angry][soft]…[/soft][/angry]` stays soft.
 *
 * Every row of `EMOTIONS` gives the changes at intensity 1:
 *
 * - `pitch`: shift of the speaker's pitch in semitones;
 * - `range`: factor on the pitch movements of the tune;
 * - `rate`: speech rate factor (1.3 is 30 % faster);
 * - `effort`: vocal effort 0 … 1 (0.5 normal, issue 52), which changes
 *   level, spectral tilt and pitch (src/articulation/effort.js);
 * - `phonation`: degrees of the phonation types (issue 54), `tension`
 *   −1 (lax) … 1 (pressed);
 * - `pauses`: factor on every pause inside the span;
 * - `stressLength`: factor on the primary-stressed vowels;
 * - `glide`: a straight pitch movement in semitones per second inside each
 *   primary-stressed vowel, around the vowel's middle;
 * - `finalRise`: the same movement on the span's last vowel;
 * - `precision` p: the vowel targets move away from [ə] by 1 + 0.3 p
 *   (p > 0, hyperarticulation) or towards it by 1 + 0.2 p (p < 0);
 * - `smile` s: lip rounding −0.3 s and the lips drawn back by 1.2 s cm
 *   (`SMILE`), which raises the formants a little;
 * - `jitter`: extra jitter in percent, realised as harsh voice
 *   (`harsh = jitter / PHONATION_SOURCE.harshJitter`, so it also brings
 *   the shimmer and the breath noise of harsh voice);
 * - `arousal`, `valence`, `dominance`: the place of the emotion
 *   (−1 … 1), from Schröder et al. (2001) where `coordinates` says so;
 * - `source` and `verified`: rows from the acoustic profiles of
 *   Burkhardt and Sendlmeier (2000), whose synthesis listeners recognised,
 *   are verified; rows from Pell et al. (2009) and own choices are not.
 *
 * Sources:
 * - F. Burkhardt, W. F. Sendlmeier (2000). Verification of acoustical
 *   correlates of emotional speech using formant-synthesis. ISCA Workshop
 *   on Speech and Emotion, 151–156.
 * - M. D. Pell, S. Paulmann, C. Dara, A. Alasseri, S. A. Kotz (2009).
 *   Factors in the recognition of vocally expressed emotions: A comparison
 *   of four languages. Journal of Phonetics 37, 417–435.
 * - M. Schröder (2001). Emotional speech synthesis: a review.
 *   Eurospeech 2001, 561–564.
 * - M. Schröder, R. Cowie, E. Douglas-Cowie, M. Westerdijk, S. Gielen
 *   (2001). Acoustic correlates of emotion dimensions in view of speech
 *   synthesis. Eurospeech 2001, 87–90.
 *
 * Unlicense (public domain).
 */

/** A row of `EMOTIONS`: the neutral values plus `fields`. */
function preset(fields) {
  return Object.freeze({
    pitch: 0,
    range: 1,
    rate: 1,
    effort: 0.5,
    pauses: 1,
    precision: 0,
    smile: 0,
    glide: 0,
    finalRise: 0,
    stressLength: 1,
    jitter: 0,
    coordinates: 'own',
    ...fields,
    phonation: Object.freeze({ ...fields.phonation }),
  });
}

const BS = 'Burkhardt & Sendlmeier 2000';
const SCHROEDER = 'Schröder et al. 2001';

/**
 * The emotion presets at intensity 1. See the header of this file for the
 * fields; `docs/markup.md` has the same table.
 */
export const EMOTIONS = Object.freeze({
  neutral: preset({
    arousal: 0,
    valence: 0,
    dominance: 0,
    source: 'neutral',
    verified: true,
  }),
  angry: preset({
    pitch: 7,
    range: 3,
    rate: 1.3,
    effort: 0.75,
    phonation: { tension: 0.5 },
    glide: -30,
    precision: 1,
    arousal: 0.35,
    valence: -0.35,
    dominance: -0.34,
    coordinates: SCHROEDER,
    source: BS,
    verified: true,
  }),
  happy: preset({
    pitch: 7,
    range: 2,
    rate: 1.3,
    effort: 0.6,
    glide: 50,
    smile: 1,
    arousal: 0.29,
    valence: 0.4,
    dominance: 0.13,
    coordinates: SCHROEDER,
    source: BS,
    verified: true,
  }),
  sad: preset({
    pitch: -3.9,
    range: 0.8,
    rate: 0.6,
    effort: 0.35,
    phonation: { breathy: 0.5 },
    pauses: 1.5,
    arousal: -0.09,
    valence: -0.43,
    dominance: -0.55,
    coordinates: SCHROEDER,
    source: BS,
    verified: true,
  }),
  afraid: preset({
    pitch: 15.9,
    range: 1.2,
    rate: 1.3,
    effort: 0.5,
    phonation: { falsetto: 0.5 },
    finalRise: 30,
    jitter: 2,
    arousal: 0.31,
    valence: -0.27,
    dominance: -0.79,
    coordinates: SCHROEDER,
    source: BS,
    verified: true,
  }),
  bored: preset({
    pitch: -3.9,
    range: 0.5,
    rate: 0.8,
    effort: 0.4,
    phonation: { tension: -0.5 },
    stressLength: 1.4,
    precision: -1,
    arousal: -0.35,
    valence: -0.2,
    dominance: -0.1,
    source: BS,
    verified: true,
  }),
  surprised: preset({
    pitch: 8,
    range: 2.5,
    rate: 0.93,
    effort: 0.6,
    finalRise: 30,
    arousal: 0.4,
    valence: 0.15,
    dominance: -0.1,
    source: 'Pell et al. 2009, own',
    verified: false,
  }),
  disgusted: preset({
    pitch: 1,
    range: 1.3,
    rate: 0.67,
    effort: 0.5,
    phonation: { creaky: 0.3 },
    stressLength: 1.2,
    arousal: 0.15,
    valence: -0.4,
    dominance: 0.2,
    source: 'Pell et al. 2009, own',
    verified: false,
  }),
  tender: preset({
    pitch: -2,
    range: 0.8,
    rate: 0.85,
    effort: 0.3,
    phonation: { breathy: 0.4 },
    arousal: -0.2,
    valence: 0.4,
    dominance: -0.05,
    source: 'own',
    verified: false,
  }),
  sarcastic: preset({
    pitch: -2,
    range: 0.6,
    rate: 0.8,
    effort: 0.5,
    stressLength: 1.3,
    glide: -15,
    arousal: 0.05,
    valence: -0.25,
    dominance: 0.3,
    source: 'own',
    verified: false,
  }),
  confident: preset({
    pitch: -1,
    range: 1.2,
    rate: 1,
    effort: 0.6,
    phonation: { tension: 0.2 },
    pauses: 0.8,
    precision: 0.5,
    arousal: 0.1,
    valence: 0.25,
    dominance: 0.45,
    source: 'own',
    verified: false,
  }),
  hesitant: preset({
    // Own choice: +2 st, so that hesitant differs from neutral in pitch,
    // range and duration, not only in its pauses and its final rise
    // (tests/emotion.test.js, separation).
    pitch: 2,
    range: 0.8,
    rate: 0.85,
    effort: 0.4,
    pauses: 2,
    finalRise: 15,
    arousal: -0.1,
    valence: -0.1,
    dominance: -0.4,
    source: 'own',
    verified: false,
  }),
});

/** Limit of the glide and the final rise: ±3 semitones in total. */
export const GLIDE_LIMIT = 3;

/** Vowel spreading of `precision`: per unit above and below 0. */
export const PRECISION = Object.freeze({ up: 0.3, down: 0.2 });

/**
 * Lip changes of `smile` at 1: less rounding and lips drawn back by
 * `retraction` cm, which shortens the tract at the lips (tuned so that F2
 * of a stressed [a] rises by 5–10 %, see tests/emotion.test.js).
 */
export const SMILE = Object.freeze({ rounding: 0.3, retraction: 1.2 });

const round = (value) => Math.round(value * 1e6) / 1e6;

/** The changes of a row at intensity `i`. */
function scaledRow(row, i) {
  const phonation = {};
  for (const [name, degree] of Object.entries(row.phonation)) {
    phonation[name] = round(degree * i);
  }
  return {
    pitch: round(row.pitch * i),
    range: round(row.range ** i),
    rate: round(row.rate ** i),
    effort: round(0.5 + (row.effort - 0.5) * i),
    phonation,
    pauses: round(row.pauses ** i),
    precision: round(row.precision * i),
    smile: round(row.smile * i),
    glide: round(row.glide * i),
    finalRise: round(row.finalRise * i),
    stressLength: round(row.stressLength ** i),
    jitter: round(row.jitter * i),
  };
}

/**
 * The changes of a free place in arousal (A), valence (V) and dominance
 * (D), after the correlates of Schröder et al. (2001).
 */
function dimensionChanges(arousal, valence, dominance) {
  const phonation = {};
  if (dominance !== 0) {
    phonation.tension = round(0.4 * dominance);
  }
  if (dominance < 0) {
    phonation.breathy = round(-0.4 * dominance);
  }
  return {
    pitch: round(12 * Math.log2(1 + 0.32 * arousal) - 2 * dominance),
    range: round(Math.max(0.3, 1 + 1.15 * arousal)),
    rate: round(1 + 0.2 * arousal),
    effort: round(0.5 + 0.25 * arousal),
    phonation,
    pauses: round(1 - 0.3 * arousal),
    precision: 0,
    smile: round(Math.max(0, valence)),
    glide: round(30 * valence),
    finalRise: 0,
    stressLength: 1,
    jitter: 0,
  };
}

const unit = (value, low, high) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;

/**
 * What an emotion changes in the voice.
 *
 * A named preset uses its row of `EMOTIONS` at the intensity `i` (1 when
 * it is not given): semitones, degrees and slopes × i, factors f^i,
 * effort 0.5 + (e − 0.5)·i. The name `neutral` (or none) with a non-zero
 * arousal, valence or dominance uses the rules of the dimensions instead.
 * @param {string|{name?: string, intensity?: number, arousal?: number, valence?: number, dominance?: number}} [emotion]
 * @returns {{pitch: number, range: number, rate: number, effort: number, phonation: Record<string, number>, pauses: number, precision: number, smile: number, glide: number, finalRise: number, stressLength: number, jitter: number}}
 */
export function emotionChanges(emotion = {}) {
  const spec = typeof emotion === 'string' ? { name: emotion } : emotion;
  const name = spec.name ?? 'neutral';
  if (name !== 'neutral' && Object.hasOwn(EMOTIONS, name)) {
    return scaledRow(EMOTIONS[name], unit(spec.intensity ?? 1, 0, 1));
  }
  const arousal = unit(spec.arousal ?? 0, -1, 1);
  const valence = unit(spec.valence ?? 0, -1, 1);
  const dominance = unit(spec.dominance ?? 0, -1, 1);
  if (arousal === 0 && valence === 0 && dominance === 0) {
    return scaledRow(EMOTIONS.neutral, 0);
  }
  return dimensionChanges(arousal, valence, dominance);
}

/** Whether an emotion changes nothing (neutral at the origin). */
export function isNeutralEmotion(emotion) {
  if (!emotion) {
    return true;
  }
  const name = emotion.name ?? 'neutral';
  if (name !== 'neutral' && Object.hasOwn(EMOTIONS, name)) {
    return !(emotion.intensity > 0);
  }
  return !emotion.arousal && !emotion.valence && !emotion.dominance;
}
