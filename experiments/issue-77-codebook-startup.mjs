/** Check codebook startup time and packed output for three tract lengths. Unlicense. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  buildCodebook,
  serializeCodebook,
} from '../src/recognition/codebook.js';

for (const vocalTractLength of [13, 16.5, 19]) {
  const start = performance.now();
  const codebook = buildCodebook({ vocalTractLength }, { size: 256 });
  console.log({
    vocalTractLength,
    milliseconds: performance.now() - start,
    sha256: createHash('sha256')
      .update(serializeCodebook(codebook))
      .digest('hex'),
  });
}
