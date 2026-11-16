/**
 * Changing the audio tier in the middle of an utterance (issue 29):
 * src/engine/adaptive-stream.js on the JavaScript engine and, when
 * src/engine/voice-simulator.wasm is built, on the Rust engine (CI runs
 * this file with REQUIRE_WASM=1).
 *
 * Waveguide tiers and a 48000 Hz stream unless a test says otherwise, seed
 * 1, plans of 1 s of `aː` and `sː` (./helpers/adaptive-stream.js), switches
 * asked for at 0.3 s.
 */

import { createHash } from 'node:crypto';

import { describe, expect } from 'test-anywhere';

import { resample } from '../src/audio/resample.js';
import { AdaptiveStream, switchGrid } from '../src/engine/adaptive-stream.js';
import { createEngine } from '../src/engine/index.js';
import { prepareUtterance, synthesize } from '../src/synthesize.js';
import {
  bestCorrelation,
  db,
  largestStep,
  rms,
  streamPlan,
  sustainedPlan,
  tierIndex,
} from './helpers/adaptive-stream.js';
import { noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

const RATE = 48000;
const at = (seconds) => Math.round(seconds * RATE);
const level = (name) => tierIndex(name);

// SHA-256 of synthesize('Hello world.', {seed: 1, tier, engine}) on main
// before this change, per runtime and platform (Linux:
// experiments/issue-29-offline-hashes.mjs; macOS and Windows:
// experiments/issue-29-main-probe.mjs on CI, which rendered origin/main and
// this branch side by side with the same hashes).
// The renders take Math.sin, Math.exp and friends from the runtime, whose
// last bits differ between runtimes and between platforms: each gives its
// own (unchanged) samples. The Rust engine is tested on Linux only.
const MINIMAL =
  '74690b09105eb6439c5eb11e8d968d32a0408e4a07700c6136f26b0f36597efc';
const BUN_MINIMAL =
  '3cad28ba5847765636a3b8c0aa64fb53c513a8db1c02eca2fef02573eed24e0f';
const OFFLINE = {
  node: {
    linux: {
      js: {
        minimal: MINIMAL,
        high: '5041ace3cb3650b4df956bacc66d94bd00150b4c70f7ee401726a878570d6263',
      },
      rust: {
        minimal: MINIMAL,
        high: '18bf65f4bf8e4851fb851974746bca011c384cc7461ede359a9d384c7cd151f5',
      },
    },
    darwin: {
      js: {
        minimal: MINIMAL,
        high: 'efc7c53bcecbac271c84d431d2e02aeca2ac2d9aa77fc0f4556ab4e8592f5b32',
      },
    },
    win32: {
      js: {
        minimal: MINIMAL,
        high: '092c50975db10f530ffad7c2519e28a838c77c1e998456d168f1243cc345ec1e',
      },
    },
  },
  deno: {
    linux: {
      js: {
        minimal: MINIMAL,
        high: 'e91447839743bac48759c3fb1c14ab64daf74943df5860352b04a979c737741a',
      },
      rust: {
        minimal: MINIMAL,
        high: '84ba157b39f9be75e91a2a2927da57a0ac32955f8dda487370296e2bf5d4fce1',
      },
    },
    darwin: {
      js: {
        minimal: MINIMAL,
        high: '53165b6887b5a5593a55b311a47a9a69b126a859e71b9b00cc1b7d1b19ee954f',
      },
    },
    win32: {
      js: {
        minimal: MINIMAL,
        high: 'c26f7fede8b1cdecdaf1610eeda2acc1cfd17c84665db00118ece5d311087d57',
      },
    },
  },
  bun: {
    linux: {
      js: {
        minimal: BUN_MINIMAL,
        high: 'f1a15f28df2ce6e75f8483a91b3f00804c6ec387fb43d5c7f95ca2b28c16ce30',
      },
      rust: {
        minimal: BUN_MINIMAL,
        high: '120f1d2edd688798a4d432610e744ef9224f497dccc35d0f0ddc233072439065',
      },
    },
    darwin: {
      js: {
        minimal: MINIMAL,
        high: '34ff80ff62f26793e13c8a970e78286dca857c78c6a3388f82c476d6bc96a4a1',
      },
    },
    win32: {
      js: {
        minimal: BUN_MINIMAL,
        high: '42f8780763a3964ad9e385f424b3acbe9ac09ba42bfd16d5bc432cd783efa441',
      },
    },
  },
};
const runtime = globalThis.Deno
  ? 'deno'
  : globalThis.process?.versions?.bun
    ? 'bun'
    : 'node';
const platform = globalThis.process?.platform;
const offline = (engine) => OFFLINE[runtime][platform]?.[engine];
const unrecorded = (engine) =>
  offline(engine)
    ? null
    : `the hashes of ${runtime} with the ${engine} engine were not recorded on ${platform}`;

function sha256(samples) {
  return createHash('sha256')
    .update(
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    )
    .digest('hex');
}

/** RMS of a range relative to the same range of a reference (dB). */
function relative(samples, reference, from, to) {
  return db(rms(samples, from, to) / rms(reference, from, to));
}

/** Stream `ipa` from `from` with one switch to `to` asked for at `time`. */
function switched(engine, plan, from, to, time = 0.3) {
  return streamPlan(engine, plan, level(from), {
    requests: [{ time, level: level(to) }],
  });
}

/** Engine and shared renders of one engine. */
function setup(name) {
  let loaded;
  const engine = () => (loaded ??= createEngine({ engine: name }));
  const vowel = sustainedPlan('aː');
  const noise = sustainedPlan('sː');
  // Renders shared between tests: plain renders and switches by key.
  const cache = new Map();
  const once = (key, render) => {
    if (!cache.has(key)) {
      cache.set(key, render());
    }
    return cache.get(key);
  };
  const plain = async (plan, tier) =>
    (
      await once(`${plan === vowel ? 'a' : 's'} ${tier}`, async () =>
        streamPlan(await engine(), plan, level(tier))
      )
    ).samples;
  const switchOf = (plan, from, to) =>
    once(`${plan === vowel ? 'a' : 's'} ${from}>${to}`, async () =>
      switched(await engine(), plan, from, to)
    );

  return { engine, vowel, noise, plain, switchOf };
}

function streamTests(name, skip, { engine, vowel }) {
  const it = itUnless(skip);
  describe(`adaptive stream (${name} engine)`, () => {
    it('no switch is the plain render', async () => {
      const options = { ipa: true, tier: 'minimal', seed: 1, engine: name };
      const expected = synthesize('aː', options).samples;
      const createRenderer = async (tier, extra) => {
        const prepared = prepareUtterance('aː', { ...options, tier });
        return (await engine()).createRenderer(prepared.plan, {
          ...prepared.renderOptions,
          ...extra,
        });
      };
      for (const streamRate of [22050, RATE]) {
        const stream = await AdaptiveStream.create({
          createRenderer,
          level: level('minimal'),
          streamRate,
        });
        const samples = new Float32Array(stream.totalSamples);
        // Uneven chunks: the output must not depend on them.
        for (let size = 1; !stream.done; size = (size * 7) % 1500 || 1) {
          await stream.render(
            samples.subarray(stream.position, stream.position + size)
          );
        }
        stream.close();
        if (streamRate === 22050) {
          expect(sha256(samples)).toBe(sha256(expected));
        } else {
          const reference = resample(expected, 22050, RATE, {
            zeroCrossings: 8,
          });
          expect(samples.length).toBe(reference.length);
          let worst = 0;
          for (let index = 0; index < samples.length; index++) {
            worst = Math.max(
              worst,
              Math.abs(samples[index] - reference[index])
            );
          }
          expect(worst).toBeLessThan(1e-6);
        }
      }
    });

    it('length never changes', async () => {
      const { samples, stream, accepted } = await streamPlan(
        await engine(),
        vowel,
        level('low'),
        {
          requests: [
            { time: 0.3, level: level('minimal') },
            { time: 0.7, level: level('low') },
          ],
        }
      );
      expect(accepted).toEqual([true, true]);
      expect(stream.switches.map((entry) => entry.level)).toEqual([
        level('minimal'),
        level('low'),
      ]);
      expect(stream.position).toBe(stream.totalSamples);
      expect(samples.every(Number.isFinite)).toBe(true);
    });

    it('switch time is on the common grid', async () => {
      expect(switchGrid(48000, 22050, 11025)).toBe(75);
      const { stream } = await switched(
        await engine(),
        vowel,
        'minimal',
        'narrowband'
      );
      const product = stream.switches[0].at * 75;
      expect(Math.abs(product - Math.round(product))).toBeLessThan(1e-9);
    });

    it('late request is dropped', async () => {
      const { stream, accepted } = await switched(
        await engine(),
        vowel,
        'low',
        'minimal',
        vowel.duration - 0.04
      );
      expect(accepted).toEqual([true]);
      expect(stream.switches).toEqual([]);
      expect(stream.level).toBe(level('low'));
    });

    it('same requests, same samples', async () => {
      const first = await switched(await engine(), vowel, 'low', 'minimal');
      const second = await switched(await engine(), vowel, 'low', 'minimal');
      expect(sha256(second.samples)).toBe(sha256(first.samples));
    });

    it('rooms only go down', async () => {
      const stream = await AdaptiveStream.create({
        createRenderer: async (tier, extra) =>
          (await engine()).createRenderer(vowel, {
            ...prepareUtterance('a', { ipa: true, tier, seed: 1 })
              .renderOptions,
            room: 'small-room',
            ...extra,
          }),
        level: level('low'),
        streamRate: RATE,
        room: true,
      });
      expect(stream.setLevel(level('medium'))).toBe(false);
      expect(stream.setLevel(level('minimal'))).toBe(true);
      stream.close();
    });

    itUnless(skip, unrecorded(name))('offline output is unchanged', () => {
      for (const tier of ['minimal', 'high']) {
        const { samples } = synthesize('Hello world.', {
          seed: 1,
          tier,
          engine: name,
        });
        expect(sha256(samples)).toBe(offline(name)[tier]);
      }
    });
  });
}

function levelTests(name, it, { vowel, noise, plain, switchOf }) {
  describe(`adaptive stream levels (${name} engine)`, () => {
    for (const [from, to, limit] of [
      ['low', 'minimal', 1],
      ['medium', 'high', 1.5],
    ]) {
      it(`vowel switch keeps the level (${from} to ${to})`, async () => {
        const before = await plain(vowel, from);
        const { samples, stream } = await switchOf(vowel, from, to);
        let worst = 0;
        for (let t = at(0.25); t + at(0.005) <= at(0.45); t += at(0.005)) {
          const difference = relative(samples, before, t, t + at(0.005));
          worst = Math.max(worst, Math.abs(difference));
        }
        expect(worst).toBeLessThan(limit);
        if (from === 'low') {
          expect(stream.switches[0].r).toBeGreaterThan(0.9);
        }
        expect(largestStep(samples, at(0.25), at(0.45))).toBeLessThanOrEqual(
          1.5 * largestStep(before, at(0.25), at(0.45))
        );
      });
    }

    it('noise switch keeps the level', async () => {
      // medium to low, the first step down from the default tier. The level
      // of 25 ms of this noise moves by up to 1.3 dB from one window to the
      // next without any switch (experiments/issue-29-level-drift.mjs), so
      // the switch is also held to the movement of the plain render.
      for (const [from, to] of [
        ['medium', 'low'],
        ['low', 'minimal'],
      ]) {
        const { samples, stream } = await switchOf(noise, from, to);
        const before = await plain(noise, from);
        const [entry] = stream.switches;
        const fade = Math.round(entry.at * RATE) + at(0.03);
        const N = at(0.025);
        const change = db(
          rms(samples, fade, fade + N) / rms(samples, fade - N, fade)
        );
        const own = db(
          rms(before, fade, fade + N) / rms(before, fade - N, fade)
        );
        if (from === 'medium') {
          expect(Math.abs(change)).toBeLessThan(1);
        }
        expect(Math.abs(change - own)).toBeLessThan(0.5);
        expect(entry.r).toBeLessThan(0.3);
      }
    });

    it('pitch continues in phase', async () => {
      const { samples } = await switchOf(vowel, 'low', 'minimal');
      const target = await plain(vowel, 'minimal');
      const { correlation, lag } = bestCorrelation(
        samples,
        target,
        at(0.5),
        at(0.6),
        24
      );
      expect(correlation).toBeGreaterThanOrEqual(0.95);
      expect(Math.abs(lag)).toBeLessThanOrEqual(12);
    });

    it('level is matched', async () => {
      const { samples, stream } = await switchOf(vowel, 'medium', 'high');
      const before = await plain(vowel, 'medium');
      expect(
        Math.abs(relative(samples, before, at(0.4), at(0.6)))
      ).toBeLessThan(0.5);
      const { gainDb } = stream.switches[0];
      expect(gainDb).toBeGreaterThanOrEqual(-6);
      expect(gainDb).toBeLessThanOrEqual(6);
    });
  });
}

for (const [name, skip] of [
  ['js', null],
  ['rust', noRust],
]) {
  const context = setup(name);
  streamTests(name, skip, context);
  levelTests(name, itUnless(skip), context);
}
