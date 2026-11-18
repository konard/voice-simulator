// Unlicense. Isolated in-memory prototype: five calibration renders and two fits.
// No production file is written. Execute with node --max-old-space-size=384.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { synthesize } from '../../src/synthesize.js';
import {
  BREATHINESS_HNR,
  MATCH_TEXT,
} from '../../src/analysis/voice-fit-calibration.js';

const statisticsFile = new URL(
  '../../src/analysis/voice-fit-statistics.js',
  import.meta.url
);
const fitterFile = new URL('../../src/analysis/voice-fit.js', import.meta.url);
function moduleUrl(source, file) {
  const absolute = source.replace(
    /(['"])(\.[^'"\n]+)\1/g,
    (_, quote, path) => `${quote}${new URL(path, file).href}${quote}`
  );
  return `data:text/javascript;base64,${Buffer.from(absolute).toString('base64')}`;
}
const originalStatistics = readFileSync(statisticsFile, 'utf8');
const sourceStatement =
  'const source = inverseFilter(frames, { pitch, trace: options.trace ?? null });';
assert.ok(originalStatistics.includes(sourceStatement), 'Source hook changed');
const statisticsSource = originalStatistics.replace(
  sourceStatement,
  'const source = inverseFilter(frames, { pitch, trace: options.trace ?? null }); source.hnr = cycleNoise(frames, pitch);'
);
const statisticsUrl = moduleUrl(
  `import { cycleNoise } from '${new URL('./cycle-noise.mjs', import.meta.url).href}';\n${statisticsSource}`,
  statisticsFile
);
const statistics = await import(statisticsUrl);
const fitterSource = readFileSync(fitterFile, 'utf8').replaceAll(
  "'./voice-fit-statistics.js'",
  JSON.stringify(statisticsUrl)
);
const { fitVoice } = await import(moduleUrl(fitterSource, fitterFile));
const render = (text, head) =>
  synthesize(text, {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
const table = [];
for (const breathiness of [0, 0.25, 0.5, 0.75, 1]) {
  const audio = render(MATCH_TEXT, { breathiness });
  const state = statistics.accumulate(
    statistics.emptyState(),
    audio.samples,
    16000,
    {},
    false
  );
  table.push([breathiness, statistics.quantile(state, 'hnr')]);
}
BREATHINESS_HNR.splice(0, BREATHINESS_HNR.length, ...table);
console.log(JSON.stringify({ calibration: table }));
const text = 'The north wind and the sun.';
for (const truth of [
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
]) {
  const audio = render(text, truth);
  const initial = fitVoice(audio.samples, 16000, { refine: false });
  const result = fitVoice(audio.samples, 16000, {
    transcript: text,
    maxRenders: 10,
  });
  const select = (head) =>
    Object.fromEntries(
      [...Object.keys(truth), 'breathiness'].map((k) => [k, head[k]])
    );
  console.log(
    JSON.stringify({
      truth,
      initial: select(initial.head),
      result: select(result.head),
      distance: result.distance,
      renders: result.renders,
    })
  );
}
