/** Measured voice-fit gates and tables, shared with report archival. Unlicense. */
import { isReviewed } from '../../helpers/golden.js';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.ceil((sorted.length - 1) / 2)]) /
    2
  );
}

export function voiceFitGates({ synthetic, golden }) {
  const gates = [];
  for (const transcript of [true, false]) {
    const rows = synthetic.filter((r) => r.transcript === transcript);
    if (!rows.length) {
      continue;
    }
    const add = (metric, measured, limit, minimum = false) =>
      gates.push({
        mode: transcript ? 'transcript' : 'no transcript',
        metric,
        measured,
        limit,
        comparison: minimum ? '>=' : '<=',
        passed: minimum ? measured >= limit : measured <= limit,
      });
    for (const [key, gate] of Object.entries({
      vocalTractLength: transcript ? 0.04 : 0.06,
      pitch: 0.02,
      speechRate: 0.08,
      tenseness: 0.15,
      breathiness: 0.2,
    })) {
      add(`median ${key} error`, median(rows.map((r) => r.errors[key])), gate);
    }
    add(
      'maximum tract error',
      Math.max(...rows.map((r) => r.errors.vocalTractLength)),
      0.1
    );
    add(
      'tract 3 SD coverage',
      rows.filter((r) => r.covered).length,
      Math.ceil(rows.length * 0.8),
      true
    );
  }
  for (const row of golden) {
    gates.push({
      mode: row.transcript ? 'transcript' : 'no transcript',
      metric: `${row.id} distance`,
      measured: row.distance,
      limit: row.presetDistance,
      comparison: '<=',
      passed: row.distance <= row.presetDistance,
    });
  }
  return gates;
}

export function voiceFitMarkdown(data) {
  const { synthetic, golden } = data;
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');
  return [
    '# Voice configuration fit (issue 63)',
    '',
    'Command: `npm run test:heavy -- --suite copy`. Seed 1, maxRenders 40.',
    'All fitted uncertainties are rough indicators, not confidence intervals.',
    'An asterisk marks a golden transcript or IPA not confirmed by a human. No audio is replayed.',
    '',
    '## Gates',
    '',
    '| Mode | Metric | Measured | Requirement | Pass |',
    '| --- | --- | --- | --- | --- |',
    ...voiceFitGates(data).map(
      (g) =>
        `| ${g.mode} | ${g.metric} | ${fmt(g.measured)} | ${g.comparison} ${fmt(g.limit)} | ${g.passed} |`
    ),
    '',
    '## Synthetic recordings',
    '',
    '| Seed | Transcript | Tract error | Pitch error | Rate error | Tenseness error | Breathiness error | Tract 3 SD covers truth |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...synthetic.map(
      (r) =>
        `| ${r.seed} | ${r.transcript} | ${fmt(r.errors.vocalTractLength)} | ${fmt(r.errors.pitch)} | ${fmt(r.errors.speechRate)} | ${fmt(r.errors.tenseness)} | ${fmt(r.errors.breathiness)} | ${r.covered} |`
    ),
    '',
    '## Golden recordings',
    '',
    '| Recording | Speaker | Sex | Transcript | Tract (cm ± SD) | Distance | Preset distance | MCD (dB) | Preset MCD (dB) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...golden.map(
      (r) =>
        `| ${r.id}${isReviewed(r) ? '' : '*'} | ${r.speaker.id} | ${r.speaker.sex} | ${r.transcript} | ${fmt(r.parameters.vocalTractLength.value)} ± ${fmt(r.parameters.vocalTractLength.sd)} | ${fmt(r.distance)} | ${fmt(r.presetDistance)} | ${fmt(r.mcd)} | ${fmt(r.presetMcd)} |`
    ),
    '',
    'All fitted values and SDs are in the JSON report. Plausibility reference:',
    'female tract 14–15 cm; male tract 16–18 cm. These are descriptive references, not gates.',
    'Manifest sex is retained verbatim, including unknown; it is not inferred from the fit.',
    'Ungated targets: distance at most half the preset for 80% of recordings;',
    'MCD at least 0.5 dB better than the preset.',
    `Measured half-distance share: ${fmt(golden.filter((r) => r.distance <= 0.5 * r.presetDistance).length / Math.max(1, golden.length))}.`,
    `Measured MCD improvement share: ${fmt(golden.filter((r) => r.presetMcd - r.mcd >= 0.5).length / Math.max(1, golden.length))}.`,
    '',
  ].join('\n');
}
