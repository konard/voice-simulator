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

const rate = 8000;
const [mode, engine = 'js'] = process.argv.slice(2);
const mb = (bytes) => Number((bytes / 1048576).toFixed(1));
function report(stage) {
  const { rss, heapUsed, arrayBuffers } = process.memoryUsage();
  console.log(stage, {
    rss: mb(rss),
    heap: mb(heapUsed),
    arrays: mb(arrayBuffers),
    peak: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
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
if (mode === 'fit') {
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
  for (const lang of ['en', 'ru', 'hi', 'zh']) {
    getNetwork(model, [lang]);
    report(`vocabulary ${lang}`);
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
