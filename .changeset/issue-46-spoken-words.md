---
'voice-simulator': minor
---

Show what is spoken for numbers, dates, times, money and units (issue 46). A timeline word that is not read as written keeps its text and source range and gets `spoken` (`25` → `twenty five`). Its syllables get `spoken` letters and `spokenWord`, and `partStart`/`partEnd` when they read one part of the token (the month, day or year of a date; the hour or minute of a time; the amount, scale or currency of money; the amount or unit of a measure). `textToIpa` words carry the same part range. The example app lights 3, then 4, then 2024 while `3/4/2024` is read, and shows the spoken words (`twen·ty five`) under the active word; the CLI `timeline` command prints them. Words read as written are unchanged. Money with a scale (`$5m`, `€3m`) no longer throws in Russian and Hindi, and Chinese keeps the scale (`五百万美元`).
