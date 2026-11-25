<!-- node --test --test-name-pattern="^modes (telephone|wideband)$" tests/heavy/roundtrip-sentences.test.js (issue 168), excerpt of roundtrip.md -->

## modes

| Language | Tier      | Presets | Cases | PER   | WER   | CER   | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF   | Gates |
| -------- | --------- | ------- | ----- | ----- | ----- | ----- | --------- | ---------- | ----------- | --------- | -------------- | ---------- | --------- | ----- | ----- |
| en       | telephone | male    | 4     | 14.0% | 50.0% | 15.7% | 50.0%     | –          | 100.0%      | 7.4       | 100.0%         | 66.7%      | 100.0%    | 1.441 | –     |
| ru       | telephone | male    | 4     | 19.7% | 55.0% | 25.5% | 47.5%     | –          | 100.0%      | 10.1      | 100.0%         | 100.0%     | 100.0%    | 0.644 | –     |
| hi       | telephone | male    | 4     | 1.7%  | 6.3%  | 3.3%  | 6.3%      | –          | –           | 7.3       | 100.0%         | 100.0%     | 100.0%    | 1.373 | –     |
| zh       | telephone | male    | 4     | 4.5%  | –     | 12.5% | 18.8%     | 6.3%       | –           | 7.0       | 100.0%         | 100.0%     | 100.0%    | 0.820 | –     |
| all      | telephone | male    | 16    | 12.9% | 44.6% | 18.0% | 35.5%     | 6.3%       | 100.0%      | 8.3       | 100.0%         | 91.7%      | 100.0%    | 1.011 | Pass  |
| en       | wideband  | male    | 4     | 11.8% | 47.2% | 13.6% | 47.2%     | –          | 100.0%      | 6.4       | 100.0%         | 66.7%      | 100.0%    | 0.791 | –     |
| ru       | wideband  | male    | 4     | 16.0% | 67.5% | 23.4% | 57.5%     | –          | 100.0%      | 9.6       | 100.0%         | 100.0%     | 100.0%    | 0.729 | –     |
| hi       | wideband  | male    | 4     | 5.0%  | 12.5% | 6.7%  | 12.5%     | –          | –           | 6.6       | 100.0%         | 100.0%     | 100.0%    | 1.093 | –     |
| zh       | wideband  | male    | 4     | 1.1%  | –     | 9.4%  | 15.6%     | 6.3%       | –           | 6.6       | 100.0%         | 100.0%     | 100.0%    | 0.553 | –     |
| all      | wideband  | male    | 16    | 10.6% | 50.0% | 16.6% | 37.9%     | 6.3%       | 100.0%      | 7.7       | 100.0%         | 91.7%      | 100.0%    | 0.763 | Pass  |

## Mode lanes

| Tier      | Lane       | Label | Scoring                                        | en          | ru          | hi          | zh          | All |
| --------- | ---------- | ----- | ---------------------------------------------- | ----------- | ----------- | ----------- | ----------- | --- |
| telephone | audio-only | W     | label over half the span                       | 1/1         | 1/1         | 1/1         | 1/1         | 4/4 |
| telephone | audio-only | f     | heard arousal rise ≥ 0.3 over the neutral span | 1/1 (+0.75) | 1/1 (+0.66) | 1/1 (+0.63) | 1/1 (+0.70) | 4/4 |
| telephone | audio-only | f     | no effort label (negative control)             | 1/1         | 1/1         | 1/1         | 1/1         | 4/4 |
| telephone | calibrated | f     | label over half the span                       | 1/1         | 1/1         | 1/1         | 1/1         | 4/4 |
| wideband  | audio-only | W     | label over half the span                       | 1/1         | 1/1         | 1/1         | 1/1         | 4/4 |
| wideband  | audio-only | f     | heard arousal rise ≥ 0.3 over the neutral span | 1/1 (+0.56) | 1/1 (+0.80) | 1/1 (+0.64) | 1/1 (+0.53) | 4/4 |
| wideband  | audio-only | f     | no effort label (negative control)             | 1/1         | 1/1         | 1/1         | 1/1         | 4/4 |
| wideband  | calibrated | f     | label over half the span                       | 1/1         | 1/1         | 1/1         | 1/1         | 4/4 |
