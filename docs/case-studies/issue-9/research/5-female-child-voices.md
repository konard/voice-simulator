## 5. Female and child voice acoustics

### 5.1 Hillenbrand, Getty, Clark & Wheeler (1995): group means I computed

**Source.** Hillenbrand et al. 1995, _JASA_ 97(5), doi [10.1121/1.411872](https://doi.org/10.1121/1.411872). They recorded 45 men, 48 women and 46 children saying /hVd/ words ([abstract via Europe PMC](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%2210.1121/1.411872%22&resultType=core&format=json)).

**Data access.** The author's page `homepages.wmich.edu/~hillenbr/voweldata.html` no longer resolves in DNS, and the Wayback API returned no snapshot. I used `h95-alldata.zip` from [santiagobarreda/hillenbrand_et_al_1995](https://github.com/santiagobarreda/hillenbrand_et_al_1995), whose README says it is "hosted with permission from Jim Hillenbrand." The `vowdata.dat` inside carries the "(c) 1995 James Hillenbrand" header. It has one row per token: steady-state f0 and F1–F4, plus F1–F3 at 20/50/80% of the vowel.

**Method.** I averaged the steady-state columns 3–6 over tokens, leaving out zeros (the file uses 0 for "not measurable"). Children means pool boys and girls; the file has 27 boys and 19 girls.

**Check against the authors.** My overall f0 comes out at 131 Hz for men and 220 Hz for women. Hillenbrand & Clark 2009 quote exactly these values for this dataset ([PDF, p. 1150](https://link.springer.com/content/pdf/10.3758/APP.71.5.1150.pdf)). I could not fetch Table V of the 1995 paper itself, so individual cells may differ from it by a few Hz depending on how tokens were included. The children's age range (often cited as 10–12) does not appear on any page I fetched, so I treat it as unverified.

**Table 5.1. Hillenbrand et al. (1995), steady-state means in Hz (M = men, W = women, C = children)**

| Vowel (file code) | f0 M | f0 W | f0 C | F1 M | F1 W | F1 C | F2 M | F2 W | F2 C | F3 M | F3 W | F3 C |
| ----------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| /i/ heed (iy)     | 139  | 227  | 246  | 343  | 437  | 452  | 2323 | 2761 | 3082 | 3001 | 3373 | 3702 |
| /ɪ/ hid (ih)      | 136  | 225  | 240  | 429  | 484  | 513  | 2034 | 2369 | 2556 | 2687 | 3057 | 3409 |
| /ɛ/ head (eh)     | 127  | 213  | 230  | 588  | 727  | 740  | 1803 | 2063 | 2279 | 2604 | 2953 | 3297 |
| /æ/ had (ae)      | 126  | 214  | 229  | 591  | 676  | 718  | 1930 | 2335 | 2497 | 2595 | 2973 | 3289 |
| /ɑ/ hod (ah)      | 127  | 212  | 231  | 756  | 921  | 992  | 1309 | 1526 | 1689 | 2535 | 2832 | 2937 |
| /ɔ/ hawed (aw)    | 125  | 214  | 232  | 656  | 804  | 836  | 1023 | 1188 | 1303 | 2521 | 2824 | 2951 |
| /ʊ/ hood (oo)     | 133  | 230  | 242  | 469  | 519  | 571  | 1123 | 1229 | 1506 | 2435 | 2829 | 3076 |
| /u/ who'd (uw)    | 144  | 236  | 247  | 380  | 460  | 493  | 992  | 1106 | 1404 | 2355 | 2735 | 2992 |
| /ʌ/ hud (uh)      | 129  | 218  | 234  | 621  | 760  | 738  | 1181 | 1416 | 1538 | 2548 | 2901 | 3126 |
| /ɝ/ heard (er)    | 131  | 218  | 237  | 475  | 524  | 586  | 1379 | 1588 | 1721 | 1711 | 1930 | 2154 |
| /e/ hayed (ei)    | 129  | 220  | 238  | 476  | 535  | 565  | 2090 | 2526 | 2649 | 2692 | 3050 | 3323 |
| /o/ hoed (oa)     | 130  | 218  | 238  | 498  | 555  | 599  | 910  | 1036 | 1140 | 2459 | 2828 | 3006 |

**Other results from the same computation:**

- Overall f0 is 131 Hz for men, 220 Hz for women and 237 Hz for children. Boys average 236 Hz and girls 238 Hz, so f0 barely differs by sex at this age.
- Averaged over the 12 vowels, the women/men ratio is 1.68 for f0, and 1.18, 1.16 and 1.14 for F1, F2 and F3.
- Children/men ratios are 1.81 for f0 and 1.24, 1.29 and 1.24 for F1–F3.
- For comparison, Hillenbrand & Clark report women/men formant factors of 1.18, 1.17 and 1.14 from this data ([p. 1150](https://link.springer.com/content/pdf/10.3758/APP.71.5.1150.pdf)).
- Formant factors are clearly not uniform. For example, children's F2 for /u/ is 1.42× the men's value, while their F3 for /ɑ/ is only 1.16×.

### 5.2 Peterson & Barney (1952)

**Data source.** I used the `pb52` dataset from the R package phonTools ([CRAN archive tarball](https://cran.r-project.org/src/contrib/Archive/phonTools/phonTools_0.2-2.1.tar.gz)). Its help file says it was "created from tables provided within Praat." It has 76 speakers (33 men, 28 women, 15 children) and 2 repetitions per speaker, 1,520 rows in total.

**Method.** I averaged all tokens with R.

**Caveat.** This is a Praat-derived copy, not the 1952 printed table. Hillenbrand & Clark cite Peterson & Barney's means as 132 Hz for men and 224 Hz for women ([p. 1150](https://link.springer.com/content/pdf/10.3758/APP.71.5.1150.pdf)); my means from this copy are 131 and 223 Hz.

**Table 5.2. Peterson & Barney (1952), means of the pb52 tokens in Hz**

| Vowel | f0 M | f0 W | f0 C | F1 M | F1 W | F1 C | F2 M | F2 W | F2 C | F3 M | F3 W | F3 C |
| ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| /i/   | 136  | 231  | 270  | 267  | 310  | 360  | 2294 | 2783 | 3178 | 2937 | 3312 | 3763 |
| /ɪ/   | 136  | 232  | 270  | 392  | 441  | 534  | 1993 | 2474 | 2744 | 2569 | 3063 | 3604 |
| /ɛ/   | 128  | 220  | 259  | 526  | 608  | 700  | 1854 | 2334 | 2616 | 2481 | 2999 | 3564 |
| /æ/   | 125  | 208  | 248  | 664  | 863  | 1017 | 1727 | 2049 | 2334 | 2420 | 2832 | 3366 |
| /ɑ/   | 124  | 212  | 258  | 718  | 864  | 1030 | 1091 | 1229 | 1383 | 2442 | 2783 | 3188 |
| /ɔ/   | 127  | 217  | 259  | 568  | 587  | 694  | 836  | 915  | 1064 | 2403 | 2736 | 3263 |
| /ʊ/   | 136  | 234  | 273  | 437  | 469  | 560  | 1023 | 1162 | 1402 | 2245 | 2685 | 3332 |
| /u/   | 139  | 235  | 278  | 307  | 378  | 432  | 876  | 961  | 1193 | 2239 | 2666 | 3250 |
| /ʌ/   | 129  | 223  | 263  | 631  | 758  | 855  | 1192 | 1409 | 1592 | 2377 | 2768 | 3328 |
| /ɝ/   | 133  | 219  | 264  | 489  | 503  | 569  | 1360 | 1641 | 1806 | 1709 | 1977 | 2194 |

**Other results from the same computation:**

- Overall f0 is 131 Hz for men, 223 Hz for women and 264 Hz for children.
- Women/men ratios are 1.70 for f0 and 1.15, 1.17 and 1.17 for F1–F3.
- Children/men ratios are 2.01 for f0 and 1.34, 1.35 and 1.38 for F1–F3.
- Hillenbrand & Clark scaled f0 by 1.7041 and formants by 1.168 to turn men into women; both factors are Peterson & Barney averages ([p. 1155](https://link.springer.com/content/pdf/10.3758/APP.71.5.1150.pdf)).
- Peterson & Barney's children are higher in f0 and formants than Hillenbrand's, probably because their children were younger or a mix of ages (not verified).

### 5.3 Glottal source: female vs male

**DOI corrections.** Three of the DOIs in the brief point to unrelated papers, according to [Crossref](https://api.crossref.org/works/10.1121/1.418242):

- 10.1121/1.418242 is a sonoluminescence paper. The correct DOI for Hanson 1997 is [10.1121/1.417991](https://doi.org/10.1121/1.417991) (JASA 101:466–481).
- 10.1121/1.396537 is an acoustic-inversion paper. The correct DOI for Holmberg et al. 1988 is [10.1121/1.396829](https://doi.org/10.1121/1.396829) (JASA 84:511–529).
- 10.1121/1.427072 is a matched-field localization paper. The correct DOI for Fitch & Giedd 1999 is [10.1121/1.427148](https://doi.org/10.1121/1.427148).

**Hanson & Chuang 1999** ([doi 10.1121/1.427116](https://doi.org/10.1121/1.427116); full text at [graphics.stanford.edu/~echuang/glottal.pdf](https://graphics.stanford.edu/~echuang/glottal.pdf)) compared 21 men with Hanson's 22 women on the vowels /æ, ʌ, ɛ/. Asterisks mean the harmonic or formant amplitudes were corrected for formant effects. In the PDF text layer, minus signs came out as a leading "2"; I restored them in the table below.

**Table 5.3. Hanson & Chuang 1999, Table X (M = 21 men; F = 22 women from Hanson 1995a/1997)**

| Measure               | What it indexes  | M mean | F mean | M range   | F range   | M s.d. | F s.d. |
| --------------------- | ---------------- | ------ | ------ | --------- | --------- | ------ | ------ |
| H1*–H2* (dB)          | open quotient    | 0.0    | 3.1    | −3.3…4.2  | −2.6…6.9  | 1.8    | 2.0    |
| H1\*–A1 (dB)          | F1 bandwidth     | −6.9   | −3.9   | −16.1…0.4 | −12.4…3.9 | 3.5    | 4.3    |
| H1*–A3* (dB)          | spectral tilt    | 13.8   | 23.4   | 4.8…24.1  | 8.6…35.0  | 4.8    | 6.6    |
| Noise rating Nw (1–4) | aspiration noise | 1.9    | 2.3    | 1.2…3.2   | 1.1…3.8   | 0.5    | 0.7    |
| B1 for /æ/ (Hz)       | F1 bandwidth     | 126    | 165    | 53…245    | 53…280    | 54     | 61     |

What else the paper says ([same PDF](https://graphics.stanford.edu/~echuang/glottal.pdf)):

- The abstract gives the H1–A3 gap as 9.6 dB and calls spectral tilt "an especially significant parameter for differentiating male and female speech."
- The authors explain the tilt difference by men's more complete glottal closure.
- It cites Klatt & Klatt (1990) as finding a 5.7 dB sex difference in H1–H2, and Henton & Bladon (1985) as finding about 6 dB.
- It cites Södersten & Lindestad (1990) for the observation that a posterior glottal opening (glottal chink) lasting through the whole cycle is "common for female speakers, but occurs much less frequently among male speakers."
- It cites Holmberg et al. for women having "larger open quotients and more gradual rises and falls in glottal flow."
- Men sometimes show a second excitation within each glottal period, which the authors rarely saw in women.

**Hanson 1997** ([abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Glottal%20characteristics%20of%20female%20speakers%22&resultType=core&format=json)) argues that a more open glottis produces:

- stronger low-frequency and weaker high-frequency source components,
- more aspiration noise,
- a wider F1 bandwidth.

The female numbers above come from this paper by way of Table X. I could not get the 1997 full text; the thesis PDF on [MIT DSpace](https://dspace.mit.edu/handle/1721.1/22393) returned HTTP 429.

**Holmberg, Hillman & Perkell 1988** ([abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Glottal%20airflow%20and%20transglottal%20air%20pressure%20measurements%20for%20male%20and%20female%20speakers%22&resultType=core&format=json)) studied 25 men and 20 women using inverse-filtered airflow:

- In normal and loud voice, men had higher AC flow and a higher maximum airflow declination rate.
- Subglottal pressure and DC (leakage) flow did not differ significantly by sex.
- In soft voice, the male and female waveforms became more alike.

I could not obtain their open-quotient means. A secondary source, the [Stuttgart EGG review](https://www2.ims.uni-stuttgart.de/EGG/pagel8.htm), says Holmberg et al. found a male–female open-quotient difference of "about 13% for normal loudness." The same page cites Claßen et al. (1996) for H1*–H2* of 2.05 dB in men vs 5.51 dB in women. Its own EGG data give a non-contact quotient of 37% for women vs 33% for men.

**Klatt & Klatt 1990** ([doi 10.1121/1.398894](https://doi.org/10.1121/1.398894); [abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%2210.1121/1.398894%22&resultType=core&format=json)) analysed 10 women and 6 men. They list four cues to breathiness:

1. a stronger fundamental (H1) as open quotient rises,
2. aspiration noise replacing the higher harmonics,
3. wider bandwidths in the lower formants,
4. extra pole-zero pairs from coupling to the trachea.

Their main findings:

- **Perception:** aspiration noise was the most important cue. Raising H1 without noise "may induce the sensation of nasality in a high-pitched voice."
- **Sex difference:** "on average, females are more breathy than males, but there are very large differences between subjects within each gender."
- **Within an utterance:** breathiness rises on unstressed syllables, on final syllables, and next to voiceless consonants.
- **Irregularities:** utterances often end in breathy-laryngealized vibration, and diplophonia is frequent. Both "may be important aspects of naturalness in synthesis."
- **Tool:** the paper fully documents the KLSYN88 synthesizer.

**What this means for synthesis.**

- A female voice needs more than raised f0 and formants. It also needs:
  - a larger open quotient (about 3 dB more H1–H2),
  - about 10 dB more spectral tilt,
  - wider F1 bandwidth (about 165 vs 126 Hz),
  - **aspiration noise, which matters most.**
- Hillenbrand & Clark note that Klatt & Klatt observed male-modelled synthesis did not become a convincing female voice from f0 and formant changes alone ([p. 1151](https://link.springer.com/content/pdf/10.3758/APP.71.5.1150.pdf)).
- Hanson & Chuang note that synthetic female speech "tends to sound less natural than synthesized male speech" ([PDF](https://graphics.stanford.edu/~echuang/glottal.pdf)).

### 5.4 What makes a voice sound female or male

- **Hillenbrand & Clark 2009** ([doi 10.3758/APP.71.5.1150](https://doi.org/10.3758/APP.71.5.1150); [PDF](https://link.springer.com/content/pdf/10.3758/APP.71.5.1150.pdf)) resynthesised 25 sentences from men and 25 from women.
  - Shifting both f0 and the spectral envelope changed perceived sex for about 82% of signals in each direction.
  - f0 alone: about 34% of men's sentences were heard as women, and 19% of women's sentences as men.
  - Envelope alone: 19% and 12%.
  - The effects are under-additive: in the women's condition, f0-only plus envelope-only adds up to 31%, against 82% for both together.
  - About 18% of signals kept their original sex even with both shifted, which points to residual cues.
  - With isolated /hVd/ syllables, f0-only shifts worked "almost 22 percentage points" better for men's syllables and "roughly 49" better for women's than with sentences.
  - In their discriminant classifier (Table 1), f0 alone identified sex 95.8% correctly. Raw F1–F3 gave 79.2%, rising to 91.9% when normalised per vowel, and f0 plus F1–F3 gave 96.7%.
- **Coleman 1976** ([doi 10.1044/jshr.1901.168](https://doi.org/10.1044/jshr.1901.168); [abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=AUTHOR:%22Coleman%20RO%22%20AND%20PUB_YEAR:1976&resultType=core&format=json)): in natural speech, f0 correlated very highly with rated maleness/femaleness, and formants less so. With an electrolarynx tone, a 240 Hz female f0 was "a weak indicator" of femaleness when combined with male formants, while a 120 Hz male f0 kept its effect.
- **Gelfer & Mikos 2005** ([doi 10.1016/j.jvoice.2004.10.006](https://doi.org/10.1016/j.jvoice.2004.10.006)) synthesised isolated vowels at 120 and 240 Hz from 10 men, 10 women and 10 trans women. Gender judgments "were based on fundamental frequency, even when fundamental frequency and formant frequency information was contradictory."
- **Skuk & Schweinberger 2014** ([doi 10.1044/1092-4388(2013/12-0314)](<https://doi.org/10.1044/1092-4388(2013/12-0314)>)) used parameter morphing.
  - Cue strength ran: f0, then formant frequencies, then spectrum level.
  - Aperiodicity did not systematically affect gender perception.
  - Morphing f0 and formants together was as effective as morphing everything.
- **Pernet & Belin 2012** ([doi 10.3389/fpsyg.2012.00023](https://doi.org/10.3389/fpsyg.2012.00023)): listeners can categorise gender from pitch alone, but they use pitch "only when timbre information is ambiguous."
- **Leung, Oates & Chan 2018** (meta-analysis of 38 studies, [doi 10.1044/2017_jslhr-s-17-0067](https://doi.org/10.1044/2017_jslhr-s-17-0067)):
  - Speaking f0 explains 41.6% of the variance in perceived gender.
  - Resonance, loudness, articulation and intonation are also associated with it.
  - Tempo and stress are not.
  - Findings on breathiness are mixed, and the risk of bias across studies is high.
- **Gelfer & Schofield 2000** ([doi 10.1016/s0892-1997(00)80092-2](<https://doi.org/10.1016/s0892-1997(00)80092-2>)): trans women who were perceived as female had a higher mean speaking f0 and a higher upper limit of f0. The upper limit correlated with femininity ratings.

**In short.** f0 is the strongest single cue. A convincing change of perceived sex needs f0 and formant scaling together, and source and other residual cues still account for the remaining shortfall.

### 5.5 Vocal tract length (VTL)

- **Fitch & Giedd 1999** ([doi 10.1121/1.427148](https://doi.org/10.1121/1.427148); [abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22Morphology%20and%20development%20of%20the%20human%20vocal%20tract%22&resultType=core&format=json)) used MRI on 129 people aged 2–25.
  - VTL correlates with height and weight.
  - Sex differences in overall length and in the oral/pharyngeal proportions "are not evident in children, but arise at puberty."
  - **I could not fetch its numeric means, and no open-access copy exists according to Unpaywall.**
- **Vorperian et al. 2009** ([doi 10.1121/1.3075589](https://doi.org/10.1121/1.3075589); [PDF](https://pages.stat.wisc.edu/~mchung/papers/vorperian.JASA.2009.pdf)) analysed 605 imaging studies from birth to 19 years.
  - VTL grows non-linearly, by about 2 cm in the first 2 years.
  - Sex differences emerge around age 12, consistent with Fitch & Giedd's "after age 11."
  - Vorperian et al. 2005 ([PDF](https://pages.stat.wisc.edu/~yandell/doc/2005/66.JAcousSocAmer.pdf)) report mean VTL of 8.3 cm at 18 months (about 55% of adult) and 11.4 cm at 6 years (about 75%). They give the classic range as roughly 6–8 cm in infants and 15–18 cm in adult females and males (after Fant 1960).
- **Story, Vorperian, Bunton & Durtschi 2018** ([PMC5966313](https://pmc.ncbi.nlm.nih.gov/articles/PMC5966313/)) give adult VTL as 17.6 cm for men (σ 0.89, range 15.8–18.8) and 15.6 cm for women (σ 1.14, range 14–17.5). The authors say their age curves are "nearly the same as" Vorperian 2009 and Fitch & Giedd 1999.

**Table 5.4. Model VTL by age in cm (Story et al. 2018, Table I)**

| Age (years) | 0    | 2     | 4     | 6     | 8     | 10    | 12    | Adult |
| ----------- | ---- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Male        | 8.47 | 10.75 | 11.63 | 12.32 | 13.02 | 13.75 | 14.51 | 17.6  |
| Female      | 8.43 | 10.36 | 11.38 | 12.07 | 12.66 | 13.25 | 13.84 | 15.55 |

- **Goldstein 1980** (MIT thesis): not fetched. Story et al. describe it only as compiling "growth curves of 19 structures."

### 5.6 Children's f0 and formant scaling

- **Lee, Potamianos & Narayanan 1999** ([doi 10.1121/1.426686](https://doi.org/10.1121/1.426686); [abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%2210.1121/1.426686%22&resultType=core&format=json)) studied 436 children aged 5–17 and 56 adults.
  - The magnitude and within-speaker variability of f0 and formants decrease with age.
  - Male and female f0 and formant patterns begin to separate around age 11 and are fully established around 15.
  - Male formants change roughly linearly with age, which supports uniform axial growth of the vocal tract.
  - There is an "overshoot" between ages 13 and 15.
  - Their 1997 conference abstract places the rapid pubertal drop in male pitch at ages 12–15 ([ASA 133](https://auditory.org/asamtgs/asa97pen/5aSC/5aSC5.html)).
  - **The full text, with f0-by-age values, was not accessible.** A secondary claim that 7-year-olds average 266 Hz (boys) and 275 Hz (girls) could not be verified because the source returned 404, so I left it out.
- **Sorenson 1989** ([abstract](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:2723142%20AND%20SRC:MED&resultType=core&format=json)) studied 30 children aged 6–10 and found about 262 Hz for boys and about 281 Hz for girls, with no significant sex difference.
- From the datasets above:
  - Hillenbrand's children: 236 Hz for boys and 238 Hz for girls; formants about 1.24–1.29× men's.
  - Peterson & Barney's children: 264 Hz; formants about 1.34–1.38× men's.
  - The girls/boys formant ratio in Hillenbrand is above 1 for almost every vowel (Table 5.1 source data; e.g. /ɑ/ F1 is 1039 vs 959 Hz). This fits Vorperian 2005's point that prepubertal formant sex differences may come from "sources other than vocal tract length."
- **Synthesis rule of thumb from these data:**
  - women ≈ men × 1.7 for f0 and × 1.15–1.18 for formants;
  - 10–12-year-olds ≈ men × 1.8 for f0 and × 1.24–1.29 for formants.
  - Scale per vowel or per formant, not uniformly.

**Not verified:** Fitch & Giedd's numeric VTLs, Goldstein 1980, Holmberg's absolute OQ values, Lee et al.'s f0-by-age table, and the original 1952 and 1995 printed tables. The table cells above are my computations from the released datasets.
