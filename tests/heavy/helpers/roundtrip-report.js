/** Aggregate and render the round-trip measurements. Unlicense. */

const sum = (items, value) =>
  items.reduce((total, item) => total + value(item), 0);
const ratio = (value, count) => (count ? value / count : null);

function aggregateEdits(items, key) {
  const metrics = items.flatMap((item) => item[key] ?? []);
  if (!metrics.length) {
    return null;
  }
  const distance = sum(metrics, (item) => item.distance);
  const referenceLength = sum(metrics, (item) => item.referenceLength);
  return {
    distance,
    referenceLength,
    rate: distance / Math.max(1, referenceLength),
  };
}

export function summarizeRoundTrips(items) {
  const stressHits = sum(items, (item) => item.stressHits?.hits ?? 0);
  const stressCount = sum(items, (item) => item.stressHits?.count ?? 0);
  const boundaryCount = sum(items, (item) => item.timeErrors.errors.length);
  const modeSpans = items.flatMap((item) => item.modeSpans ?? []);
  return {
    per: aggregateEdits(items, 'per'),
    wer: aggregateEdits(items, 'wer'),
    cer: aggregateEdits(items, 'cer'),
    soundWer: aggregateEdits(items, 'soundWer'),
    toneErrors: aggregateEdits(items, 'toneErrors'),
    stress: ratio(stressHits, stressCount),
    stressCount,
    stressExpected: sum(items, (item) => item.stressExpected),
    meanTime: ratio(
      sum(items, (item) => item.timeErrors.total),
      boundaryCount
    ),
    boundaryCount,
    language: ratio(
      sum(items, (item) => Number(item.languageRight)),
      items.length
    ),
    sentenceMark: ratio(
      sum(items, (item) => Number(item.markRight)),
      items.length
    ),
    modes: ratio(
      sum(modeSpans, (span) => Number(span.matched)),
      modeSpans.length
    ),
    modeCount: modeSpans.length,
    rtf: ratio(
      sum(items, (item) => item.seconds),
      sum(items, (item) => item.duration)
    ),
  };
}

const percent = (rate) =>
  Number.isFinite(rate) ? `${(100 * rate).toFixed(1)}%` : '–';

function table(columns, rows) {
  return [columns, columns.map(() => '---'), ...rows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

function reportRow({
  lang,
  tier,
  presets,
  items,
  stats,
  failures,
  diagnostic,
}) {
  return [
    lang,
    tier,
    presets.join(', '),
    items.length,
    percent(stats.per?.rate),
    percent(stats.wer?.rate),
    percent(stats.cer?.rate),
    percent(stats.soundWer?.rate),
    percent(stats.toneErrors?.rate),
    percent(stats.stress),
    stats.meanTime?.toFixed(1) ?? '–',
    percent(stats.language),
    percent(stats.sentenceMark),
    percent(stats.modes),
    stats.rtf?.toFixed(3) ?? '–',
    failures.length
      ? failures.map(cell).join('<br>')
      : diagnostic
        ? '–'
        : 'Pass',
  ];
}

function presetRows(row) {
  return row.presets.length === 1
    ? [row]
    : [
        row,
        ...row.presets.map((preset) => {
          const items = row.items.filter((item) => item.preset === preset);
          return {
            ...row,
            presets: [preset],
            items,
            stats: summarizeRoundTrips(items),
            failures: [],
            diagnostic: true,
          };
        }),
      ];
}

function worstSentences(groups) {
  const cases = new Map();
  for (const { lang, items } of groups) {
    if (lang === 'all') {
      continue;
    }
    for (const item of items) {
      const key = JSON.stringify([
        item.lang,
        item.tier,
        item.preset,
        item.sentence,
        item.mode,
      ]);
      if (!cases.has(key)) {
        cases.set(key, item);
      }
    }
  }
  return [...cases.values()]
    .sort((a, b) => b.per.rate - a.per.rate || b.per.distance - a.per.distance)
    .slice(0, 20);
}

const cell = (value) => value.replaceAll('|', '&#124;').replaceAll('\n', ' ');

export function roundTripReport(groups, limit, markupAvailable) {
  const worst = worstSentences(groups);
  const summary = groups.reduce((sets, row) => {
    (sets[row.set] ??= []).push(row);
    return sets;
  }, {});
  const report = [
    '# Synthetic speech round trips',
    `Command: \`npm run test:heavy -- --suite roundtrip${limit < 80 ? ` --limit ${limit}` : ''}\`.`,
    'All renders use seed 1 and select their voice preset with the seeded head generator. Recognition receives audio and the level for its tier. The reference tier is excluded because of its run time.',
    'Edit rates divide summed edits by summed reference length. Stress covers aligned words of equal syllable count. Timing covers start and end boundaries of aligned syllables with identical IPA. A dash indicates an inapplicable metric or no matches. Recognition RTF divides total recognition time by total audio time.',
    'Mandarin uses character error rate in place of orthographic word error, including for the whisper gate. Sound WER compares Mandarin character pronunciations in context.',
    'The mode tests measure the share of reference spans with matching notation and at least half of their duration overlapped by a recognition span. The gate uses all four languages at each tier.',
    'Rows for male and female presets show their separate measurements when the gates use their combined results.',
    ...(!markupAvailable
      ? [
          'Whisper and loud cases were skipped because parseMarkup is unavailable.',
        ]
      : []),
    ...Object.entries(summary).flatMap(([set, rows]) => [
      `## ${set}`,
      table(
        [
          'Language',
          'Tier',
          'Presets',
          'Cases',
          'PER',
          'WER',
          'CER',
          'Sound WER',
          'Tone error',
          'Stress hits',
          'Time (ms)',
          'Language right',
          'Mark right',
          'Mode hits',
          'RTF',
          'Gates',
        ],
        rows.flatMap(presetRows).map(reportRow)
      ),
    ]),
    '## 20 worst round trips by phone error rate',
    table(
      [
        'Set',
        'Language',
        'Tier',
        'Preset',
        'Sentence',
        'Mode',
        'PER',
        'Reference text',
        'Heard text',
        'Reference IPA',
        'Heard IPA',
      ],
      worst.map((item) => [
        item.set,
        item.lang,
        item.tier,
        item.preset,
        item.sentence,
        item.mode ?? '–',
        percent(item.per.rate),
        cell(item.text),
        cell(item.heardText),
        cell(item.referenceIpa),
        cell(item.heardIpa),
      ])
    ),
  ];
  return { markdown: report.join('\n\n'), data: { limit, groups, worst } };
}
