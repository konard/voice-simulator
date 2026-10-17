// Repeats the /api/timeline round trip and logs which step stalls.
// deno run -A experiments/issue-5-deno-server-hang.mjs [iterations] [fix]
//
// Deno 2.9.7: the first iteration stalls at `close` (two sequential fetches
// leave a pooled keep-alive socket that server.close() waits for). Node never
// stalls. With `fix`, closeAllConnections() runs first and nothing stalls.
import { createVoiceServer } from '../src/server/server.js';

const args = globalThis.Deno?.args ?? process.argv.slice(2);
const iterations = Number(args[0] ?? 200);
const fix = args[1] === 'fix';
const step = async (label, promise, ms = 5000) => {
  let timer;
  const stall = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`stalled at ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, stall]);
  } finally {
    clearTimeout(timer);
  }
};

for (let i = 0; i < iterations; i++) {
  const server = createVoiceServer({ version: '1.0.0' });
  await step('listen', new Promise((r) => server.listen(0, '127.0.0.1', r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await step('fetch', fetch(`${base}/api/timeline?text=hi`));
    await step('json', ok.json());
    const missing = await step('fetch 400', fetch(`${base}/api/timeline`));
    await step('json 400', missing.json());
    if (fix) {
      server.closeAllConnections();
    }
    await step('close', new Promise((r) => server.close(r)));
  } catch (error) {
    console.log(`iteration ${i}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`${iterations} iterations without a stall`);
