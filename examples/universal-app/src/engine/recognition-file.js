import { resample } from '../../../../src/audio/resample.js';
import { decodeRecordedSimulation } from '../../../../src/recognition/decode.js';
import { HMM_RATE } from '../../../../src/recognition/hmm-features.js';
import { matchableRecording } from '../../../../src/recognition/simulation-match.js';
import {
  decoderOptions,
  recognize,
  recognizeDecoded,
  recognitionSettings,
  RECOGNITION_LEVELS,
  usesWordDecoder,
} from '../../../../src/recognition/recognizer.js';
import { matchTelephoneRecording } from '../../../../src/recognition/telephone-match.js';

// Bound the buffered PCM and the full-utterance HMM search in the worker.
const MAX_BATCH_SECONDS = 15;

/**
 * Show provisional text before the whole file is available. For telephone
 * files the batch word decoder can use context across live phrase boundaries.
 * Other short intact files can use the CLI's verified synthesis model.
 */
export function verifyFile(
  { sampleCount, sampleRate, synthesisVoice, ...options },
  send
) {
  const settings = recognitionSettings(options);
  const level = settings.level === 'auto' ? 'medium' : settings.level;
  const rate = RECOGNITION_LEVELS[level].rate;
  const seconds = sampleCount / sampleRate;
  const batch =
    sampleRate === HMM_RATE &&
    seconds >= 0.05 &&
    seconds <= MAX_BATCH_SECONDS &&
    usesWordDecoder(settings);
  if (
    !batch &&
    !matchableRecording(seconds, sampleRate, rate, settings.languages)
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
      const fallback = batch ? null : recognizer.flush();
      const result = count === sampleCount ? readCompleteFile() : null;
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
      const streamed = fallback ?? recognizer.flush();
      for (const [type, payload] of pending) {
        send(type, payload);
      }
      return streamed;
    },
  };

  function readCompleteFile() {
    if (batch) {
      const verified =
        synthesisVoice &&
        settings.languages.includes('en') &&
        !settings.minVoiced
          ? matchTelephoneRecording(samples, synthesisVoice)
          : null;
      return (
        verified ??
        recognize(samples, sampleRate, { ...options, unsplit: true })
      );
    }
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
