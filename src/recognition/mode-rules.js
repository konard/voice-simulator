/** Acoustic decision rules of issue 71. Units: Hz, dB, %, syllables/s.
 * Unlicense. See docs/RECOGNITION-MODES.md for definitions and limits. */
export const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
export const semitones = (pitch, base) =>
  pitch > 0 && base > 0 ? 12 * Math.log2(pitch / base) : 0;
export const degree = (x) =>
  [0.33, 0.67, 1][Math.min(2, Math.max(0, Math.round(x * 3) - 1))];

/** Inverse EFFORT_RULES. Missing F1 redistributes its weight to tilt/pitch. */
export function estimateEffort(word, baseline) {
  const tilt = (word.alpha - baseline.alpha) / 0.2;
  const pitch = (word.pitch - baseline.pitch) / 5;
  const E =
    word.f1 === null
      ? 0.75 * tilt + 0.25 * pitch
      : 0.6 * tilt + 0.2 * pitch + (0.2 * word.f1) / 3.5;
  return {
    E,
    effort: Math.round(clamp(0.5 + E / 40) * 4) / 4,
    confidence: clamp(1 - Math.abs(tilt - pitch) / 20),
  };
}

/** First matching row, followed independently by the tempo row. */
// The ordered acoustic decision table is kept together for auditing.
// eslint-disable-next-line complexity
export function classifyWord(word, base, knownVoice) {
  const dpitch = semitones(word.pitch, base.pitch);
  const dh1h2 = word.h1h2 - base.h1h2;
  const dhnr = word.hnr - base.hnr;
  const dcpp = word.cpp - base.cpp;
  const estimated = estimateEffort(word, base);
  // At positive effort the LF source's rising fundamental itself flattens
  // the spectrum. Keep the analytical estimate/confidence, but use the
  // independent 5 Hz/dB cue to disambiguate the two loud levels.
  if (
    knownVoice &&
    word.pitch - base.pitch >= 25 &&
    word.alpha > base.alpha + 1
  ) {
    estimated.effort =
      Math.round(clamp(0.5 + (word.pitch - base.pitch) / 200) * 4) / 4;
  }
  let quality = null;
  const set = (notation, key, value = 1) => ({
    notation:
      ['V̤', 'V̰'].includes(notation) && value !== 0.67
        ? `${value === 0.33 ? 1 : 3}${notation}`
        : notation,
    phonation: { [key]: value },
    confidence: 0.8,
  });
  if (
    word.voiced < 0.25 &&
    !word.pitch &&
    (word.energyRatio >= base.energyRatio + 1 ||
      (!knownVoice && word.alpha > -30))
  ) {
    quality = set('W', 'whisper');
  } else if (
    word.pitch > 0 &&
    (knownVoice ? dpitch <= -10.5 : word.pitch < 70)
  ) {
    quality = set('C', 'creaky');
  } else if (
    (dpitch >= 6 || (!knownVoice && word.pitch >= 150)) &&
    word.h1h2 >= 8 &&
    (dcpp <= -1 || (!knownVoice && word.cpp < 2))
  ) {
    quality = set('F', 'falsetto', 0.67);
  } else if (
    word.h1h2 < 0 &&
    dhnr <= -3 &&
    Math.abs(dpitch) < 4 &&
    (word.jitter >= 1 || dcpp <= -1)
  ) {
    quality = set('V!', 'harsh', 0.67);
  } else if (
    (word.jitter >= 3 && (word.h1h2 < 0 || dpitch <= -8)) ||
    (word.pitch > 0 && dpitch <= -6 && word.jitter >= 2)
  ) {
    quality = set(
      'V̰',
      'creaky',
      word.jitter > 0 ? degree(clamp(word.jitter / 7)) : 0.67
    );
  } else if (dh1h2 <= -3 && dhnr >= -2) {
    quality = set('V͈', 'tension', 0.67);
  } else if (dh1h2 >= 4 && (dcpp <= -1.5 || dhnr <= -5)) {
    quality = set('V̤', 'breathy', degree(clamp(dh1h2 / 3.2)));
  } else if (
    word.voiced > 0.05 &&
    ((word.hnr < 12 && dhnr <= -4) ||
      (Math.abs(dpitch) < 2 && Math.abs(dh1h2) < 3 && dcpp <= -1.4))
  ) {
    quality = set('Ṿ', 'whisper', 0.5);
  } else if (dh1h2 >= 3 && dh1h2 <= 8 && dhnr >= -2 && dcpp > -1) {
    quality = set('V͉', 'tension', -0.67);
  } else if (knownVoice && estimated.effort !== 0.5) {
    quality = {
      notation: ['pp', 'p', null, 'f', 'ff'][estimated.effort * 4],
      ...estimated,
    };
  }
  // With an utterance baseline a constant mode is unknowable. Only local
  // departures and the absolute signs above are meaningful.
  const ratio = base.rate > 0 ? word.rate / base.rate : 1;
  const tempo =
    ratio >= 1.2
      ? { notation: 'allegro', rate: 1.3, confidence: 0.8 }
      : ratio <= 0.83
        ? { notation: 'lento', rate: 0.75, confidence: 0.8 }
        : null;
  return { quality, tempo, ...estimated };
}

/** Six scaled components. pitchSpan is already expressed in semitones. */
export function emotionVector(word, base) {
  return [
    semitones(word.pitch, base.pitch) / 2,
    (word.pitchSpan - base.pitchSpan) / 2,
    (word.rate / Math.max(1e-9, base.rate) - 1) / 0.15,
    estimateEffort(word, base).E / 5,
    (word.h1h2 - base.h1h2) / 3,
    (word.hnr - base.hnr) / 3,
  ];
}
export const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

export function classifyEmotion(vector, references = []) {
  const arousal = clamp(
    vector.slice(0, 4).reduce((a, b) => a + b, 0) / 8,
    -1,
    1
  );
  const ranked = references
    .map(({ name, vector: ref }) => ({
      name,
      vector: ref,
      distance: distance(vector, ref),
    }))
    .sort((a, b) => a.distance - b.distance);
  const [near, next] = ranked;
  const length = Math.hypot(...vector);
  const emotion = Math.abs(arousal) >= 0.3 ? { arousal } : {};
  let confidence = Math.abs(arousal);
  if (
    near &&
    next &&
    near.name !== 'neutral' &&
    near.distance <= 0.6 * length &&
    near.distance <= 0.8 * next.distance
  ) {
    emotion.name = near.name;
    emotion.intensity = clamp(
      length / Math.max(1e-9, Math.hypot(...near.vector))
    );
    confidence = 1 - near.distance / next.distance;
  }
  return Object.keys(emotion).length
    ? { emotion, notation: null, confidence }
    : null;
}
