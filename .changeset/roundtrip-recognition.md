---
'voice-simulator': patch
---

Measure recognition of the simulator's own audio across four languages, nine
audio tiers and four voice presets. Report transcription accuracy, syllable
timing, prosody and speed, including whispered and loud speech.
Check periodicity when evaluating weak whisper evidence in telephone speech.
Keep confirmed telephone whispers together across an intervening aperiodic
speech run when the combined audio still has whisper evidence.
Keep confirmed narrowband whispers together across brief spurious pitch
detections while preserving sustained voiced interruptions.
Reduce cold-start work when building the reverse pronunciation dictionaries.
Rank isolated 16 kHz vowels against waveguide renders when a voice is supplied.
Verify short 16 kHz preset-voice recordings against waveguide renders when copying.
Recognise words by default with a Gaussian HMM over the lexicons of all four
languages (`decoder: 'words'`), trained only on the simulator's own speech.
Spell words outside the vocabulary with a per-language phone loop (`oov`,
on by default; `--no-oov` on the command line). The previous phone decoder
stays available as `decoder: 'phones'` (`--decoder phones`). The HMM state
scores and LDA projection also run in the Rust engine. A tone stream of
pitch-shape mixtures helps the word decoder tell Mandarin tones apart, and
pitches more than an octave from the median are ignored. Lexicon words
missing from the count corpora, such as "hello", back off as if seen three
times instead of once.
A Mandarin third tone read as rising by sandhi is accepted only before
another third tone (bú and yí only before a fourth), as it is spoken.
A Mandarin phrase is heard as a question from its pitch trend with the
lexical tones fitted out, so rising tones at the end of a statement no
longer turn it into a question; gaps from 0.15 s (a comma pause less the
word edges the decoder takes in) now separate phrases with a comma.
With a known voice, effort is measured against a neutral rendering of the
heard phones that keeps the recognised phrase marks and sentence tune
(`, … ↘ ?`) and keeps a Mandarin word whole, so a loud question in Hindi or
Mandarin is heard as `f`; `recognize()` passes a `trace` option on to the
mode stage. The round-trip mode check passes the speaking voice.
A whisper split by silent stop closures of up to 0.5 s, with no other speech
between its parts, is now heard as one whispered span (JavaScript and Rust).
