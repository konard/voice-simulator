# Recognition count sources

Only counts are committed. Every underlying work is in the public domain:
the most recently deceased author listed below died before 1926.
Transcriptions are used for the original works, with site navigation and
modern introductions excluded. The SHA-256 values identify the exact UTF-8
plain-text inputs to the builder, after the documented extraction.

Reproduction (development only; never run by CI):

```sh
python3 experiments/issue-68/fetch-english.py
python3 experiments/issue-68/fetch-corpora.py --lang ru
python3 experiments/issue-68/fetch-corpora.py --lang hi
python3 experiments/issue-68/fetch-corpora.py --lang zh
node scripts/build-recognition-data.mjs --text /tmp/issue-68-corpus
```

The fetch scripts cache downloaded responses outside the checkout. Wikisource
inputs concatenate the original work’s paragraph text in chapter order,
excluding navigation/licence templates and repeated transcluded paragraphs.
Chinese inputs use Wikisource’s simplified-character variant. The Internet
Archive Hindi inputs start after the first standalone `पहला भाग`, excluding
modern reprint introductions. English inputs exclude Gutenberg banners and
licence text; the Butler text uses the older small-print end marker.

Tokenisation uses explicit Unicode expressions rather than ICU segmentation.
Russian pre-1918 letters are modernised (`ѣ→е`, `і/ѵ→и`, `ѳ→ф`, final `ъ`
removed). Hindi digits and punctuation are excluded. Spoken-word entries
exclude written non-speech events and abbreviations expanded by the normaliser.
Accepted source tokens are counted separately from the vocabulary prior:
lexicon words absent from the source get count 1, without increasing corpus size.
Mandarin uses longest-word segmentation (one to four characters), with
established lexicon words and recurring two-character expressions (at least
three occurrences; observed/independent frequency ratio at least one).
Corpus totals and bigrams count only non-overlapping segmented words.
For standalone characters with identical canonical IPA, the vocabulary keeps
the most frequent spelling. Multi-character words retain other character
spellings, and rule spelling still uses the full character-reading inventory.
At most 18,000 established lexicon words are reserved in other languages; the
remaining slots use the most frequent accepted corpus words. All exported
counts are in descending order, with Unicode code-point tie breaks.

| Language | Accepted source tokens |  Words | Bigrams |
| -------- | ---------------------: | -----: | ------: |
| `en`     |              1,473,964 | 20,000 |  40,000 |
| `ru`     |              1,145,974 | 20,000 |  40,000 |
| `hi`     |              1,103,787 | 20,000 |  40,000 |
| `zh`     |              1,683,196 | 20,000 |  40,000 |

## en

- **Bleak House** — Charles Dickens (d. 1870);
  published 1852–1853. [Source](https://raw.githubusercontent.com/GITenberg/Bleak-House_1023/master/1023.txt).
  Input: `1023.txt`; SHA-256:
  `1661520091e27ec00ea5a1db60d998032e286a2ac3172acb1ad1dbbfc7de0f20`.
  Download SHA-256 (before extraction):
  `51c12bd20b0c8efbe08578b4966adb9ece1805f2ff8d96e6b02c4562a4797449`.
- **A First Year in Canterbury Settlement** — Samuel Butler (d. 1902);
  published 1863. [Source](https://raw.githubusercontent.com/GITenberg/A-First-Year-in-Canterbury-Settlement_3235/master/3235.txt).
  Input: `3235.txt`; SHA-256:
  `45958f4ed674b1c07abe8c201241860adac88c346785a5b0142e5cc2f27247e5`.
  Download SHA-256 (before extraction):
  `1754a18242dcac91a2609c1acced13d7822c88e7c869aa9ed69594ee70cf3eb5`.
- **Vittoria, volume 7** — George Meredith (d. 1909);
  published 1867. [Source](https://raw.githubusercontent.com/GITenberg/Vittoria-Volume-7_4441/master/4441.txt).
  Input: `4441.txt`; SHA-256:
  `bec19aa701cd0d583bf4ebb8473fd089a12d408bd51834a02216b822cb5eb17c`.
  Download SHA-256 (before extraction):
  `083b74fa851dcf07757a8fe22c3bf2cf3abdf10a3c41bf0ae571da786371fd71`.
- **Verses, Popular and Humorous** — Henry Lawson (d. 1922);
  published 1900. [Source](https://raw.githubusercontent.com/GITenberg/Verses-popular-and-humorous_52066/master/52066-0.txt).
  Input: `52066-0.txt`; SHA-256:
  `eff4374a5a4233860a8b6a86baf1f0e1d2b1b3707df0ff3dc3efe46e0a7557c8`.
  Download SHA-256 (before extraction):
  `5de6d911121cfb4bd52f6c08dd2204de0963971543b139cb1343c889720bdb6b`.
- **My Literary Zoo** — Kate Sanborn (d. 1917);
  published 1896. [Source](https://raw.githubusercontent.com/GITenberg/My-Literary-Zoo_61790/master/61790-0.txt).
  Input: `61790-0.txt`; SHA-256:
  `5174def802781a8b72ec07de996589c7113efa1a526486c02d5c05ca71150e0a`.
  Download SHA-256 (before extraction):
  `1615140ea16e3037ed281019e58f5e7098e2d2de5cf6e32863ea2d62c252c1dc`.
- **Himalayan Journals** — Joseph Dalton Hooker (d. 1911);
  published 1854. [Source](https://raw.githubusercontent.com/GITenberg/Himalayan-Journals-Complete-Or-Notes-of-a-Naturalist-in-Bengal-the-Sikkim-and-Nepal-Himalayas-__6478/master/6478-8.txt).
  Input: `6478-8.txt`; SHA-256:
  `d607da259e2ad4de32fdca894665bdd5a9c55f4310cba65ae1bc1d0458eac666`.
  Download SHA-256 (before extraction):
  `14a0f560413de735d7de95c564f4d68ceef78dc14df54cc9b41b60227e406ef5`.
- **David Copperfield** — Charles Dickens (d. 1870);
  published 1849–1850. [Source](https://raw.githubusercontent.com/GITenberg/David-Copperfield_766/master/766-0.txt).
  Input: `766-0.txt`; SHA-256:
  `7da8cc1a9ef429382dbbd3f6bd8c9d6c8303def51130cec81d57658d28bdbbb6`.
  Download SHA-256 (before extraction):
  `405d8997c6c5047c6b3ceb5ad1388bd2d30aa78598952744e23a23cea7100e6b`.
- **Little Dorrit** — Charles Dickens (d. 1870);
  published 1855–1857. [Source](https://raw.githubusercontent.com/GITenberg/Little-Dorrit_963/master/963-0.txt).
  Input: `963-0.txt`; SHA-256:
  `91ac7bbf721b03281048c57d6fc8e3cf8d9c85393828304e2746ade143df8487`.
  Download SHA-256 (before extraction):
  `8dfabdc45d26699dfc8e5ed9981e91702a404f28ce73127614b8a02e3e576c53`.

## ru

- **Три медведя (Толстой)** — Лев Толстой (d. 1910);
  published 1875. [Source](https://ru.wikisource.org/wiki/%D0%A2%D1%80%D0%B8_%D0%BC%D0%B5%D0%B4%D0%B2%D0%B5%D0%B4%D1%8F_%28%D0%A2%D0%BE%D0%BB%D1%81%D1%82%D0%BE%D0%B9%29).
  Input: `1247ff9d05e4.txt`; SHA-256:
  `2338d4024c664d6cd3ea67059862ec6a8cc847e1ea358899511ad1206dc18b53`.
- **Анна Каренина (Толстой)** — Лев Толстой (d. 1910);
  published 1875–1877. [Source](https://ru.wikisource.org/wiki/%D0%90%D0%BD%D0%BD%D0%B0_%D0%9A%D0%B0%D1%80%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0_%28%D0%A2%D0%BE%D0%BB%D1%81%D1%82%D0%BE%D0%B9%29).
  Input: `4237166ff747.txt`; SHA-256:
  `3483267f4f67691b7d177d744c0a1aacbf9b50add712b43f8a429769864bf5d3`.
- **Преступление и наказание (Достоевский)** — Фёдор Достоевский (d. 1881);
  published 1866. [Source](https://ru.wikisource.org/wiki/%D0%9F%D1%80%D0%B5%D1%81%D1%82%D1%83%D0%BF%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5_%D0%B8_%D0%BD%D0%B0%D0%BA%D0%B0%D0%B7%D0%B0%D0%BD%D0%B8%D0%B5_%28%D0%94%D0%BE%D1%81%D1%82%D0%BE%D0%B5%D0%B2%D1%81%D0%BA%D0%B8%D0%B9%29).
  Input: `933d3acb12cc.txt`; SHA-256:
  `f2d80bb7f7f4793b7867a99fa212a6512944ae17186e6f7c21917fefa6fffb02`.
- **Братья Карамазовы (Достоевский)** — Фёдор Достоевский (d. 1881);
  published 1879–1880. [Source](https://ru.wikisource.org/wiki/%D0%91%D1%80%D0%B0%D1%82%D1%8C%D1%8F_%D0%9A%D0%B0%D1%80%D0%B0%D0%BC%D0%B0%D0%B7%D0%BE%D0%B2%D1%8B_%28%D0%94%D0%BE%D1%81%D1%82%D0%BE%D0%B5%D0%B2%D1%81%D0%BA%D0%B8%D0%B9%29).
  Input: `c7ac633cdbca.txt`; SHA-256:
  `20eca60b0c57bf0a0cc6da69771b0fc132ac5878139465896a8a3e44b6e4bc50`.
- **Война и мир (Толстой)** — Лев Толстой (d. 1910);
  published 1865–1869. [Source](https://ru.wikisource.org/wiki/%D0%92%D0%BE%D0%B9%D0%BD%D0%B0_%D0%B8_%D0%BC%D0%B8%D1%80_%28%D0%A2%D0%BE%D0%BB%D1%81%D1%82%D0%BE%D0%B9%29).
  Input: `cd0de812d61b.txt`; SHA-256:
  `ab16957c0338c5187747e6fc9b31f4f1866598e1e678be404f01ee212ce3e3d0`.

## hi

- **भारतेंदु-नाटकावली** — भारतेन्दु हरिश्चन्द्र (d. 1885);
  published 1868–1884. [Source](https://hi.wikisource.org/wiki/%E0%A4%AD%E0%A4%BE%E0%A4%B0%E0%A4%A4%E0%A5%87%E0%A4%82%E0%A4%A6%E0%A5%81-%E0%A4%A8%E0%A4%BE%E0%A4%9F%E0%A4%95%E0%A4%BE%E0%A4%B5%E0%A4%B2%E0%A5%80).
  Input: `59c46d7ce534.txt`; SHA-256:
  `fe65979be87fde688bab47bc77a12647ceae633902528e46c42e40c2ddd0c0c4`.
- **रामचरितमानस** — तुलसीदास (d. 1623);
  published 1574–1576. [Source](https://hi.wikisource.org/wiki/%E0%A4%B0%E0%A4%BE%E0%A4%AE%E0%A4%9A%E0%A4%B0%E0%A4%BF%E0%A4%A4%E0%A4%AE%E0%A4%BE%E0%A4%A8%E0%A4%B8).
  Input: `5ef4a739cb01.txt`; SHA-256:
  `33b9ff6ecad09576f16a0c01e59ac4216092634380e85ce1359dbe00d9477d9b`.
- **चन्द्रकांता सन्तति २** — देवकीनंदन खत्री (d. 1913);
  published 1896–1905. [Source](https://hi.wikisource.org/wiki/%E0%A4%9A%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%82%E0%A4%A4%E0%A4%BE_%E0%A4%B8%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%A4%E0%A4%BF_%E0%A5%A8).
  Input: `82d920ccc5e4.txt`; SHA-256:
  `d7fdfb261dc2fe18a95f6c42b88cff8677a40572f10e2eb9577f1be19ab0750d`.
- **चन्द्रकांता सन्तति 4** — देवकीनंदन खत्री (d. 1913);
  published 1896–1905. [Source](https://hi.wikisource.org/wiki/%E0%A4%9A%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%82%E0%A4%A4%E0%A4%BE_%E0%A4%B8%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%A4%E0%A4%BF_4).
  Input: `8d30fc0e331a.txt`; SHA-256:
  `b9069fe340a74a3f7357e01c5e067f437bc1dbb301e085f789031c6c7580cabf`.
- **परीक्षा गुरु** — लाला श्रीनिवासदास (d. 1887);
  published 1882. [Source](https://hi.wikisource.org/wiki/%E0%A4%AA%E0%A4%B0%E0%A5%80%E0%A4%95%E0%A5%8D%E0%A4%B7%E0%A4%BE_%E0%A4%97%E0%A5%81%E0%A4%B0%E0%A5%81).
  Input: `91c374a307b9.txt`; SHA-256:
  `f56c75893393d66eb323a406c1515ba35d6a94ed310acf15bdc7d09039095001`.
- **चन्द्रकान्ता सन्तति 5** — देवकीनंदन खत्री (d. 1913);
  published 1896–1905. [Source](https://hi.wikisource.org/wiki/%E0%A4%9A%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%BE_%E0%A4%B8%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%A4%E0%A4%BF_5).
  Input: `a6dfc8e1c282.txt`; SHA-256:
  `e5c0197a4f84fc694d44f53c376c06d06588e4b5c9af0828c0a0df161905d2cf`.
- **चन्द्रकांता सन्तति 3** — देवकीनंदन खत्री (d. 1913);
  published 1896–1905. [Source](https://hi.wikisource.org/wiki/%E0%A4%9A%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%82%E0%A4%A4%E0%A4%BE_%E0%A4%B8%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%A4%E0%A4%BF_3).
  Input: `a9c16152eb62.txt`; SHA-256:
  `220ce9a75914b09f071d817393b25e60c71b2de70ff77bbae2fea4f97c6ba264`.
- **सत्यार्थ प्रकाश** — दयानन्द सरस्वती (d. 1883);
  published 1875. [Source](https://hi.wikisource.org/wiki/%E0%A4%B8%E0%A4%A4%E0%A5%8D%E0%A4%AF%E0%A4%BE%E0%A4%B0%E0%A5%8D%E0%A4%A5_%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%B6).
  Input: `b9aa29b2a038.txt`; SHA-256:
  `d3c281bbe5f6e2a83823d4939ae72523498494af41f4801a9f93491b95986967`.
- **चन्द्रकान्ता सन्तति 6** — देवकीनंदन खत्री (d. 1913);
  published 1896–1905. [Source](https://hi.wikisource.org/wiki/%E0%A4%9A%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%BE_%E0%A4%B8%E0%A4%A8%E0%A5%8D%E0%A4%A4%E0%A4%A4%E0%A4%BF_6).
  Input: `cddcb3fcde4c.txt`; SHA-256:
  `f49af5c64c6fd686f2768376c0a05f7a8d207a7f5b5d294fb0e96840e2b72046`.
- **प्रेमसागर** — लल्लू लाल (d. 1835);
  published 1810. [Source](https://hi.wikisource.org/wiki/%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%AE%E0%A4%B8%E0%A4%BE%E0%A4%97%E0%A4%B0).
  Input: `f6783350f241.txt`; SHA-256:
  `4376af23ddd6fc246a425d2ef32b8523b02be7ab4a40b637490590f057265171`.
- **चन्द्रकान्ता सन्तति I** — देवकीनंदन खत्री (d. 1913);
  published 1896. [Source](https://archive.org/download/ojqc-chandrakanta-santati-i-babu-devaki-nandan-khatri/Chandrakanta%20Santati%20I%20-%20Babu%20Devaki%20Nandan%20Khatri_djvu.txt).
  Input: `ojqc-chandrakanta-santati-i-babu-devaki-nandan-khatri.txt`; SHA-256:
  `674adbdb7bf20917cd363c762f8b8e23488bfa2f9f2c71a72327d60bf01ae5da`.
  Download SHA-256 (before extraction):
  `a46dd477d7a9d05297fd02c39cc772158e60a6127b9bd514be985de0df1bfe84`.
- **चन्द्रकान्ता** — देवकीनंदन खत्री (d. 1913);
  published 1888. [Source](https://archive.org/download/wecx-chandra-kanta-babu-devaki-nandan-khatri/Chandra%20Kanta%20-%20Babu%20Devaki%20Nandan%20Khatri_djvu.txt).
  Input: `wecx-chandra-kanta-babu-devaki-nandan-khatri.txt`; SHA-256:
  `5ab39684a5d5a41ba2896c7a2891be9fd9e49f68912f4a48d7c70b0bc74642d6`.
  Download SHA-256 (before extraction):
  `a4986ab3a8ff53fc14d1c9b80975164712d725c1a6f1fc49b3c92ecf4aa93e4a`.

## zh

- **三國演義** — 羅貫中 (d. 1400);
  published 1522. [Source](https://zh.wikisource.org/wiki/%E4%B8%89%E5%9C%8B%E6%BC%94%E7%BE%A9).
  Input: `18a3f00d01fa.txt`; SHA-256:
  `432a5e9fd58fde6becadffc2645acdc9e9a8cd2072d931f9ff9f599e1d52b885`.
- **封神演義** — 許仲琳 / 陸西星 (attributed) (d. 1606);
  published 1620. [Source](https://zh.wikisource.org/wiki/%E5%B0%81%E7%A5%9E%E6%BC%94%E7%BE%A9).
  Input: `1c07f837ce43.txt`; SHA-256:
  `2cb2646dd9a874512e55406b8daf359c80f28b332a5c173353b7bdd3fae9d6d3`.
- **水滸傳 (100回本)** — 施耐庵 / 羅貫中 (d. 1400);
  published 1589. [Source](https://zh.wikisource.org/wiki/%E6%B0%B4%E6%BB%B8%E5%82%B3_%28100%E5%9B%9E%E6%9C%AC%29).
  Input: `78e8430190be.txt`; SHA-256:
  `72ee43b87978e0adedc841fd3cbfe7d77f0cf438de523b72eab732c9c51ee182`.
- **西遊記** — 吳承恩 (d. 1582);
  published 1592. [Source](https://zh.wikisource.org/wiki/%E8%A5%BF%E9%81%8A%E8%A8%98).
  Input: `a8365a4f5da5.txt`; SHA-256:
  `6461e84703b53eefc43e6ec11436eb0856c6ffc07afec53a10cac1932ca2aa8a`.
- **紅樓夢** — 曹雪芹 / 高鶚 (d. 1815);
  published 1791. [Source](https://zh.wikisource.org/wiki/%E7%B4%85%E6%A8%93%E5%A4%A2).
  Input: `ea1d47abd2df.txt`; SHA-256:
  `66ab5abbe4c032c1f2dbb93074387867682a3c8b184a211c98eee2f93399daaf`.
