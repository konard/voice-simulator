/** Check compact lookup against every English homophone corpus score. */
import assert from 'node:assert/strict';
import { ASSOCIATIONS as first } from '../src/recognition/data/en-homophone-context-0.js';
import { ASSOCIATIONS as second } from '../src/recognition/data/en-homophone-context-1.js';
import { telephoneAssociation } from '../src/recognition/telephone-spelling.js';

let checked = 0;
for (const table of [first, second]) {
  for (const item of table.split(' ')) {
    const middle = item.indexOf('/');
    const end = item.lastIndexOf('=');
    assert.equal(
      telephoneAssociation(item.slice(0, middle), item.slice(middle + 1, end)),
      Number(item.slice(end + 1)) / 100,
      item
    );
    checked++;
  }
}
assert.equal(telephoneAssociation('', 'b'), 0);
assert.equal(telephoneAssociation('a', 'b\u0000'), 0);
assert.equal(telephoneAssociation('zzzz', 'hello'), 0);
console.log(`${checked} corpus scores verified`);
