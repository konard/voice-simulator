/** Copy-synthesis objective gates on the public-domain golden set. Unlicense. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { it } from 'test-anywhere';
import { createEngine } from '../../src/engine/index.js';
import {
  COPY_TIERS,
  copyReportContext,
  formatCopyReport,
  measureTiers,
} from '../../scripts/copy-report.mjs';
import {
  copyRecording,
  compareRecordings,
  renderScore,
} from '../../src/index.js';
import { loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const thresholds = JSON.parse(
  readFileSync(new URL('./copy-thresholds.json', import.meta.url), 'utf8')
);
const golden = loadGolden().slice(0, heavyLimit(24));

it('copies the golden set', async () => {
  const engine = await createEngine({ threads: 1 });
  const context = copyReportContext(
    'npm run test:heavy -- --suite copy',
    engine.name
  );
  const rows = [];
  for (const item of golden) {
    rows.push(...measureTiers(item, COPY_TIERS, { engine }));
  }
  writeReport('copy-synthesis', formatCopyReport(rows, context), {
    ...context,
    rows,
  });
  assert.ok(
    Number.isFinite(thresholds.mcdDb),
    'Set the MCD gate to 1.05 times the first full-corpus mean'
  );
  const failures = rows.filter(
    ({ f0, timingError, mcd }) =>
      f0.rmseCents === null ||
      f0.rmseCents > thresholds.f0RmseCents ||
      f0.vde === null ||
      f0.vde > thresholds.voicingError ||
      timingError === null ||
      timingError > thresholds.timingErrorMs ||
      mcd > thresholds.mcdDb
  );
  assert.deepEqual(
    failures.map(({ id, tier, f0, timingError, mcd }) => ({
      id,
      tier,
      rmseCents: f0.rmseCents,
      voicingError: f0.vde,
      timingError,
      mcd,
    })),
    []
  );
});

it('refinement helps', async () => {
  const engine = await createEngine({ threads: 1 });
  const options = { engine, tier: 'medium' };
  const rows = golden.map((item) => {
    const { score, metrics } = copyRecording(item.samples, item.sampleRate, {
      ...options,
      refine: true,
    });
    // Both copies use the same recording analysis. Replay the base score
    // before the measured articulation tracks are applied.
    const base = renderScore({ ...score, articulation: undefined }, options);
    return {
      id: item.id,
      base: compareRecordings(item, base).lsd,
      refined: metrics.lsd,
    };
  });
  const improved = rows.filter(({ base, refined }) => refined < base).length;
  const lines = [
    '# Copy refinement',
    '',
    '| Recording | LSD before (dB) | LSD after (dB) |',
    '| --- | ---: | ---: |',
    ...rows.map(({ id, base, refined }) => `| ${id} | ${base} | ${refined} |`),
  ];
  writeReport('copy-refinement', lines.join('\n'), { rows, improved });
  assert.ok(
    (rows.length - improved) / rows.length <= thresholds.refinementMissRate,
    `${improved}/${rows.length} recordings improved`
  );
});
