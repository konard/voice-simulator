/**
 * Run a callback against a voice server on a free local port.
 *
 * The server is closed with `closeAllConnections()` first: Deno's
 * `node:http` (2.9) keeps the keep-alive connection that `fetch` pooled
 * after two sequential requests, so a bare `server.close()` never calls
 * back and the test hangs until the suite budget kills it
 * (`experiments/issue-5-deno-server-hang.mjs`). Every request has been
 * answered by then, so closing the sockets loses nothing.
 */

import { createVoiceServer } from '../../src/server/server.js';

/**
 * @param {Parameters<typeof createVoiceServer>[0]} options
 * @param {(base: string) => Promise<void>} run receives `http://127.0.0.1:port`
 */
export async function withVoiceServer(options, run) {
  const server = createVoiceServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
