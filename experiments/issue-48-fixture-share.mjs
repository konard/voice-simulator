#!/usr/bin/env node
/**
 * Issue 48: the share of words of tests/fixtures/russian-stress.txt that
 * get the stress marked by hand, read with the marks removed (see
 * tests/helpers/russian-stress-fixture.js).
 *
 *   node experiments/issue-48-fixture-share.mjs [--wrong]
 *
 * `--wrong` lists the words that differ. The share after issue 48 is in
 * experiments/issue-48/fixture-share-after.txt; the share before,
 * experiments/issue-48/fixture-share-before.txt, was measured on main
 * (ca455fa) with this fixture and src/g2p/russian-homographs.js copied in,
 * by the first version of this script (commit 951587d), which reads the
 * fixture itself.
 */

import { measureRussianFixture } from '../tests/helpers/russian-stress-fixture.js';

const { sentences, all, homograph, wrong } = measureRussianFixture();
const share = ({ right, total }) =>
  `${right}/${total} (${((100 * right) / total).toFixed(1)} %)`;
console.log(`sentences: ${sentences}`);
console.log(`all words: ${share(all)}`);
console.log(`homograph words: ${share(homograph)}`);
if (process.argv.includes('--wrong')) {
  console.log(wrong.join('\n'));
}
