# Syllable nuclei on the golden set (issue 62)

Command: `node --test tests/heavy/recognition-landmarks.test.js`.
Truth: syllabifyIpa of the committed IPA, by language. An asterisk
marks an utterance whose text and IPA have not both been reviewed by a person.

| Utterance | True syllables | Found nuclei | Absolute relative error |
| --------- | -------------: | -----------: | ----------------------: |
| en-01\*   |              8 |           10 |                  25.00% |
| en-02\*   |             18 |           16 |                  11.11% |
| en-03\*   |             15 |           10 |                  33.33% |
| en-04\*   |             15 |           16 |                   6.67% |
| en-05\*   |             17 |            1 |                  94.12% |
| en-06\*   |             15 |           13 |                  13.33% |
| ru-01\*   |             11 |           11 |                   0.00% |
| ru-02\*   |             22 |           18 |                  18.18% |
| ru-03\*   |             12 |           14 |                  16.67% |
| ru-04\*   |             20 |           20 |                   0.00% |
| ru-05\*   |             13 |           11 |                  15.38% |
| ru-06\*   |             22 |           19 |                  13.64% |
| hi-01\*   |             27 |           26 |                   3.70% |
| hi-02\*   |             17 |           16 |                   5.88% |
| hi-03\*   |             20 |           20 |                   0.00% |
| hi-04\*   |             15 |           15 |                   0.00% |
| hi-05\*   |             15 |           16 |                   6.67% |
| hi-06\*   |             15 |           15 |                   0.00% |
| zh-01\*   |             12 |           11 |                   8.33% |
| zh-02\*   |             12 |           15 |                  25.00% |
| zh-03\*   |             12 |            5 |                  58.33% |
| zh-04\*   |             12 |           16 |                  33.33% |
| zh-05\*   |             12 |           11 |                   8.33% |
| zh-06\*   |             12 |            4 |                  66.67% |

Mean absolute relative error: **19.32%**.
The 15% target is measured, not a gate.
