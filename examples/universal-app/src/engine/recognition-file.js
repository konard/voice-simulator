import { resample } from '../../../../src/audio/resample.js';
import { decodeRecordedSimulation } from '../../../../src/recognition/decode.js';
import { matchableRecording } from '../../../../src/recognition/simulation-match.js';
import {
  decoderOptions,
  recognizeDecoded,
  recognitionSettings,
  RECOGNITION_LEVELS,
} from '../../../../src/recognition/recognizer.js';

/**
 * A short intact file can use the same verified synthesis model as the CLI.
 * Show provisional text as it arrives and defer irreversible events until the
 * model can verify the whole recording. Other inputs use the live events.
 */
export function verifyFile({ sampleCount, sampleRate, ...options }, send) {
  const settings = recognitionSettings(options);
  const level = settings.level === 'auto' ? 'medium' : settings.level;
  const rate = RECOGNITION_LEVELS[level].rate;
  if (
    !matchableRecording(
      sampleCount / sampleRate,
      sampleRate,
      rate,
      settings.languages
    )
  ) {
    return null;
  }

  const samples = new Float32Array(sampleCount);
  const pending = [];
  let count = 0;
  let committed = false;
  return {
    push(chunk) {
      samples.set(chunk, count);
      count += chunk.length;
    },
    emit(type, payload) {
      committed ||= type === 'final';
      if (type === 'partial' && !committed) {
        send(type, payload);
      } else {
        pending.push([type, payload]);
      }
    },
    finish(recognizer) {
      const fallback = recognizer.flush();
      const result = count === sampleCount ? verify() : null;
      if (result?.words.length) {
        send('final', result);
        let index = 0;
        for (const { syllables } of result.words) {
          for (const { start, end, ipa } of syllables) {
            send('syllable', { index: index++, start, end, ipa });
          }
        }
        return result;
      }
      for (const [type, payload] of pending) {
        send(type, payload);
      }
      return fallback;
    },
  };

  function verify() {
    const input = resample(samples, sampleRate, rate);
    const decoded = decodeRecordedSimulation(input, rate, {
      ...decoderOptions(settings, level),
      sourceRate: sampleRate,
    });
    return (
      decoded &&
      recognizeDecoded(decoded, input, rate, settings, level, 'batch')
    );
  }
}
