/** Audio to words with acoustic whisper spans and lexical ambiguity. Unlicense. */
import { audioToIpa, createIpaDecoder } from './decode.js';
import { ipaToText } from './ipa-to-text.js';
import { whisperModeSpans, wrapWhisperIpa } from './whisper-result.js';

function wordsOf(audio, options) {
  const phones = audio.segments.map((sound) =>
    sound.kind === 'pause' ? { ...sound, ipa: '.' } : sound
  );
  const text = ipaToText(phones, options);
  const modes = whisperModeSpans(text.words, audio.whisperSpans ?? []);
  return { ...text, ipa: wrapWhisperIpa(text.words, modes, ' '), modes, audio };
}

export function recognize(samples, sampleRate, options = {}) {
  const settings = { ...options, language: options.language ?? 'en' };
  return wordsOf(audioToIpa(samples, sampleRate, settings), settings);
}

export function createRecognizer(sampleRate, options = {}) {
  const settings = { ...options, language: options.language ?? 'en' };
  const decoder = createIpaDecoder(sampleRate, settings);
  return {
    push: decoder.push,
    flush: decoder.flush,
    reset: decoder.reset,
    result: () => wordsOf(decoder.result(), settings),
  };
}
