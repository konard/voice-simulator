---
id: P63
title: 'Round-trip tests: text to audio to text in the heavy workflow'
type: Feature
milestone: M4
blocked_by: [P61, P02, P14]
requirements: [R6, R7, R11, R13, R18]
---

## Goal

A fixed list of 80 sentences (20 each for English, Russian, Hindi and
Mandarin) is spoken by the simulator and recognised by `recognize`. The suite
`roundtrip` of the heavy workflow measures how much of the text, the IPA, the
syllable times and the language comes back, per audio tier and per preset
voice, fails when a threshold is missed, and writes
`docs/reports/roundtrip.md`. Three sentences run in every `npm test`.

## Why

Recognition is the simulation in reverse, so the simulator's own speech is the
one input for which the right answer is known exactly: text, IPA and the time
of every syllable. This is the regression baseline for every later change of
the recogniser, and the proof that both directions work at 8000 Hz.

## Current state

- `synthesize(text, options)` returns an object with the keys `lang`,
  `accent`, `ipa`, `words`, `head`, `plan`, `timeline`, `sampleRate`,
  `samples` and `duration`. `timeline.words[].syllables[]`
  holds `ipa`, `stress`, `start`, `end` (seconds) and `text`.
- Measured on this branch: the three smoke sentences below take 0.11 to 0.27 s
  each to synthesise at tier `minimal` (22050 Hz, 1.9 to 2.3 s of audio).
- The 80 sentences were checked with the current text-to-IPA code. They give
  about 214 s of speech and contain 40 different phone symbols in English, 47
  in Russian, 50 in Hindi and 40 in Mandarin, all four Mandarin tones, the
  half-third tone and the neutral tone, and statements, yes/no questions,
  question-word questions, exclamations and one-word sentences in each
  language. There are no digits and no erhua (see {{P34}} and {{P31}}).
- `HEAD_PRESET_NAMES` is `['any', 'male', 'female', 'child']`. Tiers today:
  `minimal`, `low`, `medium` (waveguide), `high`, `ultra`, `studio`,
  `reference` (3D). {{P14}} adds `telephone`, `narrowband` and `wideband`.
- There is no recogniser, so no round-trip test exists: `ls tests/heavy` and
  `grep -rn roundtrip tests` find nothing.

## What to do

1. Create `tests/fixtures/roundtrip/sentences.json`: an object with the keys
   `en`, `ru`, `hi`, `zh`; each value is an array of 20 strings, in this
   order. In the lists below the sentences are separated by `|`; line breaks
   and the spaces around `|` are not part of a sentence.

   ```text
   en: The quick brown fox jumps over the lazy dog. | She sells sea shells by
   the sea shore. | Did you measure the treasure yesterday? | Why does the
   young judge enjoy choosing cheap toys? | What a beautiful morning! | Thick
   fog lay over the smooth path. | They usually think about their father and
   mother. | A large ship sailed around the island at noon. | Are the children
   playing outside now? | Please bring me a cup of hot tea, some bread and a
   book. | How far is the nearest hospital? | The singer was ringing a long
   bell. | I want to record a new record today. | Our tour of the pure air was
   sure to end. | Stop! | He could not hear the boy's voice clearly. | We will
   visit the zoo on Thursday. | Is this your pen or mine? | The photographer
   took a photograph of the banana tree. | Yes.

   ru: Съешь же ещё этих мягких французских булок, да выпей чаю. | Привет, как
   дела? | Сегодня хорошая погода. | Ты идёшь домой? | Какая красивая песня! |
   Мама мыла раму. | Щука живёт в глубокой реке. | Где находится ближайшая
   аптека? | Цыплёнок жил в цирке. | Мы купили хлеб, молоко и яблоки. | Это
   твоя книга или моя? | Зимой в лесу тихо и темно. | Объявление висит на
   двери подъезда. | Хитрый юный герой рисует шар. | Он не пришёл, потому что
   болел. | Стой! | Вчера я видел большую белую птицу. | Почему ты молчишь? |
   Фильм начинается в семь часов. | Да.

   hi: नमस्ते, आप कैसे हैं? | मेरा नाम राम है। | क्या तुम घर जा रहे हो? | आज मौसम बहुत
   अच्छा है। | वाह, कितना सुंदर फूल है! | बच्चे बाहर खेल रहे हैं। | मुझे एक गिलास ठंडा
   पानी चाहिए। | वह कल दिल्ली से आया था। | तुम्हारा भाई कहाँ रहता है? | घोड़ा तेज़
   दौड़ता है। | झंडा ऊँचा रहे हमारा। | छोटी चिड़िया पेड़ पर बैठी है। | ढोल की आवाज़
   दूर तक जाती है। | मैं पढ़ाई में व्यस्त नहीं हूँ, थोड़ा धीरे बोलिए। | फल, सब्ज़ी और
   दूध ले आओ। | यह किताब किसकी है? | रुको! | शाम को हम भोजन करेंगे। | ज्ञान सबसे
   बड़ा धन है। | हाँ।

   zh: 你好，你今天怎么样？ | 我是中国人。 | 他在北京工作吗？ | 今天天气很好。 |
   这本书真有意思！ | 妈妈骂马吗？ | 请给我一杯热茶。 | 我们明天去学校。 |
   你叫什么名字？ | 四是四，十是十。 | 小猫在桌子上睡觉。 | 火车站离这里远不远？ |
   我想吃米饭，香蕉和葡萄。 | 春天的花开了。 | 他说汉语说得很快。 |
   绿色的云飘过村庄。 | 请坐！ | 老师让学生写日记。 | 女儿喜欢听音乐。 | 对。
   ```

2. Create `tests/helpers/roundtrip.js` exporting `roundTrip(text, options)`
   with `options = { lang, tier, preset, seed }`. Steps:
   1. `spoken = synthesize(text, { lang, tier, preset, seed })`.
   2. `heard = recognize(spoken.samples, spoken.sampleRate, { level })`
      with `level = levelForTier(tier)`. Do not pass the language: it must
      be found.
   3. Return `{ spoken, heard, seconds }` plus these numbers, computed with
      `errorRate` and `editDistance` of {{P06}}:
      - `per`: `errorRate(spoken.ipa, heard.ipa, 'phone')`;
      - `wer` (not for `zh`) and `cer`: `errorRate(text, heard.text, unit)`
        with `'word'` and `'char'`;
      - `soundWer`: the same as `wer`, but each word of both texts is first
        replaced by its IPA from `textToIpa(...).words[].ipa`, so that a word
        which sounds the same (`sea` and `see`, 他 and 她) is not an error.
        For `zh` the tokens are the characters;
      - `toneErrors` (only `zh`): edit distance between the two lists of
        tones, one entry per syllable (the tone letters in the syllable's
        IPA, the empty string for the neutral tone);
      - `stressHits` (only `en`, `ru`): among the reference words with two or
        more syllables whose recognised word has the same number of
        syllables, how many have `stress: 1` on the same syllable;
      - `timeErrors`: pair the reference and recognised syllables through the
        edit-distance path over syllable IPA; for each pair with equal IPA
        collect `|start difference|` and `|end difference|` in ms;
      - `languageRight`: `heard.languages[0].language === lang` after sorting
        by `share`, largest first;
      - `sentenceMark`: the last of `. ? !` in `heard.text`, with `।`, `。`,
        `？`, `！` mapped to their ASCII form, or `null`.
3. Create `tests/heavy/roundtrip-sentences.test.js`. Seed 1 everywhere. Runs:
   - set `main`: all 80 sentences, tiers `telephone`, `narrowband`,
     `wideband`, `minimal`, presets `male` and `female` (640 runs);
   - set `voices`: sentences 1 to 5 of each language, presets `any` and
     `child`, tiers `telephone` and `wideband` (80 runs);
   - set `tiers`: sentences 2 and 20 of each language, preset `male`, tiers
     `low`, `medium`, `high`, `ultra`, `studio` (40 runs). `reference` is
     left out because of its run time; say so in the report.
   - `heavyLimit(80)` limits the number of sentences per set.
   - Sum the edit distances and the reference lengths per language, tier and
     set before dividing; do not average the rates of single sentences.
4. Gates (one `it` per row, so that a failure names the row). They hold for
   every language of set `main`:

   | Tier                  | PER    | soundWer | Tone errors | Syllable time, mean | Language right |
   | --------------------- | ------ | -------- | ----------- | ------------------- | -------------- |
   | `wideband`, `minimal` | ≤ 5 %  | ≤ 10 %   | ≤ 10 %      | ≤ 30 ms             | ≥ 95 %         |
   | `narrowband`          | ≤ 8 %  | ≤ 15 %   | ≤ 12 %      | ≤ 35 ms             | ≥ 92 %         |
   | `telephone`           | ≤ 10 % | ≤ 20 %   | ≤ 15 %      | ≤ 40 ms             | ≥ 90 %         |

   Set `voices`: the gates of row `telephone` for every preset. Set `tiers`:
   PER ≤ 10 % per tier. Stress hits ≥ 90 % (`en`, `ru`) from `narrowband` up.
   `wer`, `cer`, `sentenceMark` and the real-time factor of `recognize`
   (`seconds` divided by audio seconds) are reported without a gate; the
   sentence mark gets its gate in {{P58}}.

5. If the first full run misses a gate, do not loosen it. Read the report (it
   lists the 20 worst sentences with reference and recognised IPA), fix the
   stage that loses most, and run again. The gates are the result this issue
   must deliver.
6. Mode check, only when `parseMarkup` of {{P38}} is exported (else the test
   is skipped with the reason in its name): speak sentence 1 of each
   language once whispered and once loud with the markup of {{P38}}; report
   the share of mode spans that come back in `heard.modes` with the same
   notation and at least 50 % overlap in time. This issue sets no gate of
   its own for modes: the numbers belong to {{P58}} (sentence mark),
   {{P59}} (mode labels) and {{P60}} (set `whisper`). Each of them adds its
   gate to this test when this test exists. For each of the three that is
   merged already while its gate is missing here, add the gate in this
   issue with the numbers of that issue's acceptance criteria.
7. Write the report with `writeReport('roundtrip', markdown, data)`: one
   table per set (rows: language × tier; columns: the numbers above), then
   the 20 worst sentences. Copy the report of the full run to
   `docs/reports/roundtrip.md` and commit it with the run link, the commit
   hash and the date at the top.
8. Smoke test `tests/roundtrip-smoke.test.js` (part of `npm test`): sentence
   18 of `en`, 2 of `ru` and 2 of `zh`; tier `telephone`, preset `male`,
   seed 1. Expect `per.rate <= 0.1`, `soundWer.rate === 0` and
   `languageRight`.
9. Add the suite and the report to `tests/heavy/README.md` and to
   `docs/CONTRIBUTING.md` (section "Heavy checks").

## Tests

- `tests/roundtrip-smoke.test.js`: the three `it` blocks of step 8, named
  `round trip en`, `round trip ru`, `round trip zh`.
- `tests/roundtrip-helper.test.js` (fast, stub recogniser passed as
  `options.recognize`): `counts a homophone as right` (`sea` heard as `see`
  gives `wer.distance === 1` and `soundWer.distance === 0`); `counts tones`
  (one wrong tone letter gives `toneErrors.distance === 1`);
  `measures syllable times` (a result shifted by 20 ms gives a mean of 20 ms).
- `has 20 sentences per language`: `sentences.json` has four keys with 20
  non-empty strings each and no digit.
- `tests/heavy/roundtrip-sentences.test.js` as described above.

## Acceptance criteria

- [ ] `node --test tests/roundtrip-smoke.test.js` passes in less than 30 s on
      one core.
- [ ] `npm run test:heavy -- --suite roundtrip --limit 2` passes locally and
      writes `reports/heavy/roundtrip.md`.
- [ ] A run of `Heavy checks` with `suite=roundtrip` on the pull request
      branch is green: every gate of step 4 holds. The link is in the pull
      request description.
- [ ] `docs/reports/roundtrip.md` is committed and shows, for tier
      `telephone`, a row for each of the four languages.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Real recordings: {{P64}}.
- Deciding the gates for sentence marks, whispered speech, loudness, voice
  quality and emotion: {{P58}}, {{P59}}, {{P60}} decide the numbers; step 6
  only copies them.
- The certification of all features at the lowest settings: {{P69}}.
- New sentences. Changing the list changes every number; do it only in a
  separate issue.

## References

- Halle, M., Stevens, K. N. (1962). Speech recognition: a model and a program
  for research. IRE Transactions on Information Theory 8(2), 155-159.
- Research notes, section 7 (round trip and real speech are reported
  apart):
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
