/** Aggregate and render the round-trip measurements. Unlicense. */
import { AROUSAL_RISE } from '../../helpers/roundtrip.js';

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

/** Mode spans scored for the mode match share; controls are counted apart. */
const scoredSpan = (span) => span.scoring !== 'absent';

export function summarizeRoundTrips(allItems) {
  // A mode-only item (the calibrated lane of issue 168) heard its voice, so
  // it counts for the mode metrics alone; the round trips stay audio-only.
  const items = allItems.filter((item) => !item.modeOnly);
  const allSpans = allItems.flatMap((item) => item.modeSpans ?? []);
  const modeSpans = allSpans.filter(scoredSpan);
  const controls = allSpans.filter((span) => !scoredSpan(span));
  const stressHits = sum(items, (item) => item.stressHits?.hits ?? 0);
  const stressCount = sum(items, (item) => item.stressHits?.count ?? 0);
  const boundaryCount = sum(items, (item) => item.timeErrors.errors.length);
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
    unexpectedEffort: controls.length
      ? sum(controls, (span) => Number(!span.matched))
      : null,
    controlCount: controls.length,
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
    for (const item of items.filter(({ modeOnly }) => !modeOnly)) {
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

const LANGUAGES = ['en', 'ru', 'hi', 'zh'];
const SCORING = {
  overlap: 'label over half the span',
  relative: `heard arousal rise ≥ ${AROUSAL_RISE} over the neutral span`,
  absent: 'no effort label (negative control)',
};

/** One row per tier, lane, label and scoring with matched/expected spans. */
function modeLanes(groups) {
  const rows = new Map();
  for (const { set, lang, tier, items } of groups) {
    if (set !== 'modes' || lang === 'all') {
      continue;
    }
    for (const span of items.flatMap((item) => item.modeSpans ?? [])) {
      const lane = span.lane ?? 'audio-only';
      const scoring = span.scoring ?? 'overlap';
      const key = JSON.stringify([tier, lane, span.label, scoring]);
      if (!rows.has(key)) {
        rows.set(key, { tier, lane, label: span.label, scoring, spans: [] });
      }
      rows.get(key).spans.push({ ...span, lang });
    }
  }
  const count = (spans) =>
    spans.length
      ? `${spans.filter((span) => span.matched).length}/${spans.length}`
      : '–';
  return [...rows.values()].map(({ tier, lane, label, scoring, spans }) => [
    tier,
    lane,
    label,
    SCORING[scoring] ?? scoring,
    ...LANGUAGES.map((lang) => {
      const own = spans.filter((span) => span.lang === lang);
      const rises = own
        .filter((span) => Number.isFinite(span.rise))
        .map((span) => `${span.rise >= 0 ? '+' : ''}${span.rise.toFixed(2)}`);
      return [
        count(own),
        ...(rises.length ? [`(${rises.join(', ')})`] : []),
      ].join(' ');
    }),
    count(spans),
  ]);
}

const cell = (value) => value.replaceAll('|', '&#124;').replaceAll('\n', ' ');

export function roundTripReport(groups, limit, markupAvailable) {
  const worst = worstSentences(groups);
  const lanes = modeLanes(groups);
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
    `The mode tests run two lanes (issue 168). The audio-only lane hears no voice baseline, so it reports no constant effort (issue 71): its loud case speaks a sentence neutrally and then loudly with the same voice and matches when the heard arousal of the loud span exceeds that of the neutral span by at least ${AROUSAL_RISE}, or when an \`f\` span covers half of it. Its negative control renders the whole sentence loud, and no effort label may overlap it. The calibrated lane hears that loud render with its voice and expects an \`f\` span; it measures the mode only, so the PER, language and RTF columns stay audio-only. Other modes, such as whisper, match a recognition span with the same notation covering at least half of the reference span.`,
    'The mode match share counts the audio-only and calibrated spans of all four languages at each tier; the controls are gated separately and must report no unexpected effort span at any tier. The mode lanes table lists the matched/expected spans with the heard arousal rise in brackets.',
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
    ...(lanes.length
      ? [
          '## Mode lanes',
          table(
            ['Tier', 'Lane', 'Label', 'Scoring', ...LANGUAGES, 'All'],
            lanes
          ),
        ]
      : []),
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
  return {
    markdown: report.join('\n\n'),
    data: { limit, groups, worst, lanes },
  };
}
