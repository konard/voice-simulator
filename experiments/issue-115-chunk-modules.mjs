// Lists the largest modules of every chunk in the example app build, main
// bundle and workers alike, so oversized chunks can be split (issue 115).
// The size guard is left in place; this plugin runs first, so it logs before
// the guard fails the build.
//
// Usage: node experiments/issue-115-chunk-modules.mjs [top-n]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = path.resolve('examples/universal-app');
const { build } = await import(
  pathToFileURL(path.join(appRoot, 'node_modules/vite/dist/node/index.js')).href
);
const top = Number(process.argv[2] ?? 12);

function chunkModules(label) {
  return {
    name: 'issue-115-chunk-modules',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') {
          continue;
        }
        const modules = Object.entries(output.modules)
          .map(([id, info]) => [
            path.relative(process.cwd(), id),
            Buffer.byteLength(info.code ?? ''),
          ])
          .sort((a, b) => b[1] - a[1]);
        const total = Buffer.byteLength(output.code);
        console.log(
          `\n[${label}] ${output.fileName}: ${(total / 1000).toFixed(2)} kB (${modules.length} modules)`
        );
        for (const [id, size] of modules.slice(0, top)) {
          console.log(`  ${(size / 1000).toFixed(2).padStart(9)} kB  ${id}`);
        }
      }
    },
  };
}

try {
  await build({
    root: appRoot,
    configFile: path.join(appRoot, 'vite.config.js'),
    logLevel: 'warn',
    plugins: [chunkModules('main')],
    worker: { plugins: () => [chunkModules('worker')] },
  });
} catch (error) {
  console.log(`\nbuild failed: ${error.message.split('\n')[0]}`);
}
