// Rollup chunking for the example app. Kept free of dependencies so the root
// test suite can import it without installing the app's packages.

// Vite warns about chunks above this many kB (build.chunkSizeWarningLimit).
export const CHUNK_SIZE_LIMIT_KB = 500;

// three.js ships as two prebuilt files (three.module.js imports
// three.core.js), so a single vendor bundle passes the 500 kB warning.
// Keeping each prebuilt file and React in their own chunks keeps every chunk
// below the limit without raising chunkSizeWarningLimit.
const vendorChunks = [
  [/[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js$/, 'three-core'],
  [/[\\/]node_modules[\\/]three[\\/]build[\\/]/, 'three'],
  [/[\\/]node_modules[\\/]three[\\/]examples[\\/]/, 'three-addons'],
  [/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, 'react'],
];

export function vendorChunk(id) {
  return vendorChunks.find(([pattern]) => pattern.test(id))?.[1];
}

function outputSize(output) {
  return output.type === 'chunk'
    ? output.code.length
    : (output.source?.length ?? 0);
}

// Turns Vite's chunk size warning into a build error, so a regression fails
// CI and cannot scroll past as a log line. Emitted worker bundles are
// assets, so JavaScript assets are checked too.
export function chunkSizeGuard(limitKb = CHUNK_SIZE_LIMIT_KB) {
  return {
    name: 'chunk-size-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const oversized = Object.values(bundle)
        .filter((output) => output.fileName.endsWith('.js'))
        .map((output) => [output.fileName, outputSize(output) / 1000])
        .filter(([, sizeKb]) => sizeKb > limitKb);
      if (oversized.length > 0) {
        const list = oversized
          .map(([fileName, sizeKb]) => `${fileName} (${sizeKb.toFixed(2)} kB)`)
          .join(', ');
        this.error(
          `Chunks larger than ${limitKb} kB after minification: ${list}. ` +
            "Split them in build-chunks.js; keep the limit at Vite's default."
        );
      }
    },
  };
}
