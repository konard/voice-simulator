#!/usr/bin/env node
/**
 * Issue 48: the share of words of tests/fixtures/russian-stress.txt that
 * get the stress marked by hand, read with the marks removed (see
 * tests/helpers/russian-stress-fixture.js).
 *
 *   node experiments/issue-48-fixture-share.mjs [--wrong]
 *
 * `--wrong` lists the words that differ. The share before issue 48,
 * experiments/issue-48/fixture-share-before.txt, was measured by the first
 * version of this script (commit 951587d), which read the fixture itself.
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
