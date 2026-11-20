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
known speaker's head configuration as the pitch reference. Unvoiced vowels
carry `tones: null`. Recognition of sentence type uses English, Russian,
Hindi, and Mandarin cues.
