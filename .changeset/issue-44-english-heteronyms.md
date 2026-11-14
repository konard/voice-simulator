---
'voice-simulator': patch
---

Read English heteronyms as fits the sentence: `I will read` has ɹid and `I read it yesterday` ɹɛd, `record the record` has ɹəˈkɔɹd then ˈɹɛkɚd. A hand-written table of 66 words and their `-s` forms (`src/g2p/english-heteronyms.js`) is chosen from by written rules on the neighbouring words (`src/g2p/english-context.js`); such words report the source `heteronym` and the tag that chose them.
