// Rollup chunking for the example app. Kept free of dependencies so the root
// test suite can import it without installing the app's packages.

// Vite warns about chunks above this many kB (build.chunkSizeWarningLimit).
export const CHUNK_SIZE_LIMIT_KB = 500;

// three.js ships as two prebuilt files (three.module.js imports
// three.core.js), so a single vendor bundle passes the 500 kB warning.
// Keeping each prebuilt file, React and the G2P dictionaries in their own
// chunks keeps every chunk below the limit without raising
// chunkSizeWarningLimit. The workers use the same rules
// (worker.rollupOptions in vite.config.js).
const vendorChunks = [
  [/[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js$/, 'three-core'],
  [/[\\/]node_modules[\\/]three[\\/]build[\\/]/, 'three'],
  [/[\\/]node_modules[\\/]three[\\/]examples[\\/]/, 'three-addons'],
  [/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, 'react'],
  // The pronunciation dictionaries (the English one alone is ~250 kB of IPA,
  // two bytes per symbol) pushed the app entry and both workers past the
  // limit once the guard measured bytes (issue 115). They live in
  // src/g2p/lexicon/ since issue 47.
  [/[\\/]src[\\/]g2p[\\/][a-z]+-dict\.js$/, 'g2p-dict'],
  [/[\\/]src[\\/]g2p[\\/]lexicon[\\/][a-z]+\.js$/, 'g2p-dict'],
  [
    /[\\/]src[\\/]recognition[\\/]data[\\/]simulated-(?:whisper-)?phones\.js$/,
    'recognition-phones',
  ],
  // Standalone numerical kernels have no dependencies on the app or workers.
  [
    /[\\/]src[\\/]recognition[\\/](fft|lpc|pitch|pitch-rust|inverse-dsp|wasm-memory)\.js$/,
    'recognition-dsp',
  ],
  [/[\\/]src[\\/]recognition[\\/]/, 'recognition'],
  [/[\\/]src[\\/]acoustics[\\/]/, 'acoustics'],
];

export function vendorChunk(id) {
  // Each language's two count tables fit independently under the size guard.
  const counts = id.match(
    /[\\/]src[\\/]recognition[\\/]data[\\/]((?:en|hi|ru|zh)(?:-bigrams)?)\.js$/
  );
  if (counts) {
    return `recognition-${counts[1]}`;
  }
  return vendorChunks.find(([pattern]) => pattern.test(id))?.[1];
}

// Size in UTF-8 bytes, as Vite's reporter measures it (Buffer.byteLength).
// String length counts UTF-16 code units, so a chunk with non-ASCII text
// (IPA symbols, for one) passed this guard while Vite still warned that it
// was over the limit (issue 115).
function outputSize(output) {
  const content = output.type === 'chunk' ? output.code : output.source;
  if (content === undefined || content === null) {
    return 0;
  }
  return typeof content === 'string'
    ? Buffer.byteLength(content)
    : content.byteLength;
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
