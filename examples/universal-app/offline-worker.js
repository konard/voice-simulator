import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const ENTRY = 'virtual:copy-session-worker';
const MODULE = `\0${ENTRY}`;
const CHUNK = '\0copy-worker-';
export const workerBuildDir = fileURLToPath(
  new URL('./node_modules/.cache/voice-copy/', import.meta.url)
);

export function offlineWorkerChunk(id) {
  return id.startsWith(CHUNK) ? id.slice(1) : undefined;
}

// Load the production worker's script with the page, so opening the worker
// on demand needs only a Blob. Ship the text in separate static chunks to
// stay within the app's 500 kB per-chunk budget.
export function offlineWorkerChunks() {
  const chunks = new Map();
  let development;
  return {
    name: 'offline-session-worker',
    configResolved({ command }) {
      development = command === 'serve';
    },
    resolveId(id) {
      return id === ENTRY ? MODULE : chunks.has(id) ? id : null;
    },
    async load(id) {
      if (id !== MODULE) {
        return chunks.get(id) ?? null;
      }
      if (development) {
        return "export { default } from '/src/engine/session-worker.js?worker';";
      }

      const source = await readFile(
        `${workerBuildDir}/session-worker.js`,
        'utf8'
      );
      const imports = [];
      const names = [];
      for (let start = 0; start < source.length; start += 120_000) {
        const name = `script${names.length}`;
        const chunk = `${CHUNK}${names.length}`;
        chunks.set(
          chunk,
          `export default ${JSON.stringify(source.slice(start, start + 120_000))};`
        );
        imports.push(`import ${name} from ${JSON.stringify(chunk)};`);
        names.push(name);
      }
      return `
        ${imports.join('\n')}
        const source = new Blob([${names.join(', ')}], { type: 'text/javascript' });
        let url;
        export default function CopyWorker() {
          url ??= URL.createObjectURL(source);
          return new Worker(url, { type: 'module' });
        }
      `;
    },
  };
}
