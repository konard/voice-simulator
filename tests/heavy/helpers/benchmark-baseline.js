/** Quality floors and baseline comparisons for the measured benchmark. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

export const ERROR_METRICS = ['per', 'classErr', 'wer', 'cer', 'toneErr'];
export const FLEURS = ['fleurs-en', 'fleurs-ru', 'fleurs-hi', 'fleurs-zh'];
const BASELINE = new URL('../baselines/recognition.json', import.meta.url);
const COMMITTED_REPORT = new URL(
  '../../../docs/reports/recognition-benchmark.md',
  import.meta.url
);

export function readBaseline() {
  if (existsSync(BASELINE)) {
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
  }
  return null;
}

function* ratePairs(measured, baseline) {
  for (const [id, levels] of Object.entries(measured.sets)) {
    for (const [level, now] of Object.entries(levels)) {
      const old = baseline.sets[id]?.[level];
      if (old) {
        yield { label: `${id} ${level}`, now, old };
      }
    }
  }
}

function errorIncreases(now, old, margin) {
  return ERROR_METRICS.filter(
    (key) =>
      Number.isFinite(now[key]) &&
      Number.isFinite(old[key]) &&
      now[key] > old[key] + margin
  );
}

function regressedMetrics(now, old, error, language, rtf) {
  const changes = errorIncreases(now, old, error);
  if (
    Number.isFinite(now.languageRight) &&
    Number.isFinite(old.languageRight) &&
    now.languageRight < old.languageRight - language
  ) {
    changes.push('languageRight');
  }
  if (Number.isFinite(old.rtf) && now.rtf > old.rtf * rtf) {
    changes.push('rtf');
  }
  return changes;
}

export function checkBaseline(measured, baseline, margins = {}) {
  const {
    error = 0.02,
    language = 0.04,
    rtf = 1.5,
    notice = console.log,
  } = margins;
  const failures = [];
  if (!baseline) {
    notice('no baseline');
    return failures;
  }
  if (measured.limit !== baseline.limit) {
    notice(
      `baseline comparison skipped: limit ${measured.limit} differs from ${baseline.limit}`
    );
    return failures;
  }

  for (const { label, now, old } of ratePairs(measured, baseline)) {
    if (now.utterances !== old.utterances) {
      notice(
        `${label}: baseline comparison skipped because the utterance count differs (${now.utterances} vs ${old.utterances})`
      );
      continue;
    }
    for (const key of regressedMetrics(now, old, error, language, rtf)) {
      failures.push(`${label} ${key}: ${now[key]} regressed from ${old[key]}`);
    }
  }
  return failures;
}

export function baselineRegressions(measured, oldBaseline) {
  if (!oldBaseline) {
    return [];
  }
  return Array.from(ratePairs(measured, oldBaseline)).flatMap(
    ({ label, now, old }) =>
      errorIncreases(now, old, 0).map(
        (key) => `${label} ${key}: ${now[key]} is higher than ${old[key]}`
      )
  );
}

export function saveBaseline(measured, markdown, notes) {
  mkdirSync(new URL('.', BASELINE), { recursive: true });
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ ...measured, ...(notes ? { notes } : {}) }, null, 2)}\n`
  );
  writeFileSync(COMMITTED_REPORT, markdown);
}

export function fleursLanguageAccuracy(sets) {
  const medium = FLEURS.map((id) => sets[id]?.medium?.totals);
  if (medium.some((level) => !level?.utterances)) {
    return null;
  }
  return {
    right: medium.reduce((sum, level) => sum + level.languageRight, 0),
    length: medium.reduce((sum, level) => sum + level.utterances, 0),
  };
}

export function checkFloors(sets, fleursAccuracy) {
  const failures = [];
  if (!Object.values(sets).some(({ medium }) => medium?.utterances > 0)) {
    failures.push('No dataset was measured');
  }
  if (fleursAccuracy && fleursAccuracy.right / fleursAccuracy.length < 0.5) {
    failures.push(
      `FLEURS medium languageRight: ${fleursAccuracy.right}/${fleursAccuracy.length} < 50%`
    );
  }
  for (const [id, { low, medium, high }] of Object.entries(sets)) {
    for (const [level, rates] of Object.entries({ low, medium, high })) {
      for (const [metric, maximum] of [
        ['classErr', 0.6],
        ['per', 1],
      ]) {
        if (rates[metric] === null || rates[metric] >= maximum) {
          failures.push(
            `${id} ${level} ${metric}: ${rates[metric]} must be below ${maximum}`
          );
        }
      }
    }
    for (const key of errorIncreases(low, medium, 0.15)) {
      failures.push(
        `${id} low ${key}: ${low[key]} exceeds medium ${medium[key]} by more than 0.15`
      );
    }
  }
  return failures;
}
