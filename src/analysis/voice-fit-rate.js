/** Speech rate from speaking time when the words are known. Unlicense, issue 63. */
import { prepareUtterance } from '../synthesize.js';
import { HEAD_PARAMETERS } from '../head-config.js';
import { SPEECH_TIME } from './voice-fit-calibration.js';

/**
 * Seconds from the first to the last sound of the synthesizer's plan of
 * `text` at `speechRate` on the default head (leading and trailing pauses
 * excluded). Planning renders no audio.
 */
export function plannedSpeechTime(text, speechRate, options = {}) {
  const { plan } = prepareUtterance(text, {
    head: { speechRate },
    lang: options.language ?? options.lang,
    ipa: options.ipa,
    seed: 1,
  });
  const segments = plan.segments;
  let first = 0,
    last = segments.length - 1;
  while (first <= last && segments[first].kind === 'pause') {
    first++;
  }
  while (last >= first && segments[last].kind === 'pause') {
    last--;
  }
  return first > last ? 0 : segments[last].end - segments[first].start;
}

/**
 * The speechRate whose predicted speech seconds (SPEECH_TIME of the planned
 * time) equal the measured ones: with a transcript the recording and the
 * default head say the same syllables, so the ratio of syllable rates is
 * the ratio of speaking times. Bisection in log rate over the parameter
 * range; null when the text plans no sound.
 */
export function transcriptSpeechRate(speechSeconds, text, options = {}) {
  const { min, max } = HEAD_PARAMETERS.find((p) => p.key === 'speechRate');
  const predicted = (rate) =>
    SPEECH_TIME.slope * plannedSpeechTime(text, rate, options) +
    SPEECH_TIME.offset;
  if (!(speechSeconds > 0) || !(plannedSpeechTime(text, 1, options) > 0)) {
    return null;
  }
  let lo = Math.log(min),
    hi = Math.log(max);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (predicted(Math.exp(mid)) > speechSeconds) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.exp((lo + hi) / 2);
}
