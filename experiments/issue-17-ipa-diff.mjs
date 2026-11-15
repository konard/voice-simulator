#!/usr/bin/env node

/**
 * Experiment for issue 17: compare the hand-written IPA of the golden set
 * with the IPA that the project's text to IPA gives, word by word, and
 * print the words that differ (the list in the pull request).
 *
 *   node experiments/issue-17-ipa-diff.mjs
 */

import { loadManifest } from '../scripts/golden.mjs';
import { textToIpa } from '../src/g2p/index.js';

// Words only: the project writes punctuation as separate tokens.
const strip = (ipa) =>
  ipa
    .normalize('NFC')
    .split(/\s+/u)
    .filter((token) => /\p{L}/u.test(token));
for (const item of loadManifest().utterances) {
  const result = textToIpa(item.text, { lang: item.lang });
  const project = typeof result === 'string' ? result : result.ipa;
  const hand = strip(item.ipa);
  const ours = strip(project);
  const words =
    item.lang === 'zh'
      ? item.text.match(/\p{Script=Han}/gu)
      : item.text.split(/\s+/u);
  const diffs = [];
  if (hand.length !== ours.length) {
    diffs.push(`word count ${hand.length} vs ${ours.length}: ${project}`);
  } else {
    hand.forEach((word, i) => {
      if (
        word.replace(/[.,!?।]/gu, '') !== ours[i].replace(/[.,!?।|‖]/gu, '')
      ) {
        diffs.push(`${words[i] ?? '?'}: hand ${word}, project ${ours[i]}`);
      }
    });
  }
  console.log(`${item.id}\t${diffs.length ? diffs.join('; ') : 'same'}`);
}
