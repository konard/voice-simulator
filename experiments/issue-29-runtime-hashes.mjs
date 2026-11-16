// Where the offline renders of 'Hello world.' differ between Node.js, Bun
// and Deno: hashes of the IPA, the plan, the voxel model and the samples.
// node|bun|deno run -A experiments/issue-29-runtime-hashes.mjs
import { createHash } from 'node:crypto';

import { prepareUtterance, synthesize, textToIpa } from '../src/index.js';

const hash = (value) =>
  createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    )
    .digest('hex')
    .slice(0, 16);

console.log('ipa', JSON.stringify(textToIpa('Hello world.').ipa));
for (const tier of ['minimal', 'high']) {
  const { plan, renderOptions } = prepareUtterance('Hello world.', {
    tier,
    seed: 1,
  });
  console.log(tier, 'plan', hash(JSON.stringify(plan)));
  const model = renderOptions.model;
  if (model) {
    console.log(
      tier,
      'model',
      hash(JSON.stringify(model.cells.map((cell) => [cell.point, cell.kind])))
    );
  }
  console.log(
    tier,
    'options',
    hash(
      JSON.stringify(renderOptions, (key, value) =>
        key === 'model' ? undefined : value
      )
    )
  );
  console.log(
    tier,
    'samples',
    hash(synthesize('Hello world.', { tier, seed: 1, engine: 'js' }).samples)
  );
}
