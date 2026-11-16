/**
 * The synthesis worker (src/engine/worker-protocol.js), driven without a
 * Worker: createWorkerHandler gets a `post` that records the messages.
 */

import { describe, it, expect } from 'test-anywhere';

import { createWorkerHandler } from '../src/engine/worker-protocol.js';
import { DEFAULT_HEAD } from '../src/index.js';

function recorder() {
  const messages = [];
  const handle = createWorkerHandler((message) => messages.push(message), {
    requestGpuDevice: () => null,
  });
  return { messages, handle };
}

const SPEAK = {
  type: 'speak',
  id: 1,
  ipa: 'həˈloʊ',
  lang: 'en',
  head: DEFAULT_HEAD,
  seed: 1,
  tier: 0,
  auto: false,
  chunkSize: 512,
};

describe('engine worker', () => {
  it('speak streams chunks', async () => {
    const { messages, handle } = recorder();
    await handle(SPEAK);
    const types = messages.map((message) => message.type);
    expect(types[0]).toBe('start');
    expect(types.at(-1)).toBe('end');
    expect(types.filter((type) => type === 'chunk').length >= 1).toBe(true);
    const [start] = messages;
    expect(['rust', 'js']).toContain(start.engine);
    expect(start.id).toBe(1);
    const chunks = messages.filter((message) => message.type === 'chunk');
    const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0);
    expect(total).toBe(start.totalSamples);
    // engine: 'js' renders in JavaScript, with no fallback reason.
    const js = recorder();
    await js.handle({ ...SPEAK, engine: 'js' });
    expect(js.messages[0].engine).toBe('js');
    expect(js.messages[0].fallbackReason).toBe(null);
  });

  it('engine message answers', async () => {
    const { messages, handle } = recorder();
    await handle({ type: 'engine' });
    const [reply] = messages;
    expect(reply.type).toBe('engine');
    expect(['rust', 'js']).toContain(reply.name);
    expect(reply.threads).toBe(1);
    expect(typeof reply.simd).toBe('boolean');
    await handle({ type: 'engine', engine: 'js' });
    expect(messages[1]).toEqual({
      type: 'engine',
      name: 'js',
      simd: false,
      threads: 1,
      reason: null,
    });
  });

  it('cancel stops', async () => {
    const { messages, handle } = recorder();
    const speaking = handle(SPEAK);
    await handle({ type: 'cancel', id: 1 });
    await speaking;
    const types = messages.map((message) => message.type);
    expect(types).not.toContain('end');
    expect(types.filter((type) => type === 'chunk').length <= 1).toBe(true);
  });
});
