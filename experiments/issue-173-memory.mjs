/** Peak memory by stage in a bounded 8 kHz workload. Unlicense. */
import {
  fitVoice,
  presetHeadConfig,
  recognize,
  synthesize,
} from '../src/index.js';
import { createEngine } from '../src/engine/index.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { configureNodeRecognitionModels } from '../src/recognition/node-models.js';
import { createRecognitionEngine } from '../src/recognition/engine.js';
import { BASELINE_TEXT } from '../src/recognition/mode-baseline.js';
import { HEAD, LANGUAGES } from '../tests/helpers/recognition-modes.js';
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
  function sum(node) {
    const { functionName, url, lineNumber } = node.callFrame;
    const location = `${functionName || '(anonymous)'} ${url}:${lineNumber + 1}`;
    totals.set(location, (totals.get(location) ?? 0) + node.selfSize);
    node.children.forEach(sum);
  }
  sum(profile.head);
  for (const [location, size] of [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)) {
    console.log(mb(size), location);
  }
  sampling.disconnect();
}
