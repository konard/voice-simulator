---
id: P33
title: Hindi yes/no questions that start with क्या get a falling contour
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

A Hindi question that starts with the particle क्या and can be answered with
yes or no (`क्या तुम आओगे?`, "Will you come?") must end with a rise, like the
same question without the particle. A question that asks "what", "where",
"who" and so on must end with a fall wherever the question word stands.

## Why

In Hindi the word क्या has two jobs. At the start of a sentence it only says
"this is a yes/no question". Inside the sentence it means "what". The two
kinds of question have opposite melodies. Today the melody is wrong in both
directions, so a listener hears a statement-like fall on the most common
polite question form, and sentence-type recognition ({{P58}}) would learn
the wrong pattern.

## Current state

Reproduce with `node experiments/issue-11-audit-m3a.mjs` (section 3). The two
numbers are the planned pitch in Hz 20 ms after the start and 20 ms before
the end of the last vowel:

```
hi क्या तुम आओगे?: "kjaː t̪ʊm aːoːɡeː ↘ ?"  108 -> 92    <- must rise
hi तुम आओगे?: "t̪ʊm aːoːɡeː ?"  116 -> 148             (correct rise)
hi क्या आप ठीक हैं?: "... ↘ ?"  107 -> 92             <- must rise
hi तुम क्या खाओगे?: "... ↘ ?"  107 -> 92              (correct fall)
hi आप कहाँ जा रहे हैं?: "... ↘ ?"  106 -> 91          (correct fall)
hi आप कल कहाँ जा रहे हैं?: "... ?"  113 -> 145        <- must fall
hi तुम्हारा नाम क्या है?: "... ?"  114 -> 145         <- must fall
```

Root cause 1: क्या is in the list of question words in
`src/g2p/verbalize-hi.js`:

```js
const WH_WORDS = new Set(
  'क्या कौन कहाँ कब क्यों कैसे कितना कितने कितनी किसका किसकी किसके'.split(' ')
);
```

Root cause 2: `markQuestions()` in `src/g2p/index.js` looks only at the first
two words of the sentence, for every language:

```js
const opening = sentence.slice(0, 2);
const wh = opening.some((word) =>
  VERBALIZERS[word.lang]?.isWhWord(word.text.toLowerCase())
);
if (wh) {
  item.ipa = '↘ ?';
}
```

That is right for English, where the question word comes first. Hindi keeps
the question word in the place of the answer, usually just before the verb,
so it is often the third word or later.

One more fact to respect: sentence-initial क्या is not always the particle.
`क्या हुआ?` ("What happened?") and `क्या बात है?` ("What is the matter?") are
"what" questions and already fall today. They must keep falling.

## What to do

1. In `src/g2p/index.js` replace the body of the `if (item.ipa === '?')`
   branch of `markQuestions()` by a call to a per-language hook:

   ```js
   const lang = sentence[0]?.lang;
   const texts = sentence.map((word) => word.text.toLowerCase());
   const fall = VERBALIZERS[lang]?.questionFalls
     ? VERBALIZERS[lang].questionFalls(texts)
     : texts.slice(0, 2).some((text) => VERBALIZERS[lang]?.isWhWord(text));
   ```

   Languages without `questionFalls` keep today's behaviour exactly.

2. In `src/g2p/verbalize-hi.js` remove क्या from `WH_WORDS` and add the forms
   that are missing: `किस किसे किसको किसने किन किधर कैसा कैसी कौनसा कौनसी`.
3. In the same file add two exported constants and one function:

   ```js
   /** Polar-question particle when it opens a sentence. */
   export const POLAR_PARTICLE = 'क्या';
   /** After sentence-initial क्या these words make it mean "what". */
   export const KYA_WHAT_NEXT = new Set([
     ...'है हैं था थी थे हुआ हुई हुए हो होगा होगी बात हाल'.split(' '),
     ...'मतलब चाहिए करूँ करें करना किया कहा कहूँ'.split(' '),
   ]);
   ```

   `questionFalls(words)` returns `true` (fall) or `false` (rise):
   1. If any word is in `WH_WORDS`: `true`;
   2. If क्या occurs at index 1 or later: `true` (it means "what");
   3. If the first word is क्या and the sentence has only two words, or the
      second word is in `KYA_WHAT_NEXT`: `true`;
   4. If the first word is क्या: `false` (polar question);
   5. Otherwise `false`.

   Add `questionFalls` to the exported verbalizer object next to `isWhWord`.
   Keep `isWhWord` and make it return `true` for क्या too, because other
   code may ask "is this a question word".

4. Do not add a way to override the rule in plain text here. Today a `↗`
   typed before the `?` is dropped by the normaliser (`तुम आओगे ↗?` gives
   `t̪ʊm aːoːɡeː ?`); the override belongs to the markup of {{P38}}. In IPA
   input the user can already write `↗` or `↘` directly.
5. Update the comment above `markQuestions()`: it now says that each language
   decides, and that Hindi question words stay in place.
6. Document the known limit in the comment of `questionFalls`: a two-word
   question such as `क्या आओगे?` ("Will you come?", subject left out) is
   read as a "what" question. Until {{P38}} the only way around it is IPA
   input.

Do not change the pitch contours themselves (`CONTOURS` in
`src/articulation/prosody.js`); only the choice between rise and fall.

## Tests

Add to `tests/text-to-ipa.test.js` a `describe('Hindi questions', ...)` block
that checks the IPA of `textToIpa(text, { lang: 'hi' })`:

- `rises on polar questions with the particle`: `क्या तुम आओगे?`,
  `क्या आप ठीक हैं?`, `क्या यह आपकी किताब है?` and `क्या वह घर पर है?` do
  not contain `↘`.
- `falls when क्या means what`: `तुम क्या खाओगे?`, `यह क्या है?`,
  `तुम्हारा नाम क्या है?`, `क्या हुआ?` and `क्या बात है?` end in `↘ ?`.
- `falls on question words in any position`: `आप कहाँ जा रहे हैं?`,
  `आप कल कहाँ जा रहे हैं?`, `वह आदमी कौन है?` and
  `तुम इतनी देर से क्यों आए?` end in `↘ ?`.
- `rises on plain polar questions`: `तुम आओगे?` has no `↘`.
- `keeps a statement unchanged`: `क्या बात है!` has no `↘`.

Add to `tests/text-to-ipa.test.js` next to the existing English and Russian
question tests (or create them if none exist):

- `keeps question marking of other languages`: `Where are you going?` ends
  in `↘ ?`; `Are you coming?` has no `↘`; `Кто это?` ends in `↘ ?`.

Add to `tests/prosody.test.js`:

- `ends a Hindi particle question high`: plan the IPA of `क्या तुम आओगे?`
  with `language: 'hi'`; the pitch 20 ms before the end of the last vowel is
  at least 15 % above the pitch 20 ms after its start.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m3a.mjs` prints for `क्या तुम आओगे?`
      an IPA string without `↘` and a last-vowel pitch that rises by at
      least 20 Hz (today: 108 to 92).
- [ ] The same run prints `↘ ?` and a falling last vowel for
      `आप कल कहाँ जा रहे हैं?` and `तुम्हारा नाम क्या है?`.
- [ ] The lines for `तुम क्या खाओगे?`, `यह क्या है?`, `क्या हुआ?`,
      `क्या बात है?`, `आप कहाँ जा रहे हैं?` and `तुम आओगे?` are unchanged.
- [ ] Section 8 of `experiments/issue-11-audit.mjs` (English sentence
      types) prints the same numbers as before.
- [ ] The new tests exist and pass; `npm run check` and `npm test` pass; a
      patch changeset is added.

## Out of scope

- Question words after the second word in Russian and English
  (`А ты куда идёшь?` rises today), alternative questions (`Tea or coffee?`)
  and tag questions: {{P39}}.
- The shape of Hindi intonation inside the sentence (rising accent on every
  content word): {{P39}}.
- Marking the sentence type by hand in markup: {{P38}}.

## References

- Kachru, Y. (2006). Hindi. London Oriental and African Language Library 12.
  John Benjamins. Sections on interrogative sentences.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
