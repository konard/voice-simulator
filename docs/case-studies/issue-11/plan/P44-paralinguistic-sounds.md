---
id: P44
title: 'Paralinguistic sounds: breaths, laughter, sighs and hesitations'
type: Feature
milestone: M3
blocked_by: [P38, P23]
requirements: [R17, R7, R18]
---

## Goal

Produce the sounds a speaker makes between words: breaths, laughter, sighs,
hesitation sounds (fillers), coughs, throat clearing and tongue clicks. They
are made by the same glottis and tract as speech, from rules; no recorded
samples. They are written `[laugh]` or `<vs:sound name="laugh"/>` in text
and `⸨laugh⸩` in IPA ({{P38}}), and recognition reports the same names.

## Why

Speech without breaths and hesitations sounds read by a machine. Laughter
and fillers are part of every conversation, so a recogniser that cannot
label them writes nonsense words instead.

## Current state

After {{P38}} a sound is parsed into `plan.sounds: [{ name, start, end }]`
and rendered as 0.3 s of silence. Written fillers are read as words, and one
is lost. Measured with `node experiments/issue-11-audit-m3b.mjs`:

```
filler en um: "ˈʌm"      filler en uh: "ˈʌ"      filler en haha: "ˈhæhæ"
filler ru э-э: "ɛ ɛ"     filler ru ха-ха: "xa xa"
filler zh 嗯: ""          filler zh 呃: "ɤ˥˩"      filler hi अं: "ə̃"
ipa ⸨cough⸩ ma: {"segments":7,"unknown":["⸨","⸩"]}
```

So `um` is a short stressed word, `э-э` is two words, `嗯` gives nothing at
all, and before {{P38}} `⸨cough⸩` in IPA is spoken as the word "cough".
`src/ipa/inventory.js` has no click letters. Pauses are silent: there is no
breath noise anywhere.

## What to do

1. Create `src/articulation/sounds.js` with the table `SOUNDS` and
   `soundSegments(sound, context)`. It returns ordinary plan segments
   (targets for the existing channels plus `whisper` of {{P41}} and `breath`
   and `creak` of {{P42}} when those exist; without them use `aspiration`
   and a low `f0`). `buildSegments()` in `src/articulation/plan.js` calls it
   where {{P38}} put the silence, and `plan.sounds` gets the real times.

   | Name     | Recipe                                                                              | Default length | Basis                    |
   | -------- | ----------------------------------------------------------------------------------- | -------------- | ------------------------ |
   | `inhale` | glottal noise of {{P23}} at an open glottis, no voicing, tract of `ə`, level rising | 0.4 s          | 0.3-0.7 s (proposal)     |
   | `exhale` | the same, level falling                                                             | 0.4 s          | own                      |
   | `sigh`   | `inhale` 0.4 s, then breathy `ɐ` with f0 falling 6 st and level falling 12 dB       | 0.4 + 0.7 s    | own (no verified source) |
   | `laugh`  | calls of `h` 0.1 s + `ə` 0.1 s (5 calls/s), 4 calls; see step 2                     | 0.8 s          | research notes           |
   | `filler` | a long steady vowel; see step 3                                                     | 0.35 s         | 0.25-0.5 s (proposal)    |
   | `cough`  | glottal closure 0.06 s, then a burst of glottal noise 0.15 s, tract of `ɐ`; 2 times | 0.45 s         | 1-3 pulses (proposal)    |
   | `throat` | `ʔ` + creaky `ə` 0.18 s, twice, the second with closed lips (`m`)                   | 0.4 s          | own                      |
   | `click`  | dental closure 0.04 s and a burst of {{P23}} without lung air, no voicing           | 0.06 s         | own                      |

   `duration="…"` of the markup stretches a sound; for `laugh` and `cough`
   it sets the number of calls (`round(duration / 0.2)` for `laugh`, 1 to
   12). The level of `inhale` and `exhale` is 30 dB below the vowels of the
   voice (own choice); `cough` is as loud as a vowel.

2. Laughter. Rules, with their basis in the research notes:
   - rhythm: about 5 calls per second, each a vowel of about 100 ms after
     about 100 ms of aspiration; 3 to 8 calls in a bout (proposal);
   - pitch: the first call is at `1.66 * head.pitch` (199 Hz for a male
     voice of 120 Hz; Szameitat et al. 2007 report 199 Hz for men and
     476 Hz for women), each later call 1 st lower (direction from the
     notes, size own);
   - level: each call 1.5 dB weaker than the one before (size own);
   - vowel: central `ə`, `breath` 0.5.

3. Fillers. Table `FILLERS` by language and form:

   | Name     | `en`  | `ru`  | `hi` | `zh` | Written in text (step 5)            |
   | -------- | ----- | ----- | ---- | ---- | ----------------------------------- |
   | `filler` | `əː`  | `ɛː`  | `əː` | `ɤː` | `uh`, `er`; `э-э`, `э`; `अ…`; `呃`  |
   | `um`     | `əːm` | `ɛːm` | `ə̃ː` | `ŋ̍ː` | `um`, `erm`; `эм`, `гм`; `अं`; `嗯` |

   `um` is a new sound name: add it to the list of {{P38}} (`[um]`,
   `<vs:sound name="um"/>`, `⸨um⸩`). Pitch: flat, 2 st below the pitch of
   the syllable before, falling 1 st (the notes say low and flat or slightly
   falling); no stress; no tone in Mandarin.

4. A sound obeys the mode of its span: inside `[whisper]` a laugh has no
   voicing; `[soft]`, `[high]` and a `rate` change its level, pitch and
   length the same way as speech.

5. Text. Add `FILLER_WORDS` to each verbalizer (`src/g2p/verbalize-*.js`)
   with the spellings of the table of step 3 and laughter spellings (two
   or more of `ha`, `he`, `ха`, `хе`, `हा`, `哈` in a row, with or without
   hyphens). `textToIpa()` writes `⸨filler⸩`, `⸨um⸩` or `⸨laugh:0.6⸩` for
   them (0.2 s per written syllable of a laugh) and keeps the written word
   in the timeline. This runs for plain text too, because it
   is a pronunciation, not markup. `嗯` no longer disappears.

6. Automatic breaths. New option `breaths` of `synthesize()` (`false` by
   default, CLI `--breaths`, server field `breaths`). With `true`, an
   `inhale` is put into every pause of 0.3 s or more that follows `.`, `?`,
   `!` or `‖`, except at the very start. Its length is
   `min(0.7, 0.3 + 0.03 * n)` s, where `n` is the number of syllables up to
   the next such pause (own rule inside the 0.3-0.7 s proposal); the pause
   is made longer if needed, and the breath ends 0.05 s before the next
   word.

7. IPA. `⸨name⸩` is read by {{P38}}. Add the form `⸨name:seconds⸩`
   (`⸨laugh:1.2⸩`) so that a `duration` is not lost in IPA. Add the click
   letters `ǀ` (dental), `ǃ` (alveolar), `ǁ` (lateral) and `ʘ` (bilabial) to
   `src/ipa/inventory.js` as consonants with `manner: 'click'`, produced
   like the `click` sound at their place. `formatIpa()` writes sounds back
   in the same form.

8. Timeline. `buildTimeline()` in `src/articulation/timeline.js` adds
   `timeline.sounds: [{ name, start, end }]`. A sound is not a word and not
   a syllable; words keep their own times.

How a sound is written and recognised. The label a recogniser outputs is
the same name, in `result.sounds` and as `⸨name⸩` in the IPA ({{P59}}):

| Sound    | Text, SSML                      | IPA        | What a detector can measure                    |
| -------- | ------------------------------- | ---------- | ---------------------------------------------- |
| `laugh`  | `[laugh]`, `haha`               | `⸨laugh⸩`  | level rhythm of 4-6 Hz for 3 or more cycles    |
| `filler` | `[filler]`, `[um]`, `uh`, `um`  | `⸨filler⸩` | steady central vowel > 0.2 s, flat low pitch   |
| `inhale` | `[inhale]`, `--breaths`         | `⸨inhale⸩` | noise ≥ 0.25 s inside a pause, no voicing      |
| `sigh`   | `[sigh]`                        | `⸨sigh⸩`   | inhale, then breathy fall of ≥ 4 st            |
| `cough`  | `[cough]`                       | `⸨cough⸩`  | level jump ≥ 20 dB in 20 ms, noise, no voicing |
| `throat` | `[throat]`                      | `⸨throat⸩` | two creaky voiced parts, f0 below 70 Hz        |
| `click`  | `[click]`, `<vs:sound name=…/>` | `ǀ`        | burst under 20 ms with silence on both sides   |

## Tests

Create `tests/paralinguistic.test.js` (tier `medium`, `seed: 1`,
`markup: true`). `voicedShare`, `levelDb` and `energyRatio` are the helpers
of `src/analysis/mode-features.js` ({{P40}}, {{P41}}); if the file does not
exist yet, create it with the ones needed here.

- `laughs in calls`: `Yes [laugh]` has one entry in `plan.sounds` of 0.8 ±
  0.1 s; its level curve (10 ms frames) has 4 peaks 0.2 ± 0.03 s apart;
  each peak is 0.5 to 3 dB below the one before; f0 of the first call is
  `1.66 * head.pitch` ± 10 %; f0 of the last call is lower.
- `laughs as long as asked`: `<vs:sound name="laugh" duration="1.2s"/>`
  gives 6 peaks.
- `breathes in without voice`: `[inhale] Yes` has a sound of 0.4 ± 0.05 s
  with `voicedShare` 0 and a level 20 to 40 dB below the vowel of `Yes`,
  and above -70 dB re full scale.
- `adds breaths between sentences`: `One. Two three four five six seven.`
  with `breaths: true` has exactly one `inhale` in `plan.sounds`, inside
  the pause; with `Two.` as the second sentence the breath is shorter;
  without the option the samples equal today's.
- `hesitates in four languages`: `[filler]` with `lang` `en`, `ru`, `hi`,
  `zh` is 0.35 ± 0.05 s, voiced, F1 changes by less than 10 % from its
  first to its last third, and f0 ends 0 to 2 st below its start.
- `reads written fillers`: `textToIpa('um')`, `('э-э', ru)`, `('嗯', zh)`,
  `('अं', hi)` give `⸨um⸩`, `⸨filler⸩`, `⸨um⸩`, `⸨um⸩`; the timeline has
  one word with the written text.
- `reads written laughter`: `textToIpa('hahaha')` gives `⸨laugh:0.6⸩` and
  3 level peaks; `textToIpa('ha')` is unchanged.
- `sighs`: breathy part ≥ 0.6 s, f0 falls 6 ± 1.5 st.
- `coughs`: two bursts; each rises by ≥ 20 dB within 20 ms; `voicedShare`
  below 0.1.
- `clears the throat`: two voiced parts with median f0 below 70 Hz.
- `clicks`: `[click]` and IPA `ǀ` give equal plans; the burst is shorter
  than 20 ms.
- `whispers a laugh`: `[whisper][laugh][/whisper]` has `voicedShare` below
  0.05.
- `is the same from text and IPA`: `[laugh]` and `⸨laugh⸩` give equal
  `plan.sounds` and channels.
- `keeps highlighting`: the words of `Yes [laugh] no` in the timeline are
  `Yes` and `no`; `timeline.sounds` has the laugh between them.

## Acceptance criteria

- [ ] All thresholds of `tests/paralinguistic.test.js` hold on Node.js, Bun
      and Deno.
- [ ] `node experiments/issue-11-audit-m3b.mjs` prints a filler for
      `filler zh 嗯` (today `""`).
- [ ] No audio file and no table of recorded samples is added:
      `git diff --stat main -- '*.wav' '*.bin'` is empty.
- [ ] Text without sounds, fillers or `breaths` gives the same samples as
      before.
- [ ] `docs/markup.md` has the tables of steps 1 and 3.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The turbulence and burst sources: {{P23}}.
- Recognising these sounds in audio: {{P59}}.
- Laughing while speaking words ("speech-laugh"), crying, yawning, sneezing.
- Deciding from the text where to hesitate or laugh.
- Measured values for sighs, breaths and coughs: none was found; the rows
  marked "own" are to be improved when a source is read.

## References

- Szameitat, D. P. et al. (2007). Formant characteristics of human
  laughter. Interdisciplinary Workshop on the Phonetics of Laughter,
  Saarbrücken.
- Bachorowski, J.-A., Smoski, M. J., Owren, M. J. (2001). The acoustic
  features of human laughter. JASA. (Known here from search snippets only.)
- extIPA symbols for disordered speech (double parentheses `⸨ ⸩` for
  sounds that are not speech).
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
