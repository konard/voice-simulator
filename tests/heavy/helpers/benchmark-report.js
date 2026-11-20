/** Markdown view of the real-speech benchmark. */
import {
  entryUrls,
  findEntry,
  loadRegistry,
} from '../../../scripts/datasets.mjs';
import { BENCHMARK } from './benchmark.js';

const percent = (rate) => (rate === null ? '—' : `${(100 * rate).toFixed(1)}%`);

function setTable(id, levels) {
  return [
    `### ${id}`,
    '',
    '<!-- prettier-ignore -->',
    '| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(levels).map(([level, { rates, totals }]) => {
      const label = level === 'mediumKnown' ? 'medium (known language)' : level;
      const metrics = [
        'per',
        'classErr',
        'wer',
        'cer',
        'toneErr',
        'languageRight',
      ];
      return `| ${label} | ${rates.utterances} | ${totals.skipped} | ${(totals.audioSeconds / 60).toFixed(2)} | ${metrics.map((metric) => percent(rates[metric])).join(' | ')} | ${rates.rtf?.toFixed(2) ?? '—'} |`;
    }),
    '',
  ];
}

function formatConfusions(confusions) {
  return [
    '## Phone confusions',
    '',
    'The ten most frequent substitutions per language pool the three automatic levels across measured sets. Edit counts also include insertions and deletions.',
    '',
    ...Object.entries(confusions).map(([language, pairs]) => {
      const top = [...pairs]
        .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 10)
        .map(([pair, count]) => `${pair} (${count})`);
      return `- ${language}: ${top.join(', ') || 'no substitutions'}`;
    }),
    '',
  ];
}

function attribution() {
  const registry = loadRegistry();
  const ids = [...BENCHMARK.sets.map(({ id }) => id), 'aishell3-test-index'];
  return ids.map((id) => {
    const entry = findEntry(registry, id);
    const source =
      entry.source.kind === 'rows' ? entryUrls(entry)[2] : entry.licenceUrl;
    return `- \`${id}\` · ${entry.title}. [${entry.licence}](${entry.licenceUrl}). ${entry.citation} [Dataset](${source})`;
  });
}

function formatTargets(sets) {
  return [
    ['classErr', 'Class errors', 0.2],
    ['per', 'PER', 0.5],
  ].map(([metric, label, target]) => {
    const levels = Object.values(sets).flatMap(({ low, medium, high }) => [
      low,
      medium,
      high,
    ]);
    const reached = levels.filter(
      ({ rates }) => Number.isFinite(rates[metric]) && rates[metric] <= target
    ).length;
    const result =
      levels.length &&
      reached === levels.length &&
      Object.keys(sets).length === BENCHMARK.sets.length
        ? 'reached across all automatic runs'
        : `not reached yet across all runs (${reached}/${levels.length} measured runs met it)`;
    return `- ${label} at most ${percent(target)}: ${result}.`;
  });
}

export function formatBenchmarkReport(data, details) {
  const { commit, limit, sets, fleursLanguage, minutes, aishell } = data;
  const { command, confusions, skipped, notices, failures } = details;
  const combined = fleursLanguage
    ? `${fleursLanguage.right}/${fleursLanguage.length} (${percent(fleursLanguage.right / fleursLanguage.length)})`
    : 'unavailable (requires all four FLEURS sets)';
  const limitText =
    limit === Math.max(...BENCHMARK.sets.map(({ rows }) => rows))
      ? `configured prefixes up to ${limit} rows`
      : `up to ${limit} ${limit === 1 ? 'row' : 'rows'} per set`;
  return [
    '# Recognition benchmark on public recordings',
    '',
    `Commit: \`${commit}\``,
    '',
    `Command: \`${command}\``,
    '',
    `Benchmark elapsed time: ${minutes.toFixed(2)} minutes. Sample: ${limitText}.`,
    '',
    `Automatic language identification on all four FLEURS sets at medium: ${combined}.`,
    '',
    ...Object.entries(sets).flatMap(([id, levels]) => setTable(id, levels)),
    ...formatConfusions(confusions),
    '## AISHELL-3 tone reference',
    '',
    aishell
      ? `${aishell.errors}/${aishell.length} aligned tones differ (${percent(aishell.length ? aishell.errors / aishell.length : null)}). Compared ${aishell.lines} lines with ${aishell.labelled} usable pinyin syllables. Full and half third tones both count as tone 3 in this audit.`
      : 'The transcript index was unavailable for this run.',
    '',
    '## Coverage and gates',
    '',
    ...[...skipped, ...notices, ...failures].map((item) => `- ${item}`),
    ...(skipped.length || notices.length || failures.length ? [''] : []),
    ...formatTargets(sets),
    '',
    '## Data',
    '',
    ...attribution(),
    '',
    '## How to read this',
    '',
    'The phone reference is the dictionary pronunciation of the transcript. It may differ from what the speaker actually said. References containing decimal digits are skipped. Error rates divide the total edit count by the total reference length. The Mandarin tone error rate uses only aligned syllable pairs, and Mandarin WER is omitted. Low recognition uses 8 kHz. RTF is elapsed recognition time divided by audio duration, with recordings processed serially.',
    '',
    'The trained Kaldi GMM-HMM monophone recipe published 32.7% PER on the TIMIT core test, and its best listed non-neural system (SGMM2) reported 19.7%. The research notes give 80–90% broad-class accuracy on clean read speech as a first target. The published figures are not comparable to this benchmark because they use a different corpus, trained models and human phone labels. [Kaldi TIMIT results](https://raw.githubusercontent.com/kaldi-asr/kaldi/master/egs/timit/s5/RESULTS) · [Research notes](https://github.com/konard/voice-simulator/blob/main/docs/case-studies/issue-11/research/2-inversion-and-recognition.md#7-evaluation-without-neural-networks).',
    '',
  ].join('\n');
}
