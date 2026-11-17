# Syllable nuclei on the golden set (issue 62)

Command: `node --test tests/heavy/recognition-landmarks.test.js`.
Truth: syllabifyIpa of the committed IPA, by language. An asterisk
marks an utterance whose text and IPA have not both been reviewed by a person.

| Utterance | True syllables | Found nuclei | Absolute relative error |
| --------- | -------------: | -----------: | ----------------------: |
| en-01\*   |              8 |           10 |                  25.00% |
| en-02\*   |             18 |           17 |                   5.56% |
| en-03\*   |             15 |            5 |                  66.67% |
| en-04\*   |             15 |            1 |                  93.33% |
| en-05\*   |             17 |            1 |                  94.12% |
| en-06\*   |             15 |           14 |                   6.67% |
| ru-01\*   |             11 |           12 |                   9.09% |
| ru-02\*   |             22 |           21 |                   4.55% |
| ru-03\*   |             12 |           15 |                  25.00% |
| ru-04\*   |             20 |           21 |                   5.00% |
| ru-05\*   |             13 |           11 |                  15.38% |
| ru-06\*   |             22 |           21 |                   4.55% |
| hi-01\*   |             27 |           27 |                   0.00% |
| hi-02\*   |             17 |           16 |                   5.88% |
| hi-03\*   |             20 |           21 |                   5.00% |
| hi-04\*   |             15 |           15 |                   0.00% |
| hi-05\*   |             15 |           17 |                  13.33% |
| hi-06\*   |             15 |           16 |                   6.67% |
| zh-01\*   |             12 |           11 |                   8.33% |
| zh-02\*   |             12 |           10 |                  16.67% |
| zh-03\*   |             12 |            3 |                  75.00% |
| zh-04\*   |             12 |           14 |                  16.67% |
| zh-05\*   |             12 |           12 |                   0.00% |
| zh-06\*   |             12 |            2 |                  83.33% |

Mean absolute relative error: **24.41%**.
The 15% target is measured, not a gate.
