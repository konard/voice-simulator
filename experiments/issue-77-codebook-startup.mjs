/** Check codebook startup time and packed output for three tract lengths. Unlicense. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  buildCodebookWithRenderer,
  serializeCodebook,
} from '../src/recognition/codebook.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';

const engine = globalThis.process.argv[2] ?? 'js';
const { renderer } = await createRecognitionEngine({ engine, threads: 1 });
for (const vocalTractLength of [13, 16.5, 19]) {
  const start = performance.now();
  const codebook = buildCodebookWithRenderer(
    { vocalTractLength },
    { size: 256 },
    renderer
  );
  console.log({
    vocalTractLength,
    milliseconds: performance.now() - start,
    sha256: createHash('sha256')
      .update(serializeCodebook(codebook))
      .digest('hex'),
  });
}
