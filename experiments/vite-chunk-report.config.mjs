// Experiment for issue 3: report which modules make up each web-app chunk.
// Run from examples/universal-app:
//   npx vite build -c ../../experiments/vite-chunk-report.config.mjs
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import base from '../examples/universal-app/vite.config.js';

function moduleGroup(id) {
  const path = id.replaceAll('\\', '/');
  if (path.includes('node_modules/')) {
    const parts = path.split('node_modules/').at(-1).split('/');
    return parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
  }
  return path.split('/').slice(-3, -1).join('/');
}

export default {
  ...base,
  root: fileURLToPath(new URL('../examples/universal-app/', import.meta.url)),
  build: { ...base.build, outDir: join(tmpdir(), 'vite-chunk-report-dist') },
  plugins: [
    ...base.plugins,
    {
      name: 'chunk-report',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') {
            continue;
          }
          const groups = {};
          for (const [id, info] of Object.entries(chunk.modules)) {
            const key = moduleGroup(id);
            groups[key] = (groups[key] ?? 0) + info.renderedLength;
          }
          console.log(`\n${chunk.fileName} ${chunk.code.length} bytes`);
          const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
          for (const [key, size] of sorted.slice(0, 12)) {
            console.log(`  ${String(size).padStart(9)} ${key}`);
          }
        }
      },
    },
  ],
};
