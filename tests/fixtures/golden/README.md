# Golden set

Short sentences spoken by people, for tests that compare the simulator with a
real voice and need no network (issue
[17](https://github.com/konard/voice-simulator/issues/17)). There are 24 files:
6 sentences each in English, Russian, Hindi and Mandarin. All of them are
16 kHz, mono, 16-bit FLAC, and together they are smaller than 2 000 000 bytes.
`manifest.json` lists each file with:

- its text and its IPA, written by hand;
- the reader;
- the duration and the SHA-256 of the file;
- the LibriVox section and the seconds of the section it was cut from;
- the printed text;
- the review state.

These recordings are in the public domain in the USA; LibriVox says they may not be in other countries.

In a test, `loadGolden({ lang, reviewedOnly })` of `tests/helpers/golden.js`
returns the decoded samples together with the fields of the manifest.
`node scripts/golden.mjs verify` and `tests/golden-set.test.js` check the folder.
The package does not ship `tests/`.

## Sources

Every section is an entry of
[datasets/registry.json](../../../datasets/registry.json) with
`redistribution: true`, its size and its SHA-256. All four catalogue pages say
the same thing about the licence, and so does the general LibriVox page,
<https://librivox.org/pages/public-domain/>. These pages were read on
2026-11-15. The statement on the catalogue pages is:

> LibriVox recordings are Public Domain in the USA. If you are not in the USA,
> please verify the copyright status of these works in your own country
> before downloading, otherwise you may be violating copyright laws.

| Title                                   | Language (catalogue) | Sections used          | Readers                                                                                     | Catalogue URL                                              | Licence statement                                                  | Printed text                                                                                                             |
| --------------------------------------- | -------------------- | ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Aesop's Fables, Volume 01 (Fables 1-25) | English              | 02, 07, 09, 12, 18, 22 | Alice Elizabeth Still, Joplin James, Beth Dudek, Kara Shallenberg, Annie Coleman Rothenberg | <https://librivox.org/aesops-fables-volume-1-fables-1-25/> | "LibriVox recordings are Public Domain in the USA." (quoted above) | V. S. Vernon Jones, _Aesop's Fables: a new translation_, 1912; [Gutenberg 11339](https://www.gutenberg.org/ebooks/11339) |
| Aesops Fables in Russian                | Russian              | 09, 13, 26             | Chamberlain, Kristine Bekere, albus865                                                      | <https://librivox.org/aesops-fables-in-russian/>           | "LibriVox recordings are Public Domain in the USA." (quoted above) | Leo Tolstoy's retellings of Aesop (1875; Tolstoy died in 1910); one ru.wikisource.org page per fable, in `textSource`    |
| Do Sakhiyan                             | Hindi                | 1, 2, 6                | Sonali Ekka                                                                                 | <https://librivox.org/do-sakhiyan-by-premchand/>           | "LibriVox recordings are Public Domain in the USA." (quoted above) | Premchand (died in 1936), _Do Sakhiyan_, 1926; Gadya Kosh pages 1, 2 and 6, in `textSource`                              |
| 弟子规 Di Zi Gui                        | Chinese              | 03 (Mandarin)          | HC                                                                                          | <https://librivox.org/di-zi-gui-by-li-yuexiu/>             | "LibriVox recordings are Public Domain in the USA." (quoted above) | Li Yuxiu (1662 to 1722), _Di Zi Gui_; [amtb.tw](https://www.amtb.tw/pdf/dzg_word.pdf)                                    |

Of the Di Zi Gui sections, only 03, the Mandarin reading, is used. The
Cantonese and Hakka readings are not.

## Files

| Id    | Text                                                                       | Section                      | Seconds of the section | Reader                                                     |
| ----- | -------------------------------------------------------------------------- | ---------------------------- | ---------------------- | ---------------------------------------------------------- |
| en-01 | Persuasion is better than force.                                           | `librivox-aesop-en-22`       | 72.195 to 75.310       | [Alice Elizabeth Still](https://librivox.org/reader/215)   |
| en-02 | But when they cut it open they found it was just like any other goose.     | `librivox-aesop-en-02`       | 33.835 to 37.870       | [Joplin James](https://librivox.org/reader/201)            |
| en-03 | Look and see which way the wind blows before you commit yourself.          | `librivox-aesop-en-07`       | 44.055 to 47.700       | [Beth Dudek](https://librivox.org/reader/246)              |
| en-04 | A Peacock taunted a Crane with the dullness of her plumage.                | `librivox-aesop-en-12`       | 22.515 to 27.645       | [Beth Dudek](https://librivox.org/reader/246)              |
| en-05 | Her beauty is without equal, the hue of her plumage exquisite.             | `librivox-aesop-en-09`       | 45.670 to 50.935       | [Kara Shallenberg](https://librivox.org/reader/19)         |
| en-06 | Betray a friend, and you'll often find you have ruined yourself.           | `librivox-aesop-en-18`       | 104.010 to 109.805     | [Annie Coleman Rothenberg](https://librivox.org/reader/30) |
| ru-01 | Старый больной лев лежал в пещере.                                         | `librivox-aesop-ru-13`       | 31.820 to 34.980       | [Kristine Bekere](https://librivox.org/reader/1593)        |
| ru-02 | Приходили все звери проведывать царя, только лисица не бывала.             | `librivox-aesop-ru-13`       | 34.980 to 40.120       | [Kristine Bekere](https://librivox.org/reader/1593)        |
| ru-03 | Только теперь нашла, вот и прибежала.                                      | `librivox-aesop-ru-13`       | 80.390 to 83.530       | [Kristine Bekere](https://librivox.org/reader/1593)        |
| ru-04 | И комар затрубил и стал кусать льва в голые щёки и в нос.                  | `librivox-aesop-ru-09`       | 55.435 to 60.490       | [Chamberlain](https://librivox.org/reader/2826)            |
| ru-05 | Я ещё не знаю, кто из вас мёд делает.                                      | `librivox-aesop-ru-26`       | 40.505 to 43.590       | [albus865](https://librivox.org/reader/3056)               |
| ru-06 | Вот через неделю я увижу, кто больше и лучше мёду наделает.                | `librivox-aesop-ru-26`       | 48.610 to 53.605       | [albus865](https://librivox.org/reader/3056)               |
| hi-01 | ईश्वर को धन्यवाद देती हूँ कि मेरे पिताजी पुरानी लकीर पीटने वालों में नहीं। | `librivox-do-sakhiyan-hi-01` | 52.260 to 57.880       | [Sonali Ekka](https://librivox.org/reader/19651)           |
| hi-02 | यह उन पर न्योछावर होने के लिए विकल हो जाता है।                             | `librivox-do-sakhiyan-hi-01` | 139.450 to 143.620     | [Sonali Ekka](https://librivox.org/reader/19651)           |
| hi-03 | अगर माता-पिता अकाल मर जायँ, तो लड़की का विवाह कौन करे।                     | `librivox-do-sakhiyan-hi-02` | 136.980 to 142.055     | [Sonali Ekka](https://librivox.org/reader/19651)           |
| hi-04 | योग्यता का फूल लगा और अधिकार का फल आया।                                    | `librivox-do-sakhiyan-hi-06` | 102.410 to 106.700     | [Sonali Ekka](https://librivox.org/reader/19651)           |
| hi-05 | कभी कोठे पर जाती थी, कभी नीचे आती थी।                                      | `librivox-do-sakhiyan-hi-06` | 129.655 to 133.130     | [Sonali Ekka](https://librivox.org/reader/19651)           |
| hi-06 | इस विषय में तुम्हें मुझसे उपदेश लेना चाहिए।                                | `librivox-do-sakhiyan-hi-06` | 34.785 to 38.495       | [Sonali Ekka](https://librivox.org/reader/19651)           |
| zh-01 | 读书法，有三到，心眼口，信皆要。                                           | `librivox-di-zi-gui-zh-03`   | 536.600 to 542.030     | [HC](https://librivox.org/reader/2245)                     |
| zh-02 | 方读此，勿慕彼，此未终，彼勿起。                                           | `librivox-di-zi-gui-zh-03`   | 542.030 to 547.645     | [HC](https://librivox.org/reader/2245)                     |
| zh-03 | 人不闲，勿事搅，人不安，勿话扰。                                           | `librivox-di-zi-gui-zh-03`   | 436.085 to 441.850     | [HC](https://librivox.org/reader/2245)                     |
| zh-04 | 心有疑，随札记，就人问，求确义。                                           | `librivox-di-zi-gui-zh-03`   | 553.195 to 558.830     | [HC](https://librivox.org/reader/2245)                     |
| zh-05 | 房室清，墙壁净，几案洁，笔砚正。                                           | `librivox-di-zi-gui-zh-03`   | 558.830 to 564.600     | [HC](https://librivox.org/reader/2245)                     |
| zh-06 | 勿谄富，勿骄贫，勿厌故，勿喜新。                                           | `librivox-di-zi-gui-zh-03`   | 430.420 to 436.085     | [HC](https://librivox.org/reader/2245)                     |

The reader pages do not say whether the reader is a woman or a man. For this
reason `speaker.sex` is `unknown` for every file: the sex is not guessed from
a name.

## How the files were made

1. **Fetch and convert, once, on the machine of the person adding a file.**
   This step is never run in CI, and the repository has no ffmpeg or MP3
   decoder.

   ```bash
   node scripts/datasets.mjs fetch librivox-aesop-en-22
   ffmpeg -nostdin -i .datasets/librivox-aesop-en-22/fables_01_22_aesop_64kb.mp3 \
     -ac 1 -ar 16000 -c:a pcm_s16le fables_01_22_aesop_64kb.wav
   ```

   The `tool` field of `manifest.json` records the ffmpeg version that was
   used, `ffmpeg 7.0.2` (the static amd64 build).

2. **Find the pauses.**

   ```bash
   node scripts/golden.mjs pauses fables_01_22_aesop_64kb.wav
   ```

   The command works on 10 ms frames. It takes `L95`, the level that 95 % of
   the frames are below. A frame is silent when it is more than 35 dB below
   `L95`. The command prints every run of silent frames that lasts at least
   0.25 s.

3. **Choose the cuts.** Each cut is one whole sentence of 5 to 16 words
   (Mandarin: 6 to 24 characters). It begins in the middle of one pause and
   ends in the middle of a later pause, and it lasts 2 to 6 s. The opening
   and closing LibriVox words are left out, and so are digits, abbreviations
   and foreign names.

   Two experiments were used to decide which words lie between two pauses:
   - `experiments/issue-17-align.mjs` matches syllable nuclei to the words of
     the text.
   - `experiments/issue-17-pitch.mjs` checks the tone pattern of Mandarin.

   Each guess was then checked with the rate rule: 2 to 8 vowel groups,
   Hindi units or Han characters per second.

   The Mandarin text is a rhyme in lines of three characters. Each cut is
   one stanza of four lines (12 characters), which forms one sentence of the
   text.

4. **Cut.**

   ```bash
   node scripts/golden.mjs cut --source fables_01_22_aesop_64kb.wav \
     --start 72.195 --end 75.310 --id en-01
   ```

   The command adds a 10 ms linear fade at both ends and scales the peak to
   0.708 (−3 dBFS). It writes `<id>.flac` with `encodeFlac` and prints the
   duration, the size and the SHA-256, which go into `manifest.json`.

5. **Check.** `node scripts/golden.mjs verify` must print nothing and exit 0.

## Review

An automatic agent cannot listen to the files. For this reason every file
starts with `review.text` and `review.ipa` set to `unreviewed` and
`review.by` set to `null`.

A person who knows the language confirms a file in three steps:

1. Listen to it.
2. Tick the boxes "text matches the audio" and "IPA matches the audio" in the
   pull request.
3. Set both fields to `confirmed` and `review.by` to their GitHub name.

`loadGolden({ reviewedOnly: true })` returns only confirmed files. Reports
mark the other files with `*`.
