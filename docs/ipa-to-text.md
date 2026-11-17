# IPA to text

```js
import { ipaToText } from 'voice-simulator';

ipaToText('həˈloʊ ˈwɝld', { language: 'en' }).text; // hello world
ipaToText('prʲɪˈvʲet', { language: 'ru' }).text; // привет
ipaToText('ni˧˥ xɑʊ˨˩˦', { language: 'zh' }).text; // 你好
```

The language is `en` (default), `ru`, `hi` or `zh`. Input can instead be
an array of `{ ipa, start, end, confidence }` sounds, with times in seconds
and confidence in `[0, 1]`. Invalid IPA, times and options throw.

Strings with spaces use supplied word boundaries by default, except in
Chinese. Arrays and Chinese search for boundaries. Set `boundaries` to
`given` or `search` explicitly to override this. Pauses always separate words.
`beam` (default 32) bounds the pronunciation search and partial transcriptions.
`nbest` includes the best text; values above one add distinct `alternatives`.

Results contain lower-case, punctuation-free `text`, selected `ipa` and
`words`. Each word contains `text`, `ipa`, `language`, `start`, `end`,
`confidence` and `syllables`. Times are null for strings. Syllables use the
same spelling spans as the articulation timeline. Unknown words use a
phonetic spelling and confidence at most 0.3. Homophones depend on corpus
counts and their preceding word; no decoder can recover absent information
from an isolated sound sequence.

The optional `trace(event)` callback reports input length, path costs and
selected word arcs. It is disabled unless supplied.

```sh
voice-simulator text 'həˈloʊ ˈwɝld' --lang en
voice-simulator text 'winʊðɛɹɚtukæts' --lang en --boundaries search --json
node scripts/build-recognition-data.mjs --text '/path/to/text/en/*.txt'
```

The offline builder accepts UTF-8 text directories, verifies at least one
million accepted words per language, and writes count tables only. It
never downloads anything. [SOURCES.md](../src/recognition/data/SOURCES.md)
records the exact corpus hashes, rights and tokenisation. Source texts stay
outside the repository and are never downloaded in CI.

Pronunciations are derived from the forward rules at runtime, including
lexicon variants, Hindi schwa variants and Russian clitics. Exact paths
preserve noiseless speech; otherwise bounded edit search uses the feature
costs in [phone-distance.js](../src/recognition/phone-distance.js).
An acoustic weight calibrates these local costs against the language model.
The Rust core implements the same feature costs, trie search, count model
and dynamic programming; language parsing and spelling remain shared in JS.

Verification uses `tests/ipa-to-text.test.js`, `tests/recognition-data.test.js`
and the deterministic fixture at
`tests/fixtures/recognition/ipa-sentences.json`. The bounded development
measurement command is `node experiments/issue-68/measure.mjs`.
