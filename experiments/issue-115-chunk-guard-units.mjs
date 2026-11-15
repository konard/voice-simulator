// Reproduces the chunk-size guard false negative (issue 115): Vite reports
// UTF-8 bytes, the guard in examples/universal-app/build-chunks.js measured
// UTF-16 code units, so a chunk with non-ASCII text can pass the guard while
// Vite still warns that it is larger than 500 kB.
//
// Usage: node experiments/issue-115-chunk-guard-units.mjs <dir with vite installed>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? '.');
const { build } = await import(
  pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href
);
const { chunkSizeGuard } = await import(
  new globalThis.URL(
    '../examples/universal-app/build-chunks.js',
    import.meta.url
  ).href
);

// 260k two-byte characters: 520 kB of UTF-8, but only 260k code units.
mkdirSync(path.join(root, 'src'), { recursive: true });
writeFileSync(
  path.join(root, 'src/main.js'),
  `export const table = ${JSON.stringify('ɑ'.repeat(260_000))};\nconsole.log(table.length);\n`
);
writeFileSync(
  path.join(root, 'index.html'),
  '<script type="module" src="/src/main.js"></script>\n'
);

try {
  await build({
    root,
    logLevel: 'info',
    plugins: [chunkSizeGuard()],
    build: { outDir: 'dist', emptyOutDir: true },
  });
  console.log('RESULT: the guard passed the build');
} catch (error) {
  console.log(
    `RESULT: the guard failed the build: ${error.message.split('\n')[0]}`
  );
}
