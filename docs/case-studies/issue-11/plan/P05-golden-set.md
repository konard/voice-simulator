---
id: P05
title: Golden set of public-domain recordings with transcripts and IPA
type: Feature
milestone: M0
blocked_by: [P04]
requirements: [R8, R13]
---

## Goal

Commit a very small set of real human recordings that every test can use
without the network: 6 short sentences for each of English, Russian, Hindi
and Mandarin (24 files, at most 2 000 000 bytes in total), each with its
text, its IPA, its source and its licence, in `tests/fixtures/golden/`.

## Why

The issue asks to compare the synthetic voice with real recordings and to
test recognition on real recordings. Large datasets are fetched ({{P04}}),
but a fetch can fail and is slow. A few committed recordings make the
baseline report ({{P07}}), the round-trip tests ({{P63}}) and the recognition
tests ({{P64}}) repeatable on every machine. Only public-domain or CC0 audio
may be committed, so that the repository stays under the Unlicense.

## Current state

- The repository has no recording of human speech and no tracked audio file.
- The package does not ship `tests/` (`files` in `package.json` is `bin/`,
  `src/`, `CHANGELOG.md`, `LICENSE`, `README.md`), so fixtures do not make
  the npm package larger.
- `src/audio/` can read and write FLAC and WAV (`decodeFlac`, `encodeFlac`,
  `decodeWav`) and change the sample rate (`resample`). There is no MP3
  decoder.
- `parseIpa(text)` returns `{tokens, unknown}`; `unknown` lists every symbol
  the project does not know.
- Sources named by `docs/case-studies/issue-11/research/3-datasets.md`
  (section "Proposed golden set"), all LibriVox, whose recordings are in the
  public domain in the USA:
  - English: Aesop's Fables volume 1, section 22 "The North Wind and The
    Sun", 81 s; text in Project Gutenberg ebook 11339.
  - Russian: "Aesop's fables in Russian" (archive.org item
    `aesops_fables_russian_0905_librivox`), sections of 63 to 95 s. The
    translator of the text is not confirmed.
  - Hindi: `dosakhiyan_2512_librivox` (Premchand), sections of 5 to 8 min.
  - Mandarin: `300_tang_poems_vol_1_librivox` or `di_zi_gui_0805_librivox`.
    It is not confirmed that the readers speak Mandarin.
- The same note says what must not be used: Common Voice clips (the download
  page forbids re-hosting), Wikipedia samples under CC BY-SA, and corpora
  that repackage LibriVox under CC BY 4.0.
- An automatic agent cannot listen. This issue therefore separates what a
  script can check from what a person must confirm.

## What to do

1. Sources. Use the LibriVox sections above, registered in
   `datasets/registry.json` ({{P04}} adds the English and the first Russian
   one; add the Hindi and Mandarin sections the same way, with
   `redistribution: true`). Before using a source, open its LibriVox
   catalogue page and its archive.org page and check: the page states public
   domain; the language is the one wanted (for Mandarin the catalogue
   language must be "Chinese" and the reader notes must not say Cantonese or
   another variety); the text was published before 1930 or its author and
   translator died before 1955. If a check fails, take the next section or
   the next source and write the reason in the pull request.
2. Convert on your own machine (not in CI): fetch the MP3 with
   `node scripts/datasets.mjs fetch <id>`, then
   `ffmpeg -i <file>.mp3 -ac 1 -ar 16000 -c:a pcm_s16le <file>.wav`.
   Write the `ffmpeg` version into the manifest field `tool`. Do not add
   `ffmpeg` or an MP3 decoder to the repository or to CI.
3. Create `scripts/golden.mjs` (Node.js built-ins and `src/audio/` only):
   - `pauses <file.wav> [--min 0.25]`: split the signal into frames of 10 ms,
     compute the RMS level of each in dB, take the level `L95` that 95 % of
     the frames are below, call a frame silent when it is more than 35 dB
     below `L95`, and print every run of silent frames of at least `--min`
     seconds as `start end` in seconds (3 decimals).
   - `cut --source <file.wav> --start <s> --end <s> --id <id>`: take the
     samples from `start` to `end`, apply a linear fade of 10 ms at both
     ends, scale so that the largest absolute sample is 0.708 (−3 dBFS),
     write `tests/fixtures/golden/<id>.flac` with
     `encodeFlac(samples, 16000, {bitDepth: 16})` and print the duration,
     the byte size and the SHA-256 of the file.
   - `verify`: run the checks of the test below and print one line per
     problem; exit with 1 if there is any.
     Export `findPauses(samples, sampleRate, options)` and
     `cutUtterance(samples, sampleRate, start, end)` for the tests.
4. Choose the cuts. For each language pick 6 sentences:
   - start after the LibriVox opening words ("This is a LibriVox recording
     ...") and stop before the closing words;
   - a cut begins in the middle of one pause listed by `pauses` and ends in
     the middle of a later one;
   - duration from 2.0 to 6.0 s; one whole sentence of 5 to 16 words (for
     Mandarin 6 to 24 characters);
   - no numbers written with digits, no abbreviations, no foreign names;
   - the six sentences together should contain as many different sounds of
     the language as possible; prefer a sentence that adds a new one.
     The pause list does not say which words lie between two pauses. Find it
     so: sentence `k` of the source text ends near the `k`-th pause longer
     than 0.5 s; then check with the rule of step 7.
5. Names: `en-01` ... `en-06`, `ru-01` ..., `hi-01` ..., `zh-01` ....
6. Write `tests/fixtures/golden/manifest.json`:

   ```json
   {
     "schema": 1,
     "tool": "ffmpeg 7.1",
     "utterances": [
       {
         "id": "en-01",
         "lang": "en",
         "file": "en-01.flac",
         "text": "The North Wind and the Sun had a quarrel.",
         "ipa": "ðə ˈnɔɹθ ˈwɪnd ...",
         "speaker": { "id": "librivox-<reader id>", "sex": "female" },
         "duration": 3.12,
         "sha256": "<printed by cut>",
         "source": {
           "dataset": "librivox-aesop-en-22",
           "page": "<LibriVox catalogue URL>",
           "licence": "Public-Domain",
           "start": 12.34,
           "end": 15.46
         },
         "textSource": "<URL or book of the printed text>",
         "review": { "text": "unreviewed", "ipa": "unreviewed", "by": null }
       }
     ]
   }
   ```

   `text` is what is said, with normal spelling and punctuation. `sex` is
   `female`, `male` or `unknown` (from the reader's catalogue page; do not
   guess from a name). The example text above is a placeholder; write what
   the recording says.

7. Plausibility rule for the text of each cut (in `verify` and the test):
   count the units of `text` (English and Russian: groups of vowel letters;
   Hindi: independent vowels plus consonants not followed by a virama;
   Mandarin: Han characters) and divide by `duration`. The rate must be from
   2.0 to 8.0 units per second. A cut outside this range has the wrong text
   or the wrong boundaries.
8. IPA. Write `ipa` by hand in the symbols this project uses (run
   `voice-simulator ipa "<text>" --lang <lang>` to see them), words
   separated by spaces, primary stress marked for English and Russian, tone
   letters for Mandarin. Do not copy the output of the project blindly: it
   is the thing under test. For each word check against a dictionary:
   English, the CMU Pronouncing Dictionary; Russian, the stress given by a
   printed dictionary or Wiktionary; Hindi, a dictionary that marks the
   deleted inherent vowel; Mandarin, the pinyin of a dictionary, with third
   tone sandhi written as it is spoken. List every word where your IPA
   differs from the output of the project in the pull request (these are
   bugs for later issues; for example the project reads "северный" with the
   stress on the last syllable and "wind" in "north wind" as /waɪnd/).
9. Human review. Add a table to the pull request with one row per file and
   two check boxes: "text matches the audio" and "IPA matches the audio". A
   person who knows the language listens and ticks; then set `review.text`
   and `review.ipa` to `confirmed` and `review.by` to the GitHub name. Other
   files stay `unreviewed`; reports mark them with `*`. An automatic agent
   must not set `confirmed`.
10. Add `tests/fixtures/golden/README.md`: the table of sources (title,
    reader, catalogue URL, licence statement of the LibriVox page), how the
    files were made (steps 2 to 4), and the sentence "These recordings are
    in the public domain in the USA; LibriVox says they may not be in other
    countries".
11. Add `tests/helpers/golden.js` with `loadGolden(options)` (`lang`,
    `reviewedOnly` default false). It returns a list of objects with `id`,
    `lang`, `text`, `ipa`, `speaker`, `samples`, `sampleRate`, `review`.

## Tests

Add `tests/golden-set.test.js`:

- `manifest is complete`: every field of step 6 is present; ids are unique
  and match `^(en|ru|hi|zh)-\d{2}$`; each language has 5 to 10 utterances.
- `files match the manifest`: every `file` exists, there is no other `.flac`
  in the folder, and the SHA-256 of each file equals `sha256`.
- `audio format`: `decodeFlac` gives `sampleRate` 16000, `channels` 1,
  `bitDepth` 16; the duration equals `duration` within 0.01 s and is from
  2.0 to 6.0 s; the peak is from 0.6 to 0.75; the first and last 5 ms have
  an RMS below 0.05.
- `size limit`: the sum of the file sizes is at most 2 000 000 bytes.
- `licences`: `source.licence` is `Public-Domain` or `CC0-1.0`, and
  `source.dataset` is an entry of `datasets/registry.json` with
  `redistribution: true`.
- `text is plausible`: the rule of step 7.
- `ipa is readable`: `parseIpa(ipa).unknown` is empty and the number of
  words in `ipa` equals the number of words in `text` (for Mandarin: the
  number of Han characters).
- `findPauses finds a gap`: a 1 s tone, 0.4 s of silence and a 1 s tone give
  one pause from about 1.0 to 1.4 s (within 0.02 s).
- `cutUtterance fades and scales`: the first and last samples are 0 and the
  peak is 0.708 within 0.001.

## Acceptance criteria

- [ ] `tests/fixtures/golden/` holds `manifest.json`, `README.md` and 24
      `.flac` files, 6 for each of `en`, `ru`, `hi`, `zh`.
- [ ] `du -cb tests/fixtures/golden/*.flac | tail -1` prints at most 2000000.
- [ ] `node scripts/golden.mjs verify` exits with 0.
- [ ] `npm run check:policy` passes, with every source in
      `datasets/registry.json` and no `null` checksum.
- [ ] The pull request has the review table of step 9 and the list of IPA
      differences of step 8; at least the English and the Russian files are
      `confirmed` by a person before the pull request is merged.
- [ ] The pull request names, for every source, the page with the
      public-domain statement and the day it was read.
- [ ] `npm pack --dry-run` does not list any file of `tests/fixtures/`.
- [ ] `npm run check` and `npm test` pass on Node.js, Bun and Deno; a patch
      changeset is added.

## Out of scope

- Single words, vowels and tone syllables (CC0 files of Lingua Libre and the
  Dresden Vocal Tract Dataset): {{P26}} and {{P58}} add what they need.
- Whisper, shout, emotions and song: no public-domain source was found.
- Phone-level time alignment of the recordings.
- Larger sets for statistics: fetched by {{P04}}, used by {{P64}}.

## References

- `docs/case-studies/issue-11/research/3-datasets.md`, sections "Proposed
  golden set" and "Items that could not be verified".
- LibriVox on public domain: <https://librivox.org/pages/public-domain/>.
- LibriVox catalogue interface: <https://librivox.org/api/info>.
- Aesop's Fables, ebook 11339: <https://www.gutenberg.org/etext/11339>.
- Russian Aesop: <https://librivox.org/aesops-fables-in-russian/>.
