# Lexical and sentence prosody

Pass timed IPA sounds through `measureProsody` before word search and apply
`markProsody` to the decoded words:

```js
import {
  audioToIpa,
  ipaToText,
  markProsody,
  measureProsody,
} from 'voice-simulator';

const language = 'en';
const decoded = audioToIpa(samples, sampleRate, { language });
const options = { language };
const measured = measureProsody(samples, sampleRate, decoded.segments, {
  ...options,
  voice: decoded.voice,
});
const words = ipaToText(measured.sounds, options);
const result = markProsody(words, measured, options);
```

The measured vowels carry Mandarin tone costs and a prominence score. The
word search uses these to rank tones in Mandarin and primary stress in
English and Russian. The marked result adds punctuation, sentence capitals,
and timed emphasis and tune spans. Its IPA can be passed to
`synthesize(result.ipa, { ipa: true })`. Supply `options.voice` to use a
known speaker's head configuration as the pitch reference. Detected whispers
use vowel energy and relative duration for weak tone costs, and prominence
uses duration, level and spectral balance. Pass `options.whisperSpans` to
supply known spans or an empty list to disable detection. Other unvoiced
vowels carry `tones: null`. Whispered questions use question words, final
Mandarin `吗`, and initial Hindi `क्या`.
