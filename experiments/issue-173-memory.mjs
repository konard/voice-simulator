/** Peak memory by stage in a bounded 8 kHz workload. Unlicense. */
import {
  fitVoice,
  presetHeadConfig,
  recognize,
  synthesize,
} from '../src/index.js';
import { createEngine } from '../src/engine/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { configureNodeRecognitionModels } from '../src/recognition/node-models.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';
import { BASELINE_TEXT } from '../src/recognition/mode-baseline.js';
import { HEAD, LANGUAGES } from '../tests/helpers/recognition-modes.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { ROWS, loadEngine } from '../scripts/lowest-rows.mjs';
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';
import { Session } from 'node:inspector/promises';

const rate = 8000;
const [mode, engine = 'js', limit] = process.argv.slice(2);
let sampling;
if (process.env.VOICE_MEMORY_SAMPLING === '1') {
  sampling = new Session();
  sampling.connect();
  await sampling.post('HeapProfiler.startSampling', {
    samplingInterval: 65536,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
}
const mb = (bytes) => Number((bytes / 1048576).toFixed(1));
function report(stage) {
  const { rss, heapUsed, arrayBuffers } = process.memoryUsage();
  const spaces =
    process.env.VOICE_MEMORY_SPACES === '1'
      ? Object.fromEntries(
          getHeapSpaceStatistics().map(
            ({ space_name, physical_space_size }) => [
              space_name,
              mb(physical_space_size),
            ]
          )
        )
      : undefined;
  console.log(stage, {
    rss: mb(rss),
    heap: mb(heapUsed),
    physicalHeap: mb(getHeapStatistics().total_physical_size),
    arrays: mb(arrayBuffers),
    peak: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
    ...(spaces && { spaces }),
  });
}

report('start');
function render(text, head) {
  return synthesize(text, {
    lang: 'en',
    tier: 'telephone',
    head,
    engine: 'js',
    seed: 1,
  }).samples;
}
if (
  [
    'streaming',
    'copy',
    'modes-row',
    'session',
    'recognition',
    'synthesis',
  ].includes(mode)
) {
  const loaded = await loadEngine(engine);
  if (loaded.unavailable) {
    throw new Error(loaded.unavailable);
  }
  let peak = 0;
  const profile = (stage) => {
    const next = process.resourceUsage().maxRSS;
    if (next - peak >= 2048 || /^(?:[A-Z][a-z]+$|Session )/u.test(stage)) {
      report(stage);
      peak = next;
    }
  };
  const count = limit === 'full' ? Infinity : Number(limit ?? 1);
  const row = mode === 'modes-row' ? 'modes' : mode;
  await ROWS[row]({
    engine: loaded,
    limit: count,
    baseline: engine === 'js',
    profile,
  });
} else if (mode === 'features') {
  const { createHash } = await import('node:crypto');
  const { lda } = getHmmModel();
  const samples = render(BASELINE_TEXT.en);
  const count = Number(limit ?? 10);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new RangeError('Expected 1 to 1000 feature iterations');
  }
  let output;
  for (let i = 0; i < count; i++) {
    output = hmmFeatures(samples, rate, lda, undefined, true, true);
  }
  const hash = createHash('sha256');
  for (const column of [output.feats, output.tone]) {
    hash.update(
      new Uint8Array(column.buffer, column.byteOffset, column.byteLength)
    );
  }
  console.log('SHA-256', hash.digest('hex'));
  console.log('CPU seconds', process.cpuUsage().user / 1e6);
} else if (mode === 'render') {
  const count = Number(limit ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new RangeError('Expected 1 to 20 sentences per language and preset');
  }
  for (const tier of ['telephone', 'wideband']) {
    for (let i = 0; i < count; i++) {
      for (const lang of LANGUAGES) {
        for (const preset of ['male', 'female']) {
          synthesize(sentences[lang][i], {
            lang,
            tier,
            head: 'random',
            preset,
            seed: 1,
            engine,
          });
        }
      }
    }
    report(tier);
  }
  console.log('CPU seconds', process.cpuUsage().user / 1e6);
} else if (mode === 'fit') {
  await createEngine({ engine, threads: 1, simd: false });
  let peak = 0;
  const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
  for (const preset of ['male', 'female', 'child']) {
    const samples = render(text, presetHeadConfig(preset));
    report(`synthesis ${preset}`);
    fitVoice(samples.subarray(0, 10 * rate), rate, {
      language: 'en',
      engine,
      threads: 1,
      profile(stage) {
        const now = process.resourceUsage().maxRSS;
        if (now > peak) {
          peak = now;
          report(stage);
        }
      },
    });
    report(`fit ${preset}`);
  }
} else if (mode === 'network') {
  configureNodeRecognitionModels();
  const model = getHmmModel();
  report('acoustic model');
  const languages = ['en', 'ru', 'hi', 'zh'];
  if (limit === 'all') {
    getNetwork(model, languages);
    report('combined vocabulary');
  } else {
    for (const lang of languages) {
      getNetwork(model, [lang]);
      report(`vocabulary ${lang}`);
    }
  }
} else if (mode === 'modes') {
  await createRecognitionEngine({ engine });
  for (const lang of LANGUAGES) {
    const { samples } = synthesize(BASELINE_TEXT[lang], {
      lang,
      tier: 'telephone',
      head: HEAD,
      engine: 'js',
      seed: 1,
    });
    report(`synthesis ${lang}`);
    recognize(samples, rate, {
      level: 'low',
      voice: HEAD,
      languages: [lang],
      engine,
      profile: report,
    });
  }
} else {
  const samples = render('Hello world.');
  report('synthesis');
  for (let i = 0; i < 2; i++) {
    recognize(samples, rate, { level: 'low', profile: report });
  }
}
report('done');
if (sampling) {
  const { profile } = await sampling.post('HeapProfiler.stopSampling');
  const totals = new Map();
  const includeCallers = process.env.VOICE_MEMORY_CALLERS === '1';
  function sum(node, caller) {
    const { functionName, url, lineNumber } = node.callFrame;
    const location = `${functionName || '(anonymous)'} ${url}:${lineNumber + 1}`;
    const key = includeCallers && caller ? `${location} ← ${caller}` : location;
    totals.set(key, (totals.get(key) ?? 0) + node.selfSize);
    for (const child of node.children) {
      sum(child, location);
    }
  }
  sum(profile.head);
  for (const [location, size] of [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)) {
    console.log(mb(size), location);
  }
  sampling.disconnect();
}
