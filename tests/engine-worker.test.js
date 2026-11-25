/**
 * The synthesis worker (src/engine/worker-protocol.js), driven without a
 * Worker: createWorkerHandler gets a `post` that records the messages.
 */

import { describe, it, expect } from 'test-anywhere';

import { createWorkerHandler } from '../src/engine/worker-protocol.js';
import { DEFAULT_HEAD, synthesize } from '../src/index.js';
import { audioTierIndex } from '../src/perf/lod.js';

function recorder(options = {}) {
  const messages = [];
  const handle = createWorkerHandler((message) => messages.push(message), {
    requestGpuDevice: () => null,
    ...options,
  });
  return { messages, handle };
}

const of = (messages, type) =>
  messages.filter((message) => message.type === type);

/** The chunks follow each other and fill the utterance. */
function expectContiguous(messages) {
  const [start] = of(messages, 'start');
  let next = 0;
  for (const chunk of of(messages, 'chunk')) {
    expect(chunk.start).toBe(next);
    next += chunk.samples.length;
  }
  expect(next).toBe(start.totalSamples);
}

/** The samples of all chunks in one array. */
function joined(messages) {
  const chunks = of(messages, 'chunk');
  const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0);
  const samples = new Float32Array(total);
  for (const chunk of chunks) {
    samples.set(chunk.samples, chunk.start);
  }
  return samples;
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

  it('a slow tier is left without a restart', async () => {
    const medium = audioTierIndex('medium');
    // Medium and above take 1.5 times real time, the rest 0.2.
    const { messages, handle } = recorder({
      busy: (level, audio) => audio * (level >= medium ? 1.5 : 0.2),
    });
    await handle({ ...SPEAK, auto: true, tier: medium, chunkSize: 1024 });
    expect(of(messages, 'start').length).toBe(1);
    expect(of(messages, 'start')[0].sampleRate).toBe(48000);
    expect(of(messages, 'overload')).toEqual([]);
    const tiers = of(messages, 'tier');
    expect(tiers.length).toBe(1);
    expect(tiers[0].reason).toBe('load');
    expect(tiers[0].from).toBe(medium);
    expect(tiers[0].level).toBeLessThan(medium);
    expect(tiers[0].at).toBeLessThan(0.4);
    expect(of(messages, 'end')[0].level).toBe(tiers[0].level);
    expectContiguous(messages);
  });

  it('a fast device climbs', async () => {
    const minimal = audioTierIndex('minimal');
    const { messages, handle } = recorder({
      busy: (level, audio) => audio * 0.05,
    });
    // About 8.6 s of speech.
    const ipa = 'həˈloʊ wɝld '.repeat(12).trim();
    await handle({ ...SPEAK, ipa, auto: true, tier: minimal, chunkSize: 1024 });
    const tiers = of(messages, 'tier');
    expect(tiers.length).toBeGreaterThanOrEqual(1);
    for (const message of tiers) {
      expect(message.level).toBe(message.from + 1);
      expect(message.reason).toBe('headroom');
    }
    expect(tiers[0].at).toBeGreaterThanOrEqual(3);
    expectContiguous(messages);
  });

  it('an underrun steps down', async () => {
    const medium = audioTierIndex('medium');
    const { messages, handle } = recorder({ busy: () => 0 });
    const speaking = handle({ ...SPEAK, auto: true, tier: medium });
    await handle({ type: 'underrun', id: SPEAK.id });
    await speaking;
    const tiers = of(messages, 'tier');
    expect(tiers.length).toBe(1);
    expect(tiers[0].reason).toBe('underrun');
    expect(tiers[0].level).toBe(medium - 1);
    expectContiguous(messages);
  });

  it('a fixed tier never switches', async () => {
    const { messages, handle } = recorder({
      busy: (level, audio) => audio * 5,
    });
    await handle({ ...SPEAK, tier: audioTierIndex('medium') });
    expect(of(messages, 'tier')).toEqual([]);
    expect(of(messages, 'overload')).toEqual([]);
    expect(of(messages, 'end')[0].level).toBe(audioTierIndex('medium'));
    const { samples } = synthesize(SPEAK.ipa, {
      ipa: true,
      lang: SPEAK.lang,
      head: SPEAK.head,
      seed: SPEAK.seed,
      tier: audioTierIndex('medium'),
    });
    const bits = (array) => new Uint32Array(array.buffer, array.byteOffset);
    const heard = bits(joined(messages));
    const expected = bits(samples);
    expect(heard.length).toBe(expected.length);
    expect(heard.every((value, index) => value === expected[index])).toBe(true);
  });

  it('speech settings reach the renderer (issue 170)', async () => {
    const settings = {
      breaths: true,
      source: 'folds',
      interaction: true,
      subglottal: false,
      headroom: 6,
    };
    const { messages, handle } = recorder();
    await handle({ ...SPEAK, ...settings });
    const { samples } = synthesize(SPEAK.ipa, {
      ipa: true,
      lang: SPEAK.lang,
      head: SPEAK.head,
      seed: SPEAK.seed,
      tier: SPEAK.tier,
      ...settings,
    });
    const plain = recorder();
    await plain.handle(SPEAK);
    const heard = joined(messages);
    expect(heard.length).toBe(samples.length);
    expect(heard.every((value, index) => value === samples[index])).toBe(true);
    const before = joined(plain.messages);
    expect(heard.some((value, index) => value !== before[index])).toBe(true);
  });
});
