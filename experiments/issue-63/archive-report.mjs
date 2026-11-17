// Unlicense. Archive a complete CI report with explicit measurement provenance.
// node experiments/issue-63/archive-report.mjs <artifact.json> <run-id> <sha>
import { readFileSync, writeFileSync } from 'node:fs';
import {
  voiceFitGates,
  voiceFitMarkdown,
} from '../../tests/heavy/helpers/voice-fit-report.js';

const [input, run, sha] = process.argv.slice(2);
if (!input || !/^\d+$/.test(run ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  throw new Error(
    'Expected artifact JSON, workflow run ID and full measured SHA'
  );
}
const data = JSON.parse(readFileSync(input, 'utf8'));
if (data.synthetic.length !== 40 || data.golden.length !== 48) {
  throw new Error(
    'Expected all 20 synthetic heads and 24 golden recordings in both modes'
  );
}
const provenance = {
  run: `https://github.com/konard/voice-simulator/actions/runs/${run}`,
  sha,
};
const prefix = `Measured revision: [${sha.slice(0, 7)}](https://github.com/konard/voice-simulator/commit/${sha}).\nWorkflow: [${run}](${provenance.run}).\n\nThese are measurements of that revision, not a claim that the current revision passes.\nThe archived rows retain their original values and SDs. The gate table uses the\narithmetic mean of the middle two values for even-sized medians.\n\n`;
writeFileSync(
  'docs/reports/copy-voice-fit.md',
  prefix + voiceFitMarkdown(data)
);
// One record per line keeps this generated data easy to inspect in bounded chunks.
writeFileSync(
  'docs/reports/copy-voice-fit.json',
  `{"provenance":${JSON.stringify(provenance)},\n"gates":${JSON.stringify(voiceFitGates(data))},\n"synthetic":[\n${data.synthetic.map((r) => JSON.stringify(r)).join(',\n')}\n],\n"golden":[\n${data.golden.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`
);
