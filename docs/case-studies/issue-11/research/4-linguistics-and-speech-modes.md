# Linguistic and paralinguistic modes of speech: what to synthesise and what to recognise

Scope note. This file lists the "modes of speech" a rule-based, physics-based voice simulator (text -> IPA -> articulation plan -> glottal source + vocal-tract waves -> sound) should cover for English, Russian, Hindi and Mandarin Chinese, and the acoustic cues the same system can use when it runs in reverse as a non-neural recogniser.
Research date: November 2026. Facts were checked by opening the cited pages; PDFs were downloaded and their text extracted and searched locally. Numbers without a mark were read in an opened page or PDF.
Marks used: "(search snippet)" = seen only in a search-result summary of the cited page; "(textbook value, not re-checked)" = recalled standard value that was not re-opened; "(unverified)" = could not be confirmed; "(proposal)" = an engineering default suggested here, not a literature value.
Semitone (st) conversions of published Hz or percent values are my own arithmetic: st = 12 \* log2(f2 / f1).
Every URL in the source list was either opened or seen as a search result, and each one answered HTTP 200 when re-checked at the end; nothing was guessed.

## 1. Lexical tone

### 1.1 Mandarin: the four tones and the neutral tone

Chao numerals (1 = lowest, 5 = highest of the speaker's range) from the Standard Chinese phonology article:

| Tone | Pinyin mark | Chao value (variants)               | Shape         | Notes                                                                                                          |
| ---- | ----------- | ----------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| T1   | mā          | 55 (44)                             | high level    |                                                                                                                |
| T2   | má          | 35 (Taiwan 323)                     | mid rising    |                                                                                                                |
| T3   | mǎ          | 214 (Beijing 213 / 212, Taiwan 312) | low / dipping | usually creaky; rise only pre-pausally ("half third tone" elsewhere); with the rise it is significantly longer |
| T4   | mà          | 51 (53 / 52)                        | high falling  |                                                                                                                |
| T0   | ma          | depends on preceding tone           | neutral       | one mora, "about 50% shorter" than a full syllable                                                             |

Measured contours for 8 male Beijing speakers, syllable /ma/ (Xu 1997):

- T1 stays near 130 Hz.
- T2 starts near 110 Hz (-2.9 st re T1), falls slightly, then rises from about 20% into the vowel.
- T3 falls to about 90 Hz at the vowel midpoint (-6.4 st re T1), then rises (in isolation).
- T4 starts near 140 Hz (+1.3 st re T1), peaks about 1/5 into the vowel, then falls sharply.
- Mean syllable durations in isolation: T4 214 ms < T1 247 ms < T2 273 ms < T3 349 ms. Ratio to T1: 0.87 / 1.00 / 1.11 / 1.41.

Neutral tone pitch (Standard Chinese phonology article):

| Preceding tone | Level description | Contour description | After another neutral |
| -------------- | ----------------- | ------------------- | --------------------- |
| T1             | 2                 | 41                  | 21                    |
| T2             | 3                 | 52                  | 32                    |
| T3             | 4                 | 33 ~ 23             | 32                    |
| T4             | 1                 | 21                  | 11                    |

- About 15-20% of syllables in running text are unstressed / neutral (same article).
- In qTA terms the neutral tone is a weak mid target reached slowly (low lambda), so its surface pitch is mostly carry-over from the preceding tone (Xu's group; the lambda value for neutral tone was not re-checked).

### 1.2 Tone sandhi rules (all rule-based, apply at the text -> IPA stage)

- T3 + T3 -> T2 + T3: lǎoshǔ -> láoshǔ. Three-syllable strings depend on bracketing: [bǎoguǎn] hǎo -> báoguán hǎo; lǎo [bǎoguǎn] -> lǎo báoguǎn.
- Half third tone: T3 before any non-T3 syllable is low falling (21) without the rise.
- 不 bù: T2 before T4 (búshì); T4 elsewhere; neutral in A-not-A patterns.
- 一 yī: T2 before T4 (yídìng); T4 before T1 / T2 / T3 (yìtiān, yìnián, yìqǐ); T1 when final, ordinal or a digit; neutral between reduplicated verbs.
- "Tone-2 sandhi" in fast speech: T2 between a T1 / T2 and another full tone becomes high-level-like, 35 35 51 -> 35 54 51; and T4 T4 T4 -> 53 3 51. Under white-noise masking the changed T2 was heard as T1 more than 70% of the time and the changed T4 as T1 more than 50% (same article). Synthesis consequence: these are not symbolic rules but fall out of target undershoot when syllables are short, so the qTA dynamics should produce them.

### 1.3 Tonal coarticulation (Xu 1997)

- Carry-over is assimilatory and large: the onset f0 of the second syllable in /mama/ varies by up to 55 Hz depending on the preceding tone; the spread shrinks to 35 Hz at vowel onset, 17 Hz at vowel midpoint and 7 Hz (T1) / 4 Hz (T2) at offset.
- Anticipatory coarticulation is dissimilatory and small (a low tone raises the preceding f0 peak).
- Design rule: targets are approached during the syllable and best realised at its end; recognition should therefore sample tone features in the second half of the rhyme.

### 1.4 Tone models and which one to invert

| Model                                          | Parameters                                                                                            | Physical basis                                                                                                                          | Automatic inversion                                                                                     | Fit for this project                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| qTA / PENTA (Xu; Prom-on, Xu & Thipakorn 2009) | per syllable: target slope m, height b, rate lambda                                                   | third-order critically damped system approaching a linear target, state (f0, velocity, acceleration) carried across syllable boundaries | yes, analysis-by-synthesis per syllable (qTAtrainer); 3 numbers per syllable                            | best: one mechanism for tone, stress, focus and sentence type                        |
| Fujisaki command-response                      | phrase impulses (Ap, T0), accent / tone steps (Aa, T1, T2), baseline Fb, constants alpha, beta, gamma | two critically damped second-order filters, loosely muscle-based                                                                        | possible but ill-posed (command timing search); tone languages need positive and negative tone commands | good for declination and phrase resets                                               |
| Stem-ML (Kochanski & Shih)                     | soft templates with strengths, solved by optimisation                                                 | effort vs accuracy trade-off                                                                                                            | fitting by optimisation, not unique                                                                     | useful idea (tone "strength"), heavier maths (search snippet)                        |
| Tilt (Taylor 2000)                             | per event: amplitude, duration, tilt                                                                  | none (shape description)                                                                                                                | designed for automatic extraction                                                                       | good as recognition-side event descriptor (search snippet)                           |
| Momel + INTSINT (Hirst)                        | quadratic-spline target points; symbols T M B H S L U D                                               | none                                                                                                                                    | fully automatic stylisation                                                                             | good interchange / debugging layer (search snippet)                                  |
| IPO ('t Hart, Collier, Cohen)                  | straight-line pitch movements on a declination line                                                   | perceptual equivalence                                                                                                                  | manual / semi-automatic close-copy                                                                      | historical; supplies the declination formula in 3.6 (textbook value, not re-checked) |

qTA equations (Prom-on et al. 2009), on a semitone scale, t measured from syllable onset:

- Target: x(t) = m t + b.
- Response: f0(t) = x(t) + (c1 + c2 t + c3 t^2) e^(-lambda t), with c1, c2, c3 fixed by the f0, velocity and acceleration inherited from the previous syllable.
- Mandarin targets (their Table V; b is relative to utterance-onset f0):

| Target | m (st/s)       | b (st)       | lambda (1/s) |
| ------ | -------------- | ------------ | ------------ |
| H (T1) | 0              | 0.0 +/- 1.0  | 54.5 +/- 5.4 |
| R (T2) | 93.4 +/- 3.4   | -2.2 +/- 1.1 | 40.7 +/- 3.8 |
| L (T3) | 0              | -8.9 +/- 0.6 | 34.1 +/- 5.0 |
| F (T4) | -106.4 +/- 3.0 | -2.5 +/- 1.3 | 39.3 +/- 3.2 |

- Resynthesis accuracy: RMSE 0.56 st, r = 0.92 (Mandarin); 0.32 st, r = 0.83 (English). Speaker-independent parameters: 2.24 st, r = 0.77 (Mandarin); 1.68 st, r = 0.77 (English).
- Fujisaki model in its usual form (textbook value, not re-checked): ln F0(t) = ln Fb + sum Ap Gp(t - T0) + sum Aa [Ga(t - T1) - Ga(t - T2)], Gp(t) = alpha^2 t e^(-alpha t), Ga(t) = min[1 - (1 + beta t) e^(-beta t), gamma]. Constants seen in the literature: alpha = 3.0 /s, beta = 20.0 /s, gamma = 0.9 (search snippet, Gu et al. 2004); alpha = 2 /s, beta = 20 /s in another study (search snippet).
- Verdict: qTA is the easiest to invert because the unknowns are local (three numbers per syllable, syllable boundaries come from the segmental recogniser) and the forward model is the same code as synthesis. Use the Fujisaki phrase component only as an optional slow baseline, and Momel-style stylisation as a robust pre-smoother of the raw f0 track.

### 1.5 Creaky voice in tone 3

- T3 is "usually" produced with creaky voice (Standard Chinese phonology article). Synthesis: when the target falls below about -8 st re onset (the L target above), switch the source toward creak (see 5.2). Recognition: irregular pitch periods plus very low f0 inside a long syllable is positive evidence for T3, and is one reason T3 survives in whisper-like conditions (see 5.4).

### 1.6 Tone and pitch accent in other languages (for architecture, not immediate scope)

- Vietnamese: six tones; ngang 33 or 44, huyền 31 or 21 (often breathy), sắc 35 or 45; ngã is high rising with glottalisation in the middle; nặng is short with creaky voice at the end (Tone (linguistics) article). Lesson: a tone slot must be able to carry a phonation feature, not only pitch.
- Thai: five tones (mid, low, falling, high, rising) (same article).
- Cantonese: level and contour tones at three pitch levels (same article); six tones 55, 35, 33, 21, 23, 22 (textbook value, not re-checked).
- Punjabi: lexical pitch that can span whole words (same article); historically from the loss of breathy-voiced stops (textbook value, not re-checked). Relevant because Hindi keeps those stops.
- Japanese: fewer than half of the words have a pitch drop; words contrast by the syllable after which the drop occurs (same article). Swedish and Norwegian: word-level tone ("accent 1 / accent 2"). Serbo-Croatian: four word accents, short / long x falling / rising (textbook value, not re-checked).
- All of these fit a per-syllable (m, b, lambda) target plus an optional phonation flag.

### 1.7 Interchange format for tone

- IPA tone letters: ˥ (U+02E5, 5), ˦ (U+02E6, 4), ˧ (U+02E7, 3), ˨ (U+02E8, 2), ˩ (U+02E9, 1); contours by sequence, for example ˧˥ (35), ˥˩ (51), ˨˩˦ (214) (Tone letter article).
- Reversed tone letters U+A712 to U+A716 mark sandhi (surface) tones; dotted tone letters U+A708 to U+A70C mark neutral-tone pitch (same article). This gives a clean way to keep both the lexical tone and the realised tone in one transcription.
- IPA diacritics: acute = high, macron = mid, grave = low, caron = rising, circumflex = falling, double acute / double grave = extra high / extra low; downstep ꜜ and upstep ꜛ (Tone (linguistics) article).
- Recommended: tone letters after the syllable for Mandarin (ma˥, ma˧˥, ma˨˩˦, ma˥˩), dotted letter for neutral, reversed letters for sandhi output; diacritics for pitch-accent and register-tone languages.

## 2. Stress and rhythm

### 2.1 English lexical stress

- Fry (1955, 1958): duration and intensity both cue stress, duration more strongly; f0 outweighs both, and it is the direction of the f0 step, not its size, that matters; cue ranking f0 > duration > intensity > vowel quality (search snippet via Cutler 2005).
- Sluijter & van Heuven (1996): when stress is separated from pitch accent, the intensity difference is concentrated above 0.5 kHz (spectral balance, i.e. flatter source tilt from more abrupt glottal closure); duration is the most reliable correlate, spectral balance close behind, overall intensity and vowel quality poorest (search snippet). Exact dB values per band: (unverified).
- Eriksson, Thunberg & Traunmüller (2001) use the same idea as "spectral emphasis" (overall level minus level of the low-pass f0 band) and note that an increased pitch range is not a concomitant of increased vocal effort.
- qTA English values (Prom-on et al. 2009): stressed syllables have target height b about 1-4 st above unstressed; sentence-final monosyllable fall m = -90.2 st/s, b = -4.3 st, lambda = 38.4 /s.
- Synthesis drivers: (a) duration scale of the stressed rhyme, (b) subglottal pressure up slightly and closing phase sharper (LF Ra down) for spectral balance, (c) full vowel target versus reduced (schwa-like, undershoot) target, (d) pitch target only when the word carries a pitch accent.

### 2.2 Russian stress and vowel reduction

- Two degrees of reduction (Vowel reduction in Russian article). After hard consonants /a, o/ -> [ɐ] in the first pretonic syllable and word-initially (паро́м [pɐˈrom]) and -> [ə] elsewhere (о́блако [ˈobləkə]) (akanye). After soft consonants /a, o, e/ -> [ɪ] (ikanye; семена́ [sʲɪmʲɪˈna]). /u/ -> [ʊ] / [ʊ̈], /i/ -> [ɪ] / [ɨ]-like reduced variants. The stressed vowel is normally the longest.
- Russian stress is primarily durational and qualitative, not pitch-based; duration pattern "stressed : first pretonic : other unstressed" roughly 3 : 2 : 1 (Potebnja's formula) (textbook value, not re-checked).
- Stress position is lexical and unpredictable from spelling: the text front end needs a stress dictionary or stress marks (acute accent or "+" convention) in the input.
- Recognition: vowel duration ratio within the word plus vowel quality ([a] versus [ɐ] versus [ə]); f0 is unreliable because intonation (IK centres, section 3.3) sits on stressed syllables of only some words.

### 2.3 Hindi stress, schwa deletion and phrasing

- Stress is predictable from syllable weight, but accounts disagree; Ohala found no consistent pitch or duration correlate and argued Hindi has no lexical stress, only pragmatic stress; other studies found duration useful, formants weak; Dyrud (2001) found an LH pitch contour and duration (review, arXiv 1705.03247).
- Intonation unit: each non-final content word (prosodic word) carries a rising LH contour, successive rises are downstepped, the final word falls; focus is marked mainly by post-focal compression (Harnsberger 1994; Patil et al. 2008; search snippets). Féry (2010) analyses these as phrase tones, not word pitch accents (search snippet).
- Schwa deletion: the inherent vowel written by Devanagari is deleted by the rule ə -> ∅ / VC_CV and obligatorily word-finally: रचना /rətʃnɑː/, राम /raːm/, वेद /ʋeːd̪/. The simple rule is right about 89% of the time (Schwa deletion in Indo-Aryan languages article), so an exception list is required.
- Synthesis default: low target at the start and high target at the end of each non-final prosodic word (rise size 3-5 st, proposal), weight-based slight lengthening, no vowel reduction.

### 2.4 Mandarin rhythm

- Listed as syllable-timed (Isochrony article); full-tone syllables are near-equal in length, modulated by tone (1.1) and by neutral-tone shortening (about 50%).
- In the Grabe & Low PVI space (18 languages, one speaker each) Mandarin appears among the low vocalic-nPVI languages; the exact value could not be read from the figure (unverified; commonly quoted as about 27).

### 2.5 Boundaries and rhythm metrics

- Pre-boundary lengthening is confined to the rhyme of the syllable before the boundary, and its amount distinguishes at least four boundary strengths (Wightman et al. 1992, search snippet). Synthesis: lengthen the final rhyme by a factor that grows with break strength, for example x1.1 / x1.2 / x1.4 / x1.6 for break indices 1-4 (proposal).
- nPVI = 100 \* mean over successive vocalic intervals of |d_k - d_k+1| / ((d_k + d_k+1) / 2) (textbook value, not re-checked). Across three studies nPVI-V ranged 63-73 for standard southern British English and 30-42 for Castilian Spanish (search snippet, PMC2790788).
- %V (share of utterance duration that is vocalic) and delta-C (standard deviation of consonantal intervals) separate rhythm classes in Ramus's data but are sensitive to speech rate and corpus (Ramus 2002). Numeric %V per language: (unverified).
- Use: these are cheap regression tests for the synthesiser ("English output should have nPVI-V above about 55, Mandarin and Hindi below about 45", proposal) and weak language / accent cues for recognition.

## 3. Intonation and sentence modes

### 3.1 English with ToBI

- Inventory (ToBI article): pitch accents H*, L*, L*+H, L+H*; phrase accents H-, L-; boundary tones H%, L%; break indices 0-4.
- Sentence modes as tunes (first two rows from the ToBI article; the rest are standard analyses, textbook value, not re-checked):

| Mode                        | Tune                                                 | Realisation hints                                                     |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| declarative                 | H\* L-L%                                             | final fall; qTA final fall m = -90 st/s, b = -4.3 st                  |
| yes/no question             | L\* H-H%                                             | low nucleus, rise to top of range; start with +6 to +10 st (proposal) |
| wh-question                 | H\* L-L% (question word accented)                    | high start, fall like a statement                                     |
| echo / incredulous question | L+H* ... L* H-H%                                     | expanded range, higher H%                                             |
| tag question                | statement + L* H-H% (asking) or H* L-L% (confirming) | separate short phrase                                                 |
| continuation / list item    | H* L-H% or H* H-L% (plateau)                         | small rise or level, weak break                                       |
| list final item             | H\* L-L%                                             | full fall                                                             |
| command                     | H\* L-L%, higher onset, steeper fall                 | plus effort (section 4)                                               |
| exclamation                 | L+H\* L-L% with expanded range                       | plus lengthening                                                      |
| parenthetical               | compressed range, lowered register, faster           | -2 to -3 st register, range x0.5 (proposal)                           |
| contrastive focus           | L+H\* on focus, deaccenting after                    | qTA: on-focus b +2.9 st, post-focus b -1.9 to -2.9 st                 |

### 3.2 Focus and emphasis (numbers that transfer across languages)

- Mandarin (Prom-on et al. 2009, Table VI): on-focus H +2.3 st; R slope +11.8 st/s and +0.6 st; L -2.4 st (the low gets lower); F slope -6.7 st/s and +1.2 st. Post-focus: H -5.6 st, R -4.1 st, L -4.1 st, F -2.8 st.
- English: on-focus stressed b +2.9 st; post-focus -1.9 to -2.9 st.
- So focus = expand the pitch range on the focused word (highs up, lows down), lengthen it, raise effort, and compress and lower everything after it. Hindi mainly uses the post-focal compression half (2.3).

### 3.3 Russian intonation constructions (Bryzgunova)

Each IK has a centre (the stressed syllable of the most important word), a pre-centre and a post-centre part. Rows marked \* were confirmed in search snippets of Russian sources; the others are the standard textbook descriptions (textbook value, not re-checked). Rise / fall sizes are proposals for a first implementation.

| IK      | Pre-centre           | Centre                                                   | Post-centre                  | Typical use                                      | Starting values (proposal)                               |
| ------- | -------------------- | -------------------------------------------------------- | ---------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| IK-1 \* | mid                  | calm fall                                                | below mid                    | statement                                        | fall 4-6 st                                              |
| IK-2 \* | mid, small movements | fall or level with stronger stress                       | below mid                    | wh-question, address, demand                     | fall 4-6 st, +3 dB on centre                             |
| IK-3 \* | mid                  | sharp rise within the stressed vowel                     | low (fall immediately after) | yes/no question; non-final phrase                | rise 7-10 st in under 150 ms, then drop below pre-centre |
| IK-4    | mid                  | fall-rise (low then rising)                              | high, above mid              | "А вы?" questions, lists, official non-final     | dip 3 st, rise 5-7 st                                    |
| IK-5    | mid                  | two centres: rise on first, high plateau, fall on second | below mid                    | exclamatory evaluation ("Какой сегодня день!")   | rise 6 st, plateau, fall 8 st                            |
| IK-6    | mid                  | rise                                                     | stays high                   | elevated non-final, evaluation, puzzled question | rise 5-7 st, hold                                        |
| IK-7 \* | mid                  | rise ended by a glottal closure                          | low                          | expressive negation / evaluation                 | rise 6 st + glottal stop                                 |

- Russian yes/no questions have no special word order or particle in most cases, so IK-3 is the only cue: the question mark must select IK-3 and the centre must be placed on the queried word (default: the predicate / last content word).
- The IK descriptions are qualitative (tone level relative to mid, movement direction), so the numeric shapes above need tuning by ear.

### 3.4 Hindi

- Statements: repeated downstepped LH rises, final fall (2.3). Yes/no questions: same rises plus a final high boundary; optional initial particle क्या; wh-questions: wh-word focused, final fall (textbook value, not re-checked).

### 3.5 Mandarin: intonation on top of tone

- Questions raise global f0 and reduce the declination slope; the final tone is strengthened rather than replaced: a final T2 rises more steeply and ends higher, a final T4 starts higher and ends higher (a flattened fall). A boundary tone is not required to model the difference (Yuan, summarised in Xu & Mok 2014; Yuan, Shih & Kochanski 2002 describe this as a higher phrase curve plus higher strength of final tones, search snippet).
- Perception is asymmetric: statements are easier to identify than questions, and question identification depends on the final tone (Xu & Mok 2014 report, for example, 78% for complete T3-final questions and 51% for cut-off T4-final questions).
- Sentence-final particles carry much of the load and are neutral-tone syllables: 吗 ma (yes/no question), 呢 ne, 吧 ba (suggestion), 啊 a (exclamation) (textbook value, not re-checked). Text front end: a particle question (吗) needs little or no global raise; an unmarked question ("?" without particle) needs the global raise plus final-tone strengthening.
- Synthesis rule: question = baseline +2 to +4 st growing toward the end, declination slope halved, final syllable target strength (lambda) and height increased (proposal consistent with the findings above).

### 3.6 Declination and pitch reset

- IPO declination line: slope D = -11 / (t + 1.5) st/s for utterances up to 5 s, total drop about 8.5 st for longer ones ('t Hart, Collier & Cohen 1990) (textbook value, not re-checked).
- Schröder et al. (2001), regression constants for the Belfast Naturalistic Emotion Database (spontaneous English): f0 range constant 27.8 Hz (female) and 21.6 Hz (male); slope of f0 rises 74.6 Hz/s (female) and 60.7 Hz/s (male) at neutral activation.
- Reset: f0 baseline returns (partly) to its starting value at each major phrase boundary; the reset size cues boundary strength. In Fujisaki terms each phrase command restarts the phrase component; in qTA terms declination emerges from post-focus lowering and a falling target at the end.

## 4. Loudness and vocal effort

### 4.1 Measured effects

- Liénard & Di Benedetto (1999), 10 speakers, French vowels, speaker-to-listener distances 0.4 / 1.5 / 6 m: f0 rises about 5 Hz per dB of level, F1 about 3.5 Hz per dB; F2 and F3 do not change significantly; for +10 dB overall, the amplitudes of F1 / F2 / F3 rise by 11 / 12.4 / 13 dB (the spectrum flattens by roughly 2 dB between F1 and F3 per 10 dB).
- Traunmüller & Eriksson (2000), distances 0.3-187.5 m, men, women and 7-year-olds, phonated and whispered: vowel duration, f0 and F1 are all substantially affected, and several effects of whispering resemble those of increased effort (abstract, search snippet). Their per-doubling numbers: (unverified).
- Related: voice power level rises 1.3-2.2 dB and mean f0 about 3.8 Hz per doubling of speaker-listener distance (Pelegrín-García and colleagues, search snippet).
- Subglottal pressure (Titze and colleagues, search snippets): SPL rises 8-9 dB per doubling of excess lung pressure over phonation threshold (6-9 dB per doubling of lung pressure); f0 rises 2-6 Hz per cm H2O; SPL also rises about 8-9 dB per octave of f0.
- Lombard effect (speech in noise): higher intensity and f0, flatter spectral tilt, longer vowels (content words more than function words), F1 shifts (Lombard effect article; no numbers there).
- Burkhardt & Sendlmeier (2000): stressed syllables +9 dB in hot anger.

### 4.2 Synthesis preset table (derived from the numbers above; levels are proposals)

| Effort level | Level re normal    | Subglottal pressure                                | f0 shift                | F1 shift      | Source tilt                                       | Vowel duration                         | Other                                        |
| ------------ | ------------------ | -------------------------------------------------- | ----------------------- | ------------- | ------------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| whisper      | about -25 dB (5.4) | low, glottis open                                  | none (no voicing)       | +255 Hz (5.4) | noise source                                      | x1.3                                   | section 5.4                                  |
| soft         | -10 dB             | x0.45                                              | -50 Hz (cap at -4 st)   | -35 Hz        | steeper by about 2 dB F1-F3; more breathy (Rd up) | x1.0                                   | small posterior chink                        |
| normal       | 0 dB               | 1 (about 8 cm H2O, textbook value, not re-checked) | 0                       | 0             | reference                                         | x1.0                                   |                                              |
| loud         | +10 dB             | x2.2                                               | +50 Hz                  | +35 Hz        | flatter by about 2 dB F1-F3; Rd down              | x1.1                                   | wider jaw opening                            |
| shouted      | +20 dB             | x4.6                                               | +100 Hz (cap at +12 st) | +70 Hz        | flatter by about 4 dB; pressed                    | x1.3 vowels, consonants not lengthened | reduced f0 range in Hz terms is not required |

- Pressure multipliers use 9 dB per doubling: factor = 2^(dB / 9). In a physical model F1 rises by itself if the jaw opens with effort; the Hz/dB slopes are checks, not separate controls.
- Crescendo / decrescendo: ramp the effort level linearly in dB over the marked span (extIPA has crescendo-type labels, section 8); rate of 5-10 dB/s is comfortable (proposal).

## 5. Phonation types and voice qualities

### 5.1 The continuum and its measures

- Phonation types lie on a glottal-aperture continuum: voiceless (open) - breathy - modal - creaky - glottal closure (Gordon & Ladefoged). Breathy voice has the steepest spectral tilt (most energy loss at high frequencies), creaky voice the least; open quotient correlates with H1-H2; non-modal phonation tends to lower f0; creak has irregular pitch periods (same source).
- Across Gujarati, White Hmong, Jalapa Mazatec and Southern Yi, only H1*-H2* distinguishes the phonation categories in all four languages; CPP and H1*-An* help in some (Keating et al. 2011).
- Gujarati vowels: H1-H2 about 12.5 dB (very breathy), 8.3 (breathy), 6.7 (slightly breathy), 0 dB (not breathy) (Bickley, via search snippet of Esposito 2012). Listeners discriminate breathy from clear vowels at about 75% when H1 is raised by about 9 dB (Bickley, cited in Langmeier 1991).
- LF model parameters (Ní Chasaide & Gobl 1995): EE excitation strength (negative peak of flow derivative), RA return phase (larger = steeper spectral slope, more breathy), RK pulse skew, RG glottal formant, OQ open quotient. An ideal abrupt-closure source spectrum falls at -12 dB/octave.
- Single-knob control Rd (Fant; equations as given in Wang & Gobl 2023): Rd = (Up / Ee) \* f0 / 0.11 (so Rd equals the declination time in ms at f0 = 110 Hz); predicted Rk = 0.118 Rd + 0.224; predicted Ra = 0.048 Rd - 0.01; valid up to Rd = 2.7; low Rd = tense, high Rd = lax / breathy. OQ = (1 + Rk) / (2 Rg) (search snippet). Typical anchors Rd about 0.3 pressed, 1.0 modal, 2.7 breathy (textbook value, not re-checked).

### 5.2 Preset table for voice qualities

Rd, OQ and noise values are textbook-style starting points (textbook value, not re-checked) unless a source is named; H1-H2 anchors follow the Gujarati data above.

| Quality (VoQS symbol) | Glottal configuration                                 | Source settings                                                    | f0                     | Expected acoustic signature                                                             |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------- |
| modal (V)             | full membranous vibration, complete closure           | Rd 1.0, OQ 0.5-0.6                                                 | free                   | H1-H2 near 0-4 dB, high HNR / CPP                                                       |
| breathy (V̤)           | incomplete closure, posterior chink, low tension      | Rd 2.0-2.7, OQ 0.7-0.9, aspiration noise -20 to -10 dB re voicing  | slightly lower         | H1-H2 7-12 dB, steep tilt, noise above 2 kHz, wider F1 bandwidth                        |
| whispery voice (Ṿ)    | cartilaginous glottis open, membranous part vibrating | Rd 1.5-2.0 plus strong aspiration noise                            | free                   | voicing plus strong noise; lower CPP                                                    |
| whisper (W)           | folds abducted / arytenoids apart, no vibration       | noise source only; glottal area about 40 mm2                       | none                   | see 5.4                                                                                 |
| creaky / fry (V̰, C)   | strong adduction, thick slack folds, low flow         | Rd 0.3-0.6, OQ 0.2-0.4, jitter 5-15%, period doubling, f0 20-70 Hz | very low, irregular    | H1-H2 below 0 dB, visible separate pulses, F1 slightly raised (+45 Hz, Swerdlin et al.) |
| falsetto (F)          | thin stretched folds, incomplete closure              | Rd 2.0+, near-sinusoidal flow, little energy above H2              | high (often +1 octave) | steep tilt, few harmonics, some breath noise                                            |
| harsh (V!)            | high medial compression, irregular vibration          | Rd 0.3-0.5, jitter and shimmer up, noise bursts                    | often raised           | low HNR with flat tilt                                                                  |
| tense / pressed (V͈)   | high adduction and tension                            | Rd 0.3-0.6, OQ 0.3-0.4, sharp closure (Ra small)                   | slightly raised        | flat tilt, strong F2-F4, H1-H2 below 0                                                  |
| lax / slack (V͉)       | low adduction and tension                             | Rd 1.5-2.0                                                         | slightly lowered       | steeper tilt, lower intensity                                                           |

- Burkhardt & Sendlmeier implement "tense 50%" and "breathy 50%" as interpolations, which supports a continuous Rd-like knob rather than discrete switches.

### 5.3 Hindi four-way stop contrast, glottal stop and creak

- Hindi contrasts voiceless unaspirated, voiceless aspirated, voiced and breathy-voiced ("voiced aspirated") stops and affricates, each written with its own Devanagari letter (क ख ग घ ...).
- VOT separates voiceless unaspirated / aspirated / voiced, but not voiced from breathy-voiced; the breathy-voiced release is followed by a breathy interval (reported about 100 ms in one study) with lowered f0 and a drop in overall intensity; H1-H2 is the best discriminator (search snippets; Dutta's dissertation is the fuller source, not opened). Lisker & Abramson's values of about -75 ms (/g/) and -89 ms (/gʱ/) voicing lead were seen only in an ambiguous snippet (unverified).
- Langmeier (1991, Gujarati final stops): the H1 level difference between voiced and breathy groups is about 3 dB; closure duration helps only for some places.
- Synthesis plan for /bʱ dʱ ɖʱ gʱ dʒʱ/: voiced closure (prevoicing), release, then 60-100 ms of breathy phonation (Rd toward 2.5, posterior chink open, aspiration noise on, f0 dip 1-2 st) merging into the modal vowel (durations are proposals around the 100 ms figure). Voiceless aspirates: 60-90 ms of voiceless aspiration after the burst (textbook value, not re-checked).
- Glottal stop [ʔ] and creak: full adduction for 30-80 ms, often realised as a few irregular low-f0 pulses rather than silence (textbook value, not re-checked). Needed for English (uh-oh, t-glottalling in some accents), IK-7 in Russian, Mandarin T3, and vowel-initial emphasis.

### 5.4 Whisper in detail

Production and physics:

- The vocal folds do not vibrate; turbulence is generated at the glottis, classically with the folds abducted and a gap between the arytenoids; supralaryngeal articulation is unchanged (Whispering article).
- Resonance shifts measured in the same vocal gesture (Swerdlin, Smith & Wolfe 2010): whispering raises R1 by 255 +/- 90 Hz, R2 by 115 +/- 105 Hz, R3 by 125 +/- 125 Hz and R4 by 75 +/- 120 Hz. Averaged over vowels R1 is x1.45 and R2 x1.09. A one-dimensional tract model explains the shift by the larger glottal opening: effective glottal area about 40 +/- 30 mm2 in whisper. Jovičić (1998, Serbian) found similar shifts except a decrease for /u/; the shifts are similar to or somewhat larger than those of Kallail & Emanuel (1984) and Matsuda & Kasuya (1999) (all as summarised by Swerdlin et al.; original tables not opened).
- Mandarin, whisper versus phonated (Jiao & Xu 2019): syllable duration 508.7 vs 384.7 ms (x1.32); intensity 41.1 vs 66.0 dB (25 dB lower); spectral centre of gravity 1229 vs 548 Hz; Hammarberg index 11.6 vs 21.2 dB (flatter spectrum); F1 779 vs 511 Hz, F2 1821 vs 1525 Hz, F3 3106 vs 2760 Hz.
- Low formants shift more than high formants; spectrum is flatter (Ghaffarzadegan, Bořil & Hansen 2016). An earlier study of English vowels found no consistent F1 shift (as cited by Carlin et al. 2006), so the shift should come out of the physical model, not be applied as a fixed offset.

Physical synthesis recipe:

- Set vocal-fold oscillation off; open the glottis (posterior chink or whole glottis, area 20-70 mm2) so the tract's glottal end becomes a partly open termination coupled to the subglottal system. This alone raises F1 most and higher formants less, as measured.
- Inject band-limited turbulence noise at the glottal constriction with amplitude following flow and constriction area; overall level about 20-25 dB below voiced speech.
- Keep all supraglottal gestures; lengthen segments by about 1.3; keep the intensity contour of the intended prosody (it becomes the main prosodic carrier).
- Voicing contrasts: preserve the secondary cues (longer preceding vowel before "voiced" obstruents, weaker / shorter frication and burst, shorter closure for voiced stops) (textbook value, not re-checked), since voicing itself is gone.

Whispered Mandarin tones:

- Tone identification in whisper 49.9% versus 96.4% phonated (chance 25%); T3 84.5% and T4 60.2% are well above chance, T1 and T2 near chance. Cues: T3 = longest duration and a two-peak (bimodal) intensity profile; T4 = short with an early amplitude drop. Speakers did not enhance these cues in whisper, and amplitude-modulated noise carrying only the envelopes gives similar identification (Jiao & Xu). Earlier work: spectral envelope also contributes (Kong & Zeng 2006, search snippet).
- Whispered questions were recognised below chance in one study (search snippet). So synthesis should keep duration and amplitude contours of each tone exactly as in voiced speech, and recognition must fall back on lexical context for T1 / T2.

Recognition cues for whisper (Carlin et al. 2006): energy ratio (energy above 2.5 kHz divided by energy below 1 kHz) is high in whisper, and the autocorrelation peak of the LPC residual (periodicity) is absent; these two features gave 97.5% correct detection of whispered segments in speech sampled at 8 kHz.

## 6. Emotion and attitude

### 6.1 What the literature agrees on

- Meta-analytic pattern (Juslin & Laukka 2003, as summarised in Pell et al. 2009): sadness = low f0, slow rate; anger, fear, happiness = moderate or high mean f0 and fast rate; anger and happiness = high f0 variability; fear and sadness often less f0 variability; disgust sometimes low mean f0 (Banse & Scherer 1996).
- Banse & Scherer (1996): highest f0 mean and energy for hot anger, panic fear, elation and despair (via Schröder 2001). Their full tables were not opened.
- Rule-based synthesis with published presets is recognised at 44-94% depending on the emotion (rates listed under the table in 6.2); unit selection from emotion-specific databases reaches 50-80% (Schröder 2001 review).
- Cross-language (Pell et al. 2009; English, German, Hindi, Arabic pseudo-utterances; f0 normalised as (value - resting f0) / resting f0, so 1.0 = one octave above the speaker's resting frequency):

| Emotion   | f0 mean En / Hi | f0 range En / Hi | Rate syl/s En / Hi |
| --------- | --------------- | ---------------- | ------------------ |
| neutral   | 0.24 / 0.24     | 0.59 / 0.67      | 4.75 / 5.15        |
| anger     | 0.72 / 1.25     | 1.39 / 1.86      | 3.91 / 6.39        |
| disgust   | 0.33 / 0.75     | 0.86 / 1.56      | 3.20 / 4.42        |
| fear      | 1.16 / 1.55     | 1.21 / 1.26      | 5.58 / 6.19        |
| sadness   | 0.36 / 0.41     | 0.72 / 0.75      | 3.91 / 4.08        |
| happiness | 0.49 / 0.95     | 1.01 / 1.65      | 4.41 / 4.92        |
| surprise  | 1.80 / 1.44     | 2.86 / 1.84      | 4.44 / 5.43        |

- The direction of the changes is shared across the four languages, the sizes are not (anger is slow in this English set, fast in Hindi). Listener recognition in the English set: sadness 91%, anger 88%, fear 87%, happiness 80%, neutral 76%, disgust 76%, surprise 72%. A discriminant analysis using only f0 mean, f0 range and rate classified 58% of the English items: fear 87%, surprise 86%, disgust 73%, neutral 68%, but only 40% sad, 35% anger and 20% happy. This is the honest ceiling for a three-cue rule-based emotion recogniser; voice quality and intensity are needed for the rest.

### 6.2 Preset table (deltas relative to the neutral voice)

Sources: B = Burkhardt & Sendlmeier 2000 (German, formant synthesiser emoSyn); C = Cahn 1990 Affect Editor settings on a -10..+10 scale; M = Murray & Arnott (British English); Mz = Mozziconacci (Dutch) - C, M, Mz as tabulated in Schröder 2001. Semitone equivalents in brackets are my conversions.

| Emotion                | f0 mean               | f0 range        | Rate                                 | Level                    | Voice quality                      | Articulation and contour                                                                                               | Source                                                      |
| ---------------------- | --------------------- | --------------- | ------------------------------------ | ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| hot anger              | +50% (+7 st)          | +200%           | +30%                                 | stressed syllables +9 dB | tense 50%                          | falling contours 30 st/s; vowel overshoot 30% stressed, undershoot 20% unstressed                                      | B                                                           |
| anger (alt.)           | +10 Hz                | +9 st           | +30 words/min                        | +6 dB                    | laryngealisation +78%              | F4 -175 Hz; stressed-vowel pitch +10 / 20 / 40% of range                                                               | M                                                           |
| cold anger             | -20% (-3.9 st)        | +100%           | (as hot anger, not restated)         | -                        | tense                              | -                                                                                                                      | B                                                           |
| joy / elation          | +50% (+7 st)          | +100%           | +30%                                 | -                        | modal or tense                     | lip spreading: F1 / F2 +10%; rising contours 50 st/s; "wave" contour, main stressed syllables +100%, between them -20% | B                                                           |
| quiet happiness        | 0                     | -               | -20%                                 | -                        | modal                              | lip spreading                                                                                                          | B                                                           |
| sadness (quiet sorrow) | -20% (-3.9 st)        | -20%            | -40%                                 | lower                    | breathy 50%                        | -                                                                                                                      | B                                                           |
| sadness (alt.)         | 0, reference line -1  | -5              | -10                                  | -5                       | breathiness +10, brilliance -9     | fluent pauses +5, hesitation pauses +10, precision -5, less final lowering -5                                          | C                                                           |
| crying despair         | +100% (+12 st)        | -20%            | -20%                                 | -                        | breathy / falsetto 50%, f0 flutter | -                                                                                                                      | B                                                           |
| fear                   | +150% (+15.9 st)      | +20%            | +30%                                 | -                        | falsetto, f0 flutter (jitter)      | final rise 30 st/s                                                                                                     | B                                                           |
| surprise               | 0, reference line -8  | +8              | +4                                   | +5                       | brilliance -3                      | contour slope +10, accent shape +5, fewer pauses                                                                       | C                                                           |
| boredom                | -20% (-3.9 st)        | -50%            | -20%; stressed syllables +40% longer | -                        | lax                                | imprecise articulation (undershoot)                                                                                    | B                                                           |
| boredom (alt.)         | final f0 65 Hz (male) | excursions 4 st | duration 150%                        | -                        | -                                  | -                                                                                                                      | Mz                                                          |
| disgust                | low (near neutral)    | slightly up     | slow: 3.20 vs 4.75 syl/s (x0.67)     | -                        | creaky / pressed (unverified)      | lengthened stressed vowels (unverified)                                                                                | Pell et al.                                                 |
| tenderness             | low                   | narrow          | slow                                 | soft                     | breathy / lax                      | -                                                                                                                      | (unverified; direction per Juslin & Laukka, not re-checked) |
| contempt               | low                   | narrow          | slow                                 | soft-normal              | tense, nasalised (unverified)      | final lowering                                                                                                         | (unverified)                                                |
| irony / sarcasm        | lower                 | reduced         | slower                               | -                        | -                                  | lengthened stressed syllable, nasalisation, mismatch between tune and text                                             | (unverified; language-specific)                             |

- Recognition rates of these presets: joy 81% (9 choices), Cahn's sadness 91% (6 choices), fear 52% (9), surprise 44% (6), boredom 94% (7) (Schröder 2001 review). Fear and surprise are the weak ones.

### 6.3 Dimensional control: activation, evaluation, power

- Schröder et al. (2001) regressed acoustic measures of a natural emotional-speech database on activation A, evaluation E and power P (each about -100..+100). Female f0 median = 193.4 + 0.357 A + 0.00439 A^2 + 0.00245 E^2 - 0.215 P + 0.00096 P^2 Hz (their "angry" point gives 222.3 Hz); male f0 median constant 140.3 Hz with 0.452 Hz per unit A.
- f0 range grows by 0.225 (f) / 0.248 (m) Hz per unit A from 27.8 / 21.6 Hz; pause duration 0.407 (f) / 0.377 (m) s shrinking with A; slope of f0 rises 74.6 (f) / 60.7 (m) Hz/s growing by about 0.34-0.47 per unit A; spectral slope -7.53 (f) / -7.92 (m) dB/octave becoming flatter by about 0.011 (f) / 0.010 (m) dB/octave per unit A.
- Example coordinates (A, E, P): sad (-8.5, -42.9, -55.3), angry (34.6, -34.9, -33.7), afraid (31.1, -27.1, -79.4), happy (28.9, 39.8, 12.5).
- Reading: activation is the acoustically robust dimension (f0 level, range, tempo, intensity, flatter tilt); evaluation (valence) is weakly encoded and needs voice quality, smile and contour shape; low power raises f0 and flattens the slope. A good architecture is therefore: continuous A / E / P sliders mapped by these linear rules, plus named presets (6.2) for categorical requests.
- EmotionML already offers both views (categories and dimensions, values 0..1), see section 8.

## 7. Other modes and vocal events

| Mode / event                     | What changes (verified facts first)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Synthesis handle                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| speaking rate                    | neutral pseudo-utterance rates: English 4.75, German 3.91, Hindi 5.15, Arabic 5.57 syl/s (Pell et al. 2009); conversational about 200 words/min, clear speech about 100 words/min (Picheny et al., search snippet)                                                                                                                                                                                                                                                                                                                                                                                                     | global time scale; shorten vowels and pauses more than consonants; faster rate = more target undershoot (falls out of gesture dynamics)                                                                                                            |
| clear vs casual (Lindblom's H&H) | clear speech: slower, more and longer pauses, more energy at higher frequencies, larger temporal modulation, larger vowel space, changed VOT and burst release; trained talkers can produce clear speech at normal rate, so it is not only rate (search snippets)                                                                                                                                                                                                                                                                                                                                                      | "articulation precision" knob: gesture stiffness / target overshoot (Burkhardt: 30% overshoot stressed, 20% undershoot unstressed), release bursts always realised, effort +3 to +6 dB                                                             |
| laughter                         | series of repeated syllables on a staccato outward breath, each an aspirated "h"-like fricative plus a vowel, mostly central vowels; f0 higher than in speech: study mean 199 Hz (male) and 476 Hz (female); means across studies 160-502 Hz (male) and 126-424 Hz (female) as quoted; extremes up to 1245 Hz (male) and 2083 Hz (female); mean F1 728 Hz (male) and 924 Hz (female), against 535 / 653 Hz in Bachorowski et al. 2001; F1 up to 1300-1500 Hz (Szameitat et al. 2007). Bachorowski et al. 2001: 1024 bouts from 97 adults, highly variable, many unvoiced grunt- and snort-like laughs (search snippet) | bout = 3-8 calls (proposal); each call about 100 ms voiced vowel + 100 ms aspiration (about 5 calls/s, textbook value, not re-checked); f0 and amplitude decline over the bout; open jaw, central vowel; unvoiced variant = aspiration pulses only |
| sigh, audible breath             | no numbers verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | inhalation: reversed (ingressive) glottal noise through open glottis and neutral or upcoming-vowel tract, 300-700 ms, placed at major breaks; sigh: long breathy falling exhalation (proposal)                                                     |
| hesitation, filled pause         | English uses a schwa-like vowel, "um" = vowel + [m] and is longer than "uh"; f0 is low and flat or falls 5-20 Hz; boundary-position fillers start higher; successive fillers start successively lower (search snippets: Shriberg and others)                                                                                                                                                                                                                                                                                                                                                                           | "uh" [ə(ː)] / "um" [əm], Russian "э-э", Mandarin "呃 / 那个", Hindi "अ..."; 250-500 ms (proposal), low level target, slight creak at the end; also lengthening of the previous syllable                                                            |
| cough, throat clearing           | not researched (optional); extIPA writes such noises in double parentheses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | glottal closure, pressure build-up, burst release into open tract, 1-3 pulses (proposal)                                                                                                                                                           |
| smiling voice                    | smiling raised f0 and formant frequencies for all speakers, amplitude / duration for some (Tartter 1980, search snippet); later studies disagree on which formants (search snippet); synthesis practice: F1 / F2 +10% (Burkhardt & Sendlmeier)                                                                                                                                                                                                                                                                                                                                                                         | spread lips (shorter front cavity) in the area function; slight f0 raise                                                                                                                                                                           |
| yawning voice                    | VoQS marks lowered larynx and open jaw; acoustics (unverified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | lengthen pharynx (larynx down), open jaw: all formants down, slow rate, breathy                                                                                                                                                                    |
| singing / chant                  | vibrato rate 5-7 Hz; extent usually below +/- 1 semitone for soloists, about +/- 0.1 semitone in choirs (Vibrato article, citing Sundberg); typical operatic 50-150 cents (search snippet). Singer's formant: cluster of F3-F5, centre 2.2-3.8 kHz depending on voice (search snippet)                                                                                                                                                                                                                                                                                                                                 | hold note targets (m = 0), vibrato depth and rate on existing vibrato control, lengthen vowels, lowered larynx / wide pharynx to cluster F3-F5; chant = fixed f0 per phrase with flat declination                                                  |
| child-directed speech            | higher and wider pitch, slower rate, shorter utterances, more pauses, hyperarticulated corner vowels /i u a/ (Baby talk article; Fernald 1985). No numbers there                                                                                                                                                                                                                                                                                                                                                                                                                                                       | f0 +3 to +6 st, range x1.5-2, rate x0.8, vowel-space expansion, longer pauses (proposal)                                                                                                                                                           |
| speaker age and size             | men: f0 falls from young adulthood to middle age and rises again in old age; women: fairly constant from 20 to about 50, then drops; jitter / shimmer evidence is mixed, f0 variability large in the very old (Eadie 2000 review); older adults are reported to have higher jitter and shimmer, more breathiness and roughness and reduced loudness (search snippet). Children: shorter tract and higher f0 (Traunmüller & Eriksson included 7-year-olds)                                                                                                                                                              | tract-length scale, fold length / mass scale, jitter + shimmer + slight breathiness and tremor for old voices, slower rate                                                                                                                         |
| nasality / "cold" voice          | VoQS: nasalised voice and denasalised voice symbols; extIPA: nasal escape and denasal diacritics. Acoustic cues: extra low resonance near 250 Hz, zeros near 1 kHz, weakened and broadened F1 (textbook value, not re-checked)                                                                                                                                                                                                                                                                                                                                                                                         | velopharyngeal port area: 0 = denasal (nasals become voiced-stop-like, [m] -> [b]-like), normal, or permanently open = hypernasal; Hindi and nasal vowels need the port anyway                                                                     |
| lisp                             | extIPA: dentalised and interdental sibilant symbols, lateral lisp ʪ ʫ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | move the /s z/ constriction to the teeth (interdental: weak flat noise, no 4-8 kHz peak) or release laterally                                                                                                                                      |
| accent strength                  | no literature value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | interpolate each accent-specific rule output (vowel targets, rhoticity, tune choice) between a reference accent (0) and the target accent (1); values above 1 exaggerate (proposal)                                                                |

Voice disorders and diseases are out of scope by request.

## 8. Markup and interchange

### 8.1 Existing standards and what they can express

- SSML 1.1 (W3C): `prosody` with `pitch` (Hz, +N%, +0.5st, +10Hz, or x-low / low / medium / high / x-high / default), `contour` (list of (time%, target) pairs such as `(0%,+20Hz) (10%,+30%) (40%,+10Hz)`), `range`, `rate` (percentage or x-slow .. x-fast), `duration` ("250ms", "3s"), `volume` (+6dB, silent, x-soft .. x-loud); `emphasis level` strong / moderate / none / reduced; `break` with `strength` none / x-weak / weak / medium / strong / x-strong or `time`; `phoneme alphabet="ipa" ph="..."`; `say-as`; `sub alias`; `voice` (gender, age, variant, name); `xml:lang`.
- EmotionML 1.0 (W3C): `emotion` element containing `category`, `dimension`, `appraisal`, `action-tendency`, each with `name`, `value` in 0..1 and `confidence`; attribute `expressed-through`; published vocabularies include big6, everyday-categories, pad-dimensions, fsre-dimensions and intensity-dimension. It is designed for both generation and recognition annotation.
- IPA suprasegmentals: ˈ primary stress, ˌ secondary stress, ː long, ˑ half-long, . syllable break, | minor (foot) group, ‖ major (intonation) group, ↗ global rise, ↘ global fall, ‿ linking (IPA chart; textbook value, not re-checked); ꜜ downstep, ꜛ upstep and the tone letters and diacritics of 1.7 (opened).
- extIPA (opened): loudness and tempo in braces with musical terms, {𝆑 loud 𝆑}, {𝆑𝆑 louder 𝆑𝆑}, {𝆏 quiet 𝆏}, {𝆏𝆏 ...}, {allegro ... allegro}, {lento ... lento}, crescendo, rallentando; pauses (.), (..), (...), timed pause (1.2); extraneous noise in double parentheses, for example ⸨cough⸩; lisp and nasal-escape symbols.
- VoQS (opened): voice quality over a span in braces with an optional degree digit 1-3, for example {3V! ... 3V!}; V modal, F falsetto, W whisper, C creak, Ṿ whispery voice, V̰ creaky voice, V̤ breathy voice, V͉ slack / lax, V! harsh, V͈ pressed / tight, V‼ ventricular, L̝ raised larynx, L̞ lowered larynx, Ṽ nasalised, V͊ denasalised, V͍ spread-lip, J̞ open jaw.
- Whisper within a segment string: sub-dot (U+0323) under normally voiced segments, for example [ʃʊ̣ḍ] (Whispering article).
- ToBI labels (3.1) for English; IK-1..IK-7 numbers for Russian; pinyin tone marks ā á ǎ à and unmarked neutral, or digits 1-4 and 5 / 0 (textbook value, not re-checked).
- Devanagari conventions: consonant letters carry an inherent schwa; virama ् removes it; schwa deletion is not written (2.3); aspirated and breathy-voiced stops have their own letters; anusvara ं and chandrabindu ँ mark nasal consonant / nasalised vowel; nukta ़ marks borrowed sounds (क़ ज़ फ़) (textbook value, not re-checked).

### 8.2 Proposed symmetric notation

Three layers; synthesis goes down, recognition goes up, and every mode has one spelling per layer:

- Layer T (text): plain orthography and punctuation, plus optional inline tags that are a strict subset of SSML and EmotionML, plus stress / tone marks already native to the script (pinyin tone marks, Russian acute accent on the stressed vowel).
- Layer P (IPA + marks): IPA segments, IPA suprasegmentals, tone letters, and brace spans from VoQS / extIPA. No invented symbols; everything is Unicode IPA or published extensions.
- Layer A (parameters): qTA targets per syllable, effort in dB, Rd, noise level, durations. Not for interchange, but loggable for debugging and the inverse path.

| Mode                                  | Layer T (text input)                                                    | Layer P (IPA + marks)                                                                            | Recognition output                         |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Mandarin tone                         | pinyin marks or digits; Hanzi via dictionary                            | tone letters after syllable; reversed letters for sandhi; dotted for neutral                     | P then pinyin with marks                   |
| stress                                | dictionary; Russian acute; override `<emphasis>`                        | ˈ ˌ                                                                                              | P; text unchanged                          |
| statement / question / exclamation    | . ? ! and wh-word detection                                             | ‖ plus ↘ or ↗; optional tune tier (ToBI label or IK number) in braces, for example {IK3 ... IK3} | punctuation restored from tune             |
| continuation, list, parenthetical     | , ; : dashes and brackets                                               | \| with ↗; parenthetical as {lento / low register} span (proposal)                               | commas and brackets                        |
| contrastive focus / emphasis          | `<emphasis level="strong">`, or CAPS as shorthand                       | extra-strong stress ˈˈ on the syllable                                                           | `<emphasis>`                               |
| loudness                              | `<prosody volume="+6dB">`, or soft / loud                               | {𝆏 ...}, {𝆑 ...}, {𝆑𝆑 ...}, crescendo spans                                                      | same braces; dB value in layer A           |
| rate                                  | `<prosody rate="80%">`                                                  | {lento ...}, {allegro ...}                                                                       | same                                       |
| pitch register / range                | `<prosody pitch="+2st" range="...">`                                    | (none needed; layer A)                                                                           | SSML values                                |
| pauses                                | punctuation; `<break time="300ms"/>`                                    | (.), (..), (...), (0.3)                                                                          | break tags or punctuation                  |
| voice quality incl. whisper           | `<voice-quality name="whisper" degree="2">` (proposal, not in SSML 1.1) | {2W ... 2W}, {V̤ ...}, {V̰ ...}, {F ...}, {V! ...}, {V͈ ...}                                        | same braces                                |
| breathy-voiced consonants, aspirates  | Devanagari letters                                                      | bʱ dʱ ɖʱ gʱ dʒʱ; pʰ tʰ ʈʰ kʰ tʃʰ                                                                 | Devanagari                                 |
| emotion                               | `<emotion><category name="anger" value="0.8"/></emotion>` or dimensions | none (emotion is not phonetic); the resulting quality, loudness and tempo spans may be shown     | EmotionML with `confidence`                |
| laughter, cough, breath, filled pause | `<event name="laugh"/>` (proposal) or spelled "haha", "um"              | ⸨laugh⸩, ⸨cough⸩, ⸨inhale⸩; fillers as segments [əː], [əm]                                       | same; fillers optionally dropped from text |
| smile, nasal, denasal, yawn           | `<voice-quality name="smile">` (proposal)                               | {V͍ ...}, {Ṽ ...}, {V͊ ...}, {L̞ J̞ ...}                                                             | same                                       |
| singing                               | notes via `<prosody pitch="220Hz" duration="500ms">` per syllable       | layer A only                                                                                     | f0 track quantised to notes (optional)     |
| accent, language                      | `xml:lang="en-AU"`, `<voice variant>`; strength attribute (proposal)    | narrow IPA already encodes it                                                                    | language / accent tag with confidence      |

- Round-trip rule: anything the recogniser cannot decide is omitted from layer P rather than guessed, and every paralinguistic annotation carries a confidence, as EmotionML allows.

## 9. Recognition side: cue sets and simple detectors

All detectors assume the front end already delivers per frame: energy, f0 with a voicing / periodicity score, formants or a smooth spectral envelope, H1-H2 or a tilt measure, and syllable / segment boundaries. Thresholds are starting points (proposals) to be tuned on recordings, anchored to the cited measurements. f0 is normalised per speaker (st re the speaker's median or resting f0, as Pell et al. do).

| Mode                              | Cue set                                                                                                             | Rule sketch                                                                                                                                                | Reliability (honest)                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Mandarin tone                     | f0 height and slope in the second half of the rhyme, duration, creak                                                | fit qTA (m, b) per syllable given previous state; classify by nearest target in the Table V space; creak or very low b -> T3; undo sandhi with the lexicon | good in clear voiced speech (humans 96%); coarticulation and neutral tone need the previous-syllable state; T2 / T3 confusable |
| neutral tone                      | duration under about 60% of neighbours, low intensity, pitch predicted by previous tone                             | duration ratio + weak target (low lambda)                                                                                                                  | medium                                                                                                                         |
| lexical stress (En, Ru)           | rhyme duration ratio, spectral balance above 0.5 kHz, vowel quality (reduced or not), f0 step direction             | weighted vote; in Russian prefer duration + quality                                                                                                        | medium; best with a lexicon restricting candidates                                                                             |
| phrase boundary                   | final-rhyme lengthening, pause, f0 reset                                                                            | lengthening factor above 1.2 and / or pause above 150 ms                                                                                                   | good for major breaks, weak for minor                                                                                          |
| statement vs yes/no question (En) | f0 at phrase end versus phrase mean                                                                                 | final rise above +3 st over the last 200-300 ms -> question                                                                                                | good for rising questions; wh- and falling questions need words                                                                |
| Russian IK-3 vs IK-1              | sharp rise inside one stressed vowel followed by low post-centre                                                    | rise above +5 st within one syllable then drop below pre-centre level -> IK-3                                                                              | medium-good; IK-3 also marks non-final phrases, so check for following pause / finality                                        |
| Mandarin question                 | global mean f0, declination slope, final-tone range                                                                 | higher register and flatter declination than the speaker's statements                                                                                      | weak (humans 51-78% in some conditions); rely on 吗 and wording                                                                |
| focus                             | on-focus range expansion + post-focus compression (about -2 to -5 st) + lengthening                                 | find the word after which mean f0 and range drop                                                                                                           | medium                                                                                                                         |
| vocal effort (soft .. shout)      | spectral emphasis / tilt, f0 (5 Hz/dB), F1 (3.5 Hz/dB), absolute level if calibrated                                | effort index = tilt-based estimate, cross-checked with f0 and F1 shifts                                                                                    | good relative to the same speaker; absolute level alone is useless (microphone distance)                                       |
| whisper                           | no periodicity, energy ratio (above 2.5 kHz / below 1 kHz) high, flat spectrum, F1 raised                           | periodicity score low for all vowel-like frames and energy ratio above threshold                                                                           | good (97.5% in Carlin et al.)                                                                                                  |
| whispered Mandarin tone           | duration, bimodal intensity (T3), early amplitude drop (T4)                                                         | envelope-shape rules                                                                                                                                       | poor: about 50% overall for humans; T1 / T2 at chance                                                                          |
| breathy voice, Hindi bʱ-series    | H1-H2 above about 6-8 dB, low CPP / HNR, noise above 2 kHz, f0 dip, intensity drop after release, lasting 60-100 ms | post-release breathy interval present -> breathy-voiced stop                                                                                               | medium-good on vowels; H1-H2 is biased by F1 on high vowels, so correct for formants (H1*-H2*)                                 |
| creak, glottal stop               | f0 below about 70 Hz or irregular periods (jitter above 5%), H1-H2 below 0                                          | run-length of irregular pulses                                                                                                                             | medium; pitch trackers fail here, use pulse timing directly                                                                    |
| falsetto                          | f0 in upper range, steep tilt, few harmonics                                                                        | f0 above +10 st re median with H1-H2 above 8 dB                                                                                                            | medium                                                                                                                         |
| harsh / pressed                   | flat tilt with low HNR (harsh) or high HNR (pressed)                                                                | two-feature rule                                                                                                                                           | weak-medium                                                                                                                    |
| emotion                           | f0 mean, f0 range, rate, level, tilt, voice quality                                                                 | compute activation from f0 mean + range + rate + tilt; map to categories only coarsely                                                                     | activation: good; category from three prosodic cues: about 58% over 7 classes (Pell et al.); valence: poor                     |
| speaking rate                     | syllable nuclei per second                                                                                          | count energy / sonority peaks                                                                                                                              | good                                                                                                                           |
| laughter                          | 4-6 Hz rhythmic alternation of aspiration and vowel, high f0, central vowel, declining amplitude                    | periodicity of the energy envelope at 4-6 Hz for at least 3 cycles                                                                                         | good for voiced song-like laughs; poor for unvoiced snorts                                                                     |
| filled pause                      | long steady schwa-like vowel (optionally + nasal), low flat or slightly falling f0, formants static                 | duration above 200 ms with formant movement under a small threshold                                                                                        | medium-good                                                                                                                    |
| breath                            | broadband low-level noise in a pause, 300-700 ms                                                                    | noise in pause above floor with speech-like envelope                                                                                                       | medium                                                                                                                         |
| singing                           | piecewise-constant f0, 5-7 Hz modulation, long vowels                                                               | vibrato detector on f0 + note stability                                                                                                                    | good                                                                                                                           |
| smile                             | all formants slightly up, f0 up                                                                                     | needs a neutral reference from the same speaker                                                                                                            | poor without reference                                                                                                         |
| nasality                          | low-frequency nasal pole, weakened F1, antiresonance                                                                | spectral-envelope rule                                                                                                                                     | weak-medium                                                                                                                    |
| age, sex, size                    | f0 median, formant spacing (tract length), jitter / shimmer                                                         | tract-length estimate from mean formant spacing                                                                                                            | sex / child: good; age within adults: poor                                                                                     |
| rhythm class / accent             | nPVI-V, %V, vowel reduction rate                                                                                    | compare with per-language ranges                                                                                                                           | weak; supportive only                                                                                                          |

## Master table

| Mode                                           | Synthesis parameters to drive (typical values)                                                                                                     | Recognition cues                                          | Priority | Key source                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------- | --------------------------------------------------- |
| Mandarin tones T1-T4                           | qTA targets: H (0 st/s, 0 st), R (+93 st/s, -2.2 st), L (0, -8.9 st), F (-106 st/s, -2.5 st); lambda 34-55 /s; durations x1.0 / 1.11 / 1.41 / 0.87 | late-rhyme f0 height + slope, duration                    | must     | Prom-on et al. 2009; Xu 1997                        |
| neutral tone                                   | duration x0.5; pitch from table in 1.1; weak target                                                                                                | short, weak, pitch set by previous tone                   | must     | Standard Chinese phonology                          |
| tone sandhi (T3, 一, 不)                       | symbolic rules before target assignment                                                                                                            | lexicon-driven undo                                       | must     | Standard Chinese phonology                          |
| tonal coarticulation                           | carry f0 state across syllables (third-order dynamics)                                                                                             | use previous state in fit                                 | must     | Xu 1997                                             |
| creak in T3                                    | Rd 0.3-0.6, irregular pulses when target below -8 st                                                                                               | irregular periods                                         | should   | Standard Chinese phonology                          |
| English stress                                 | duration up, flatter tilt above 0.5 kHz, full vowel, +1 to +4 st when accented                                                                     | duration, spectral balance, vowel quality                 | must     | Sluijter & van Heuven 1996; Fry                     |
| Russian stress + reduction                     | [ɐ] / [ə] / [ɪ] rules; duration about 3 : 2 : 1                                                                                                    | duration + vowel quality                                  | must     | Vowel reduction in Russian                          |
| Hindi phrasing + schwa deletion                | LH rise per non-final word, downstep; ə -> ∅ / VC_CV                                                                                               | repeated rises; final fall                                | must     | arXiv 1705.03247; Patil et al.                      |
| pre-boundary lengthening                       | final rhyme x1.1-1.6 by break strength                                                                                                             | rhyme duration ratio                                      | must     | Wightman et al. 1992                                |
| declination + reset                            | -11 / (t + 1.5) st/s; reset at major breaks                                                                                                        | slope, reset size                                         | must     | 't Hart et al. 1990                                 |
| statement                                      | final fall, -90 st/s, to -4.3 st                                                                                                                   | final fall                                                | must     | Prom-on et al. 2009                                 |
| yes/no question                                | En L\* H-H% rise 6-10 st; Ru IK-3 sharp rise 7-10 st on centre; Zh raised register + stronger final tone; Hi final H                               | final rise / IK-3 shape / register                        | must     | ToBI; Bryzgunova; Yuan                              |
| wh-question                                    | high accented wh-word, fall (Ru IK-2)                                                                                                              | early peak + fall                                         | must     | ToBI; Bryzgunova                                    |
| continuation, list                             | small rise or plateau, weak break (Ru IK-3 / IK-4 / IK-6)                                                                                          | non-low boundary + short pause                            | must     | ToBI; Bryzgunova                                    |
| exclamation, command                           | expanded range, effort +6 dB, steep falls (Ru IK-2 / IK-5)                                                                                         | range + effort                                            | should   | Bryzgunova; section 4                               |
| echo, tag question, parenthetical              | separate tunes; parenthetical: -2 to -3 st, range x0.5, faster                                                                                     | register shift, compression                               | could    | ToBI                                                |
| contrastive focus, emphasis                    | on-focus +2.3 to +2.9 st, lows -2.4 st, longer; post-focus -2 to -5.6 st                                                                           | expansion then compression                                | must     | Prom-on et al. 2009                                 |
| vocal effort soft .. shout                     | pressure x2 per 9 dB; f0 +5 Hz/dB; F1 +3.5 Hz/dB; F3 gains about 2 dB over F1 per 10 dB                                                            | tilt, f0, F1 relative to speaker                          | must     | Liénard & Di Benedetto 1999; Titze                  |
| Lombard, crescendo                             | effort ramp; longer vowels                                                                                                                         | tilt + duration trend                                     | could    | Lombard effect article                              |
| breathy voice                                  | Rd 2.0-2.7, chink open, aspiration noise; H1-H2 7-12 dB                                                                                            | H1-H2, CPP / HNR                                          | must     | Gordon & Ladefoged; Keating et al. 2011             |
| Hindi breathy-voiced and aspirated stops       | prevoicing + 60-100 ms breathy release; voiceless aspiration 60-90 ms                                                                              | post-release breathy interval, VOT                        | must     | section 5.3 sources                                 |
| creaky voice, glottal stop                     | Rd 0.3-0.6, f0 20-70 Hz, jitter 5-15%; closure 30-80 ms                                                                                            | irregular low pulses                                      | should   | Gordon & Ladefoged                                  |
| whisper                                        | no voicing; glottal area about 40 mm2; noise source; -25 dB; durations x1.3; R1 +255 Hz arises physically                                          | no periodicity; energy ratio above 2.5 kHz vs below 1 kHz | must     | Swerdlin et al. 2010; Jiao & Xu; Carlin et al. 2006 |
| falsetto, harsh, pressed, lax                  | section 5.2 table                                                                                                                                  | tilt + HNR + f0                                           | should   | Laver via VoQS; Ní Chasaide & Gobl                  |
| emotions (anger, joy, sadness, fear, boredom)  | section 6.2 table, for example joy: f0 +50%, range +100%, rate +30%, F1 / F2 +10%                                                                  | activation from f0, range, rate, tilt                     | should   | Burkhardt & Sendlmeier 2000; Schröder 2001          |
| surprise, disgust, tenderness, contempt, irony | section 6.2 (partly unverified)                                                                                                                    | weak                                                      | could    | Cahn via Schröder 2001; Pell et al. 2009            |
| A / E / P dimensions                           | linear rules of 6.3                                                                                                                                | same in reverse (activation only)                         | should   | Schröder et al. 2001                                |
| speaking rate                                  | 3.2-6.4 syl/s observed range; 100-200 words/min                                                                                                    | syllable-nucleus rate                                     | must     | Pell et al. 2009                                    |
| clear vs casual                                | precision knob: overshoot +30% / undershoot 20%                                                                                                    | vowel-space size, release bursts                          | should   | Picheny et al.; Burkhardt & Sendlmeier              |
| filled pauses, breaths                         | [əː] / [əm] 250-500 ms, low flat f0; inhalation noise 300-700 ms                                                                                   | steady schwa, low f0; noise in pause                      | should   | Shriberg (search snippets)                          |
| laughter                                       | calls of aspiration + central vowel, about 5 per s, f0 about 200 Hz (m) / 480 Hz (f), declining                                                    | 4-6 Hz envelope rhythm, high f0                           | could    | Szameitat et al. 2007; Bachorowski et al. 2001      |
| singing, chant                                 | vibrato 5-7 Hz, +/- 0.5-1 st; F3-F5 cluster 2.2-3.8 kHz; held targets                                                                              | note stability + vibrato                                  | could    | Vibrato article; Sundberg                           |
| smile, yawn                                    | lip spread (F1 / F2 +10%); larynx down + jaw open                                                                                                  | formant shifts vs reference                               | could    | Tartter 1980; VoQS                                  |
| child-directed, age, size                      | f0 up, range up, slower; tract and fold scaling; jitter for old voices                                                                             | f0, formant spacing                                       | could    | Fernald 1985; Eadie 2000                            |
| nasal / denasal, lisp                          | velar port area; /s/ place shift                                                                                                                   | nasal pole / zero; sibilant spectrum                      | could    | VoQS; extIPA                                        |
| accent strength                                | interpolation 0..1 between accent rule sets                                                                                                        | vowel targets, rhythm metrics                             | could    | proposal                                            |

## Sources

Opened and read (HTML page, or PDF downloaded and text-extracted):

- Standard Chinese phonology (tones, sandhi, neutral tone): https://en.wikipedia.org/wiki/Standard_Chinese_phonology
- Xu, Y. (1997). Contextual tonal variations in Mandarin. Journal of Phonetics 25(1), 61-83: https://www.homepages.ucl.ac.uk/~uclyyix/yispapers/Xu_JP97.pdf
- Prom-on, S., Xu, Y., Thipakorn, B. (2009). Modeling tone and intonation in Mandarin and English as a process of target approximation. JASA 125(1), 405-424: https://www.homepages.ucl.ac.uk/~uclyyix/yispapers/Prom-on_etAl_JASA2009.pdf
- Tone letter: https://en.wikipedia.org/wiki/Tone_letter
- Tone (linguistics): https://en.wikipedia.org/wiki/Tone_(linguistics)
- Vowel reduction in Russian: https://en.wikipedia.org/wiki/Vowel_reduction_in_Russian
- Isochrony: https://en.wikipedia.org/wiki/Isochrony
- A systematic review of Hindi prosody: https://arxiv.org/pdf/1705.03247
- Schwa deletion in Indo-Aryan languages: https://en.wikipedia.org/wiki/Schwa_deletion_in_Indo-Aryan_languages
- Grabe, E. Variation adds to prosodic typology (Speech Prosody 2002; PVI space for 18 languages): https://mail.sprosig.org/sp2002/pdf/grabe.pdf
- Ramus, F. Acoustic correlates of linguistic rhythm: perspectives (Speech Prosody 2002): https://mail.sprosig.org/sp2002/pdf/ramus.pdf
- ToBI: https://en.wikipedia.org/wiki/ToBI
- Xu, R. B., Mok, P. P. K. (2014). Cross-linguistic perception of Mandarin intonation (Speech Prosody 2014; summarises Yuan's production findings): https://www.cuhk.edu.hk/lin/people/peggy/XuMok_SP2014.pdf
- Liénard, J.-S., Di Benedetto, M.-G. (1999). Effect of vocal effort on spectral properties of vowels. JASA 106(1), 411-422: https://perso.lisn.upsaclay.fr/wiki/_media/lienard/publis/lienard_dibenedetto_jasa99.pdf
- Eriksson, A., Thunberg, G., Traunmüller, H. (2001). Syllable prominence: a matter of vocal effort, phonetic distinctness and top-down processing (Eurospeech 2001): https://www.isca-archive.org/eurospeech_2001/eriksson01_eurospeech.pdf
- Lombard effect: https://en.wikipedia.org/wiki/Lombard_effect
- Gordon, M., Ladefoged, P. Phonation types: a cross-linguistic overview (Journal of Phonetics 2001), copy at: https://coehuman.uodiyala.edu.iq/uploads/Coehuman%20library%20pdf/English%20library%D9%83%D8%AA%D8%A8%20%D8%A7%D9%84%D8%A7%D9%86%D9%83%D9%84%D9%8A%D8%B2%D9%8A/linguistics/phonation.pdf
- Keating, P., Esposito, C., Garellek, M., Khan, S., Kuang, J. (2011). Phonation contrasts across languages (ICPhS 2011): https://www.reed.edu/linguistics/khan/assets/Keating%20ea%202011%20Phonation%20contrasts%20across%20languages.pdf
- Ní Chasaide, A., Gobl, C. (1995). Towards acoustic profiles of phonatory qualities (ICPhS 1995): https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1995/13_ICPhS_1995_Vol_4/p13.4_006.pdf
- Wang, Z., Gobl, C. (2023). A system for generating voice source signals that implements the transformed LF-model parameter control (Interspeech 2023): https://www.isca-archive.org/interspeech_2023/wang23ra_interspeech.pdf
- Langmeier, C. (1991). Acoustical cues for voiced and breathy final stops in Gujarati language (ICPhS 1991): https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1991/12_ICPhS_1991_Vol_5/p12.5_374.pdf
- Whispering: https://en.wikipedia.org/wiki/Whispering
- Swerdlin, Y., Smith, J., Wolfe, J. (2010). The effect of whisper and creak vocal mechanisms on vocal tract resonances. JASA: https://www.phys.unsw.edu.au/jw/reprints/whisper.pdf
- Jiao, L., Xu, Y. (2019). Whispered Mandarin has no production-enhanced cues for tone and intonation (accepted manuscript, UCL Discovery): https://discovery.ucl.ac.uk/id/eprint/10042331/7/Whispered%20Tones%20Revisited_accepted.pdf
- Carlin, M. A., Smolenski, B. Y., Wenndt, S. J. (2006). Unsupervised detection of whispered speech in the presence of normal phonation (Interspeech 2006): https://www.isca-archive.org/interspeech_2006/carlin06_interspeech.pdf
- Ghaffarzadegan, S., Bořil, H., Hansen, J. H. L. (2016). Generative modeling of pseudo-whisper for robust whispered speech recognition. IEEE/ACM TASLP 24(10): https://personal.utdallas.edu/~hynek/pdfs/TASLP-WhisperASR_wShabnam.pdf
- Schröder, M. (2001). Emotional speech synthesis: a review (Eurospeech 2001): https://www.isca-archive.org/eurospeech_2001/schroder01b_eurospeech.pdf
- Schröder, M., Cowie, R., Douglas-Cowie, E., Westerdijk, M., Gielen, S. (2001). Acoustic correlates of emotion dimensions in view of speech synthesis (Eurospeech 2001): https://www.isca-archive.org/eurospeech_2001/schroder01_eurospeech.pdf
- Burkhardt, F., Sendlmeier, W. (2000). Verification of acoustical correlates of emotional speech using formant-synthesis (ISCA Workshop on Speech and Emotion): https://www.isca-archive.org/speechemotion_2000/burkhardt00_speechemotion.pdf
- Pell, M. D., Paulmann, S., Dara, C., Alasseri, A., Kotz, S. A. (2009). Factors in the recognition of vocally expressed emotions: a comparison of four languages. Journal of Phonetics 37, 417-435: https://www.mcgill.ca/pell_lab/files/pell_lab/pell_paulmann_dara_alasseri__kotz_2009_0.pdf
- Proceedings of the Interdisciplinary Workshop on the Phonetics of Laughter, Saarbrücken 2007 (Szameitat et al., Formant characteristics of human laughter): https://www.coli.uni-saarland.de/conf/laughter-07/files/PROCEEDINGS_COMPLETE.pdf
- Eadie, T. L. (2000). Characteristics of the aging female voice (review): https://cjslpa.ca/files/2000_JSLPA_Vol_24/No_04_145-196/Eadie_JSLPA_2000.pdf
- Baby talk (child-directed speech): https://en.wikipedia.org/wiki/Baby_talk
- Vibrato: https://en.wikipedia.org/wiki/Vibrato
- Speech Synthesis Markup Language (SSML) 1.1, W3C Recommendation: https://www.w3.org/TR/speech-synthesis11/
- Emotion Markup Language (EmotionML) 1.0, W3C Recommendation: https://www.w3.org/TR/emotionml/
- Extensions to the International Phonetic Alphabet: https://en.wikipedia.org/wiki/Extensions_to_the_International_Phonetic_Alphabet
- Voice Quality Symbols: https://en.wikipedia.org/wiki/Voice_Quality_Symbols

Seen as search results only (used for "(search snippet)" statements and as pointers for follow-up):

- qTA tools page (qTAtrainer): https://www.homepages.ucl.ac.uk/~uclyyix/qTA/
- Fujisaki-model studies: https://www.isca-archive.org/interspeech_2004/gu04_interspeech.pdf , https://www.isca-archive.org/eurospeech_2003/fujisaki03_eurospeech.pdf , https://www.isca-archive.org/eurospeech_2001/mixdorff01_eurospeech.pdf , https://link.springer.com/article/10.1186/s13636-014-0028-3
- Taylor, P. Tilt model paper: https://www.cstr.ed.ac.uk/downloads/publications/1998/Taylor_1998_e.pdf
- Sluijter & van Heuven (ICSLP 1996 companion paper): https://www.isca-archive.org/icslp_1996/sluijter96_icslp.html
- Cutler, A. (2005). Lexical stress, in The Handbook of Speech Perception (summarises Fry; the repository copy refused automated requests, so no link is given).
- Wightman et al. (1992) as discussed in: https://pmc.ncbi.nlm.nih.gov/articles/PMC3579632
- Rhythm-metric ranges across studies: https://pmc.ncbi.nlm.nih.gov/articles/PMC2790788
- Patil et al., Focus, word order and intonation in Hindi: https://ojs.ub.uni-konstanz.de/jsal/index.php/jsal/article/view/3
- Harnsberger & Judge (1996) abstract on Hindi intonation: https://auditory.org/asamtgs/asa96ind/2pSC/2pSC4.html
- Russian intonation constructions: https://trudy.ruslang.ru/en/node/1243 , https://russkayarech.ru/en/node/8440 , https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1991/12_ICPhS_1991_Vol_2/p12.2_274.pdf
- Mandarin question intonation: https://www.isca-archive.org/interspeech_2019/liu19i_interspeech.pdf , https://languagelog.ldc.upenn.edu/nll/?p=69334
- Subglottal pressure, SPL and f0 (Titze and others): https://www.vocology.utah.edu/_resources/documents/a_short_tutorial_on_sl_titze.pdf , https://pmc.ncbi.nlm.nih.gov/articles/PMC4842124 , https://www.phonetik.uni-muenchen.de/~hoole/kurse/handout_sommer/respphon.pdf
- Esposito, C. (2012), Journal of Phonetics (cites Bickley's Gujarati H1-H2 values; the host did not resolve at re-check, so no link is given).
- Dutta, Four-way stop contrasts in Hindi (record only): https://www.ideals.illinois.edu/items/83932
- Kallail, K. J., Emanuel, F. W. (1984). Formant-frequency differences between isolated whispered and phonated vowel samples produced by adult female subjects. Journal of Speech and Hearing Research 27 (record seen; the host did not resolve at re-check, so no link is given).
- Bachorowski, Smoski & Owren (2001) record: https://scholars.duke.edu/publication/706959
- Shriberg, Acoustic properties of disfluent repetitions (ICPhS 1995; opened, but the filled-pause f0 statements come from other snippets): https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1995/13_ICPhS_1995_Vol_4/p13.4_384.pdf
- Filled-pause acoustics in forensic comparison: https://eprints.whiterose.ac.uk/118410/1/Hughes_et_al._Strength_of_forensic_voice_comparison_evidence_from_the_acoustics_of_filled_pauses.pdf
- Tartter (1980), smiled speech: https://link.springer.com/article/10.3758/BF03199901
- Clear speech studies: https://pmc.ncbi.nlm.nih.gov/articles/PMC2806443
- Singer's formant and vibrato: https://pmc.ncbi.nlm.nih.gov/articles/PMC1769352 , https://www.vocevista.com/en/doc/theory-vibrato/
- PVI explanation page: https://lfsag.unito.it/ritmo/pvi_en.html

## What remains unverified

- Exact per-band dB values in Sluijter & van Heuven (1996) and Fry's original ratios.
- Traunmüller & Eriksson (2000) numeric slopes; Banse & Scherer (1996) and Juslin & Laukka (2003) tables (used only via summaries).
- Russian vowel durations by degree of reduction; numeric shapes of IK-1..IK-7 (all sizes here are proposals); IK-4, IK-5, IK-6 descriptions are textbook recollections.
- Rd / OQ anchors per voice quality, HNR / CPP typical values, jitter values for creak.
- Hindi stop timing (VOT, breathy interval), Hindi question tunes.
- nPVI and %V values for Mandarin, Hindi and Russian; the IPO declination formula; Cantonese and Serbo-Croatian tone inventories.
- Kallail & Emanuel (1984) and Jovičić (1998) original whisper formant tables (only as summarised by Swerdlin et al.).
- Tenderness, contempt, irony / sarcasm presets; sigh, breath, cough, yawn acoustics; child-directed speech numbers; filled-pause durations.
