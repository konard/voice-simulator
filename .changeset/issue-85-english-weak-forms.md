---
'voice-simulator': minor
---

Speak English function words in their weak form inside a phrase: `a cup of tea for you` is ə ˈkʌp əv ˈti fɚ ju, `the end` ði ˈɛnd, `I have to go` aɪ ˈhæf tə ˈɡoʊ. A word keeps its strong form alone, at the end of a phrase (`Yes, I can.`), as a noun after a determiner (`a can of beans`) and before `not`. The table is exported as `WEAK_FORMS` (`src/g2p/weak-forms.js`); the new option `weakForms: false` of `textToIpa`, `synthesize` and `prepareUtterance` (CLI `--strong-forms`) keeps every word strong.
