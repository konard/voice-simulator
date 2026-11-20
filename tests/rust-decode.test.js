/** Class B parity from the shared frame observations and planner templates. */
import assert from 'node:assert/strict';
import {
  analyzeFrames,
  buildCodebook,
  CODEBOOK_CHANNELS,
  DEFAULT_HEAD,
  findLandmarks,
  invertArticulation,
  synthesize,
} from '../src/index.js';
import { float64View } from '../src/engine/wasm-loader.js';
import {
  decoderLanguage,
  decoderTemplates,
  TEMPLATE_CHANNELS,
} from '../src/recognition/decode-model.js';
import { decodeSearch, pathArcs } from '../src/recognition/decode-search.js';
import { prepareDecode } from '../src/recognition/decode-spans.js';
import { fixedCount } from '../src/recognition/decode-stream.js';
import { DECODE_WEIGHTS } from '../src/recognition/decode-weights.js';
import { PHONOTACTICS } from '../src/recognition/phonotactics.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';

function packet(
  frames,
  landmarks,
  track,
  languages,
  templates,
  { end, open, clock, beam, nbest, from, locked, lastUnit }
) {
  const count = Math.min(track.frameCount, Math.ceil(end / frames.hop - 1e-9));
  const { duration, class: broadClass, phonotactic } = DECODE_WEIGHTS;
  const values = [
    end,
    frames.hop,
    clock,
    count,
    landmarks.landmarks.length,
    templates.length,
    languages.length,
    beam,
    nbest,
    duration,
    broadClass,
    phonotactic,
    Number(open),
    from,
    Number(locked),
    lastUnit,
  ];
  const ranges = new Map(
    CODEBOOK_CHANNELS.map(({ name, min, max }) => [name, max - min])
  );
  values.push(...TEMPLATE_CHANNELS.map((name) => ranges.get(name) ?? 1));
  for (let t = 0; t < count; t++) {
    values.push(frames.speech[t], landmarks.classes[t]);
    for (const channels of [track.channels, track.variance]) {
      for (const name of TEMPLATE_CHANNELS) {
        values.push(channels[name][t]);
      }
    }
  }
  values.push(...landmarks.landmarks.map(({ time }) => time));
  for (const template of templates) {
    values.push(
      template.duration,
      template.classMask,
      template.compared.length
    );
    template.compared.forEach((cell) =>
      values.push(cell, template.values[cell])
    );
  }
  for (const lang of languages) {
    const { units, counts } = PHONOTACTICS[lang];
    values.push(
      units.length + 1,
      ...templates.map(({ ipa }) => units.indexOf(ipa)),
      ...counts
    );
  }
  return Float64Array.from(values);
}

function compare(engine, frames, landmarks, track, languages, openWindow) {
  const language = decoderLanguage({ languages });
  const templates = decoderTemplates(DEFAULT_HEAD, language.symbols);
  const open = Boolean(openWindow);
  const beam = 16;
  const nbest = 5;
  const endTime = frames.sampleCount / frames.rate;
  const { end, clock, readings } = openWindow ?? {
    end: endTime,
    clock: endTime,
    readings: nbest,
  };
  const from = open ? 0.187 : 0;
  const locked = open;
  const lastUnit = open ? 3 : templates.length;
  const observed = open
    ? { ...track, frameCount: Math.ceil(end / frames.hop - 1e-9) }
    : track;
  const prepared = prepareDecode(frames, landmarks, observed, templates, {
    from,
    locked,
    to: end,
    open,
  });
  const expected = decodeSearch(prepared, language, {
    weights: DECODE_WEIGHTS,
    beam,
    nbest,
    lastUnit,
  });
  assert.ok(prepared.times.length > 5);
  assert.equal(expected.paths.length, readings);
  const best = expected.paths[0] ?? (open ? expected.provisional : undefined);
  const fixed = fixedCount(
    pathArcs(best),
    expected.frontier,
    prepared.times,
    clock,
    !open
  );
  if (readings === 0) {
    assert.ok(fixed > 0, 'An open pause can follow the last reachable phone');
  }
  const input = packet(frames, landmarks, track, languages, templates, {
    end,
    open,
    clock,
    beam,
    nbest,
    from,
    locked,
    lastUnit,
  });
  const capacity =
    4 +
    language.costs.length +
    prepared.times.length +
    expected.edges.length * 6 +
    expected.paths.reduce((n, path) => n + 2 + pathArcs(path).length * 6, 0);
  const src = engine.exports.vs_alloc(input.byteLength);
  const dst = engine.exports.vs_alloc(capacity * 8);
  try {
    float64View(engine, src, input.length).set(input);
    assert.equal(
      engine.exports.vs_ipa_decode(src, input.length, dst, capacity),
      capacity
    );
    const out = float64View(engine, dst, capacity);
    let i = 0;
    function close(expectedValue, label) {
      const value = out[i++];
      assert.ok(
        Math.abs(value - expectedValue) < 1e-8,
        `${label} at ${i - 1}: ${value} vs ${expectedValue}`
      );
    }
    function arc({ from, to, unit, cost, confidence, long }) {
      close(from, 'from');
      close(to, 'to');
      close(unit, 'unit');
      close(cost, 'cost');
      if (confidence !== undefined) {
        close(confidence, 'confidence');
        close(Number(Boolean(long)), 'long');
      } else {
        i += 2;
      }
    }
    close(prepared.times.length, 'boundaries');
    close(expected.edges.length, 'edges');
    close(expected.paths.length, 'readings');
    close(fixed, 'fixed');
    language.costs.forEach((cost) => close(cost, 'transition'));
    prepared.times.forEach((time) => close(time, 'time'));
    expected.edges.forEach(arc);
    for (const path of expected.paths) {
      const arcs = pathArcs(path);
      close(path.cost, 'path cost');
      close(arcs.length, 'path length');
      arcs.forEach(arc);
    }
    assert.equal(i, capacity);
  } finally {
    engine.exports.vs_free(src, input.byteLength);
    engine.exports.vs_free(dst, capacity * 8);
  }
}

itUnless(noRust)(
  'matches Rust IPA boundaries, transitions, beam, and committed prefix',
  async () => {
    const engine = await loadRustEngine();
    const { samples, sampleRate } = synthesize('apa ata. aka.', {
      ipa: true,
      head: DEFAULT_HEAD,
      sampleRate: 8000,
      solver: 'waveguide',
      engine: 'js',
      seed: 1,
    });
    const frames = analyzeFrames(samples, sampleRate);
    const landmarks = findLandmarks(frames);
    const codebook = buildCodebook(DEFAULT_HEAD, { size: 512 });
    const track = invertArticulation(frames, { codebook });
    compare(engine, frames, landmarks, track, ['en', 'hi']);
    compare(engine, frames, landmarks, track, [], {
      end: 0.75,
      clock: 1.05,
      readings: 5,
    });
    // The next speech interval is still too short to connect to the terminal
    // boundary. Both engines commit against the latest reachable path.
    const speech = frames.speech.slice();
    speech.fill(1, 0, 100);
    speech.fill(0, 100, 140);
    speech.fill(1, 140, 142);
    compare(engine, { ...frames, speech }, landmarks, track, ['en'], {
      end: 0.71,
      clock: 1.25,
      readings: 0,
    });
  }
);
