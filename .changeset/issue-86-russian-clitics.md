---
'voice-simulator': patch
---

Speak Russian prepositions and the particles `не`, `ни`, `же`, `ли`, `бы` as part of the word they lean on: the vowel is reduced and the last consonant takes the voicing of the next sound (`из дома` ɪz ˈdomə, `с братом` z ˈbratəm, `на работе` nə rɐˈbotʲə, `как же` kaɡ ʐɨ). The forms are a table in `src/g2p/russian-clitics.js`; each written word stays one item of `words`, a clitic alone or at a break keeps its full reading, and a typed stress mark (`на́ гору`) keeps today's reading.
