#!/usr/bin/env node
/**
 * Writes docs/accents.md (issue 57): the accent file format, every
 * built-in accent code with its g2p switches, rules, phonotactics, prosody
 * and articulation, and the measured acoustic effects.
 *
 *   node scripts/accents-doc.mjs   write docs/accents.md
 *
 * tests/accents.test.js fails when the committed file differs from what
 * this script writes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ACCENTS } from '../src/g2p/accents.js';
import { MAX_ACCENT_RULES, getAccent } from '../src/accent/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ACCENTS_DOC_FILE = path.join(root, 'docs', 'accents.md');

/** Markdown table cell: no pipes or line breaks. */
function cell(text) {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

const code = (text) => (text === null ? 'none' : `\`${text}\``);

function contextText(rule) {
  const parts = [];
  if (rule.after !== undefined) {
    parts.push(`after ${code(rule.after)}`);
  }
  if (rule.before !== undefined) {
    parts.push(`before ${code(rule.before)}`);
  }
  if (rule.stress !== undefined) {
    parts.push(`${rule.stress} syllables`);
  }
  return parts.join(', ') || 'everywhere';
}

function changeText(rule) {
  if (rule.map !== undefined) {
    return Object.entries(rule.map)
      .map(([from, to]) => `${from} → ${to}`)
      .join(', ');
  }
  const match = Object.entries(rule.match)
    .map(([key, value]) =>
      `${key} ${Array.isArray(value) ? value.join('/') : value}`.trim()
    )
    .join(', ');
  const marks = [
    rule.add !== undefined ? `add ${code(rule.add)}` : null,
    rule.remove !== undefined ? `remove ${code(rule.remove)}` : null,
  ].filter(Boolean);
  return `${match}: ${marks.join(', ')}`;
}

function ruleRows(definition) {
  return definition.rules.map(
    (rule, index) =>
      `| ${index + 1} | ${cell(changeText(rule))} | ${cell(contextText(rule))} | ${rule.min ?? 0} | ${cell(rule.note ?? '')} |`
  );
}

function phonotacticsText(phonotactics) {
  if (!phonotactics) {
    return 'none';
  }
  const codas =
    phonotactics.codas === 'any' ? 'any' : phonotactics.codas.join(' ');
  return [
    `codas ${codas}`,
    `at most ${phonotactics.maxOnset} onset consonants`,
    `epenthesis ${code(phonotactics.epenthesis)}`,
    `prothesis ${phonotactics.prothesis ? code(phonotactics.prothesis) : 'none'}`,
  ].join('; ');
}

function settingsText(values) {
  const entries = Object.entries(values ?? {});
  return entries.length === 0
    ? 'none'
    : entries.map(([key, value]) => `${key} ${value}`).join(', ');
}

function accentSection(entry) {
  const definition = getAccent(entry.code);
  const { prosody } = definition;
  const lines = [
    `### ${code(entry.code)}: ${definition.name}`,
    '',
    `- Language ${code(definition.language)}, base ${code(definition.base)}, g2p switches: ${settingsText(definition.g2p)}.`,
    `- Phonotactics: ${phonotacticsText(definition.phonotactics)}.`,
    `- Prosody: tunes ${code(prosody.tunes)}, range ${prosody.range}, rate ${prosody.rate}, stress lengthening ${prosody.stressLengthening}.`,
    `- Articulation offsets: ${settingsText(definition.articulation)}.`,
    '',
  ];
  if (definition.rules.length === 0) {
    lines.push(
      definition.language === 'en'
        ? 'No rules: the pronunciation comes from the American dictionary and the English accent tables (`src/g2p/accents.js`).'
        : 'No rules: the standard pronunciation.',
      ''
    );
  } else {
    lines.push(
      '| # | Change | Where | From strength | Note |',
      '| --- | --- | --- | --- | --- |',
      ...ruleRows(definition),
      ''
    );
  }
  return lines;
}

const EXAMPLE = readFileSync(
  path.join(root, 'examples', 'accents', 'en-x-th-stopping.json'),
  'utf8'
).replace(/\r\n/gu, '\n');

const HEADER = `# Accents

<!-- Written by scripts/accents-doc.mjs; edit that script, not this file. -->

An accent is a code of a language (\`ru-x-south\`, \`en-x-ru\`) or an accent
file. It changes the IPA that the pronouncer gives (g2p switches, then
rules, then phonotactics), the intonation and timing (tunes, pitch range,
rate, stress lengthening) and the speaker's habits (head offsets). The
default accent of each language (\`en-US\`, \`ru-RU\`, \`hi-IN\`, \`zh-CN\`)
leaves the output unchanged.

\`\`\`js
import { textToIpa, synthesize, loadAccent } from 'voice-simulator';

textToIpa('город', { lang: 'ru', accent: 'ru-x-south' }).ipa; // 'ˈɣorət'
textToIpa('thing', { lang: 'en', accent: { code: 'en-x-ru', strength: 0.5 } }).ipa; // 'ˈsink'
synthesize('pit', { lang: 'en', accent: 'en-x-ru', accentLevel: 0.7 });
synthesize('three', { lang: 'en', accent: loadAccent(json) }); // an accent file
\`\`\`

\`\`\`bash
npx voice-simulator ipa --lang en --accent en-x-ru "thing"         # ˈsʲink
npx voice-simulator ipa --accent examples/accents/en-x-th-stopping.json "the three red rivers"
npx voice-simulator say --lang ru --accent ru-x-south --accent-level 0.5 "город" -o gorod.wav
\`\`\`

- **Strength** (\`accentLevel\`, or \`strength\` of \`{ code, strength }\`) goes
  from 0 to 1 (default 1). A rule applies from its \`min\` strength; an
  offset \`o\` becomes \`o·s\` and a factor \`f\` becomes \`1 + (f − 1)·s\`.
  Strength 0 is the base accent.
- **Where an accent comes from**: the \`accent\` option of \`textToIpa\`,
  \`prepareUtterance\` and \`synthesize\`; the CLI \`--accent <code|file.json>\`
  and \`--accent-level\`; the \`accent\` field of a voice file (an option
  wins); the server field \`accent\` (a code, \`{ code, strength }\` or an
  accent object in a JSON body, never a file path) and \`accentLevel\`.
- **An unknown code** of the language of the text is a \`RangeError\` (a 400
  on the server); an accent of another language is ignored (the text keeps
  its language's default accent).
- **Foreign accents** \`<target>-x-<first>\` exist for every pair of English,
  Russian, Hindi and Mandarin (\`foreignAccent(target, first)\` builds the
  definition from the profile of the first language in
  \`src/accent/profiles/\`).
- \`explainAccent(expectedIpa, heardIpa, lang)\` ranks the accents of a
  language by how many of the differences between two transcriptions their
  rules explain (\`explainAccent('ˈɡorət', 'ˈɣorət', 'ru')[0]\` is
  \`{ code: 'ru-x-south', explained: 1, total: 1 }\`).

## The accent file

\`examples/accents/en-x-th-stopping.json\`:

\`\`\`json
${EXAMPLE}\`\`\`

| Field | Meaning |
| --- | --- |
| \`format\`, \`version\` | \`"voice-simulator/accent"\` and \`1\` |
| \`code\` | A language tag (\`en-x-mine\`) |
| \`name\` | Free text (defaults to the code) |
| \`language\` | \`en\`, \`ru\`, \`hi\` or \`zh\` |
| \`base\` | The built-in accent whose pronunciation the rules start from (defaults to the language's first accent) |
| \`g2p\` | Switches of the pronouncer: \`en\` \`weakForms\`; \`ru\` \`okanye\`, \`fricativeG\`; \`zh\` \`erhua\`, \`lowThird\` |
| \`rules\` | At most ${MAX_ACCENT_RULES} rules, applied in order to every unit of the IPA |
| \`phonotactics\` | \`codas\` (\`"any"\` or the units allowed at the end of a word; others get \`epenthesis\` after them), \`maxOnset\` (longer onsets get \`epenthesis\` inside), \`epenthesis\` (a vowel), \`prothesis\` (a vowel put before an initial s + consonant, or null) |
| \`prosody\` | \`tunes\` (the intonation of a language), \`range\` (pitch range factor), \`rate\` (duration factor: above 1 is slower), \`stressLengthening\` (factor of the stressed lengthening) |
| \`articulation\` | Offsets added to head parameters (\`lipPosture\`, \`jawPosture\`, …) |

A rule has either \`map\` (units to units) or \`match\` (phoneme fields
\`kind\`, \`place\`, \`manner\`, \`voiced\`, \`height\`, \`backness\`, \`rounded\`;
a value or a list) with \`add\` and/or \`remove\` (a diacritic). \`before\` and
\`after\` restrict it to a context: a unit, \`#\` (a word edge), \`V\` (a vowel),
\`C\` (a consonant), \`voiceless\` or \`front\` (a front vowel). \`stress\` is
\`"stressed"\` or \`"unstressed"\`, \`min\` the lowest strength at which it
applies, \`note\` free text. \`loadAccent(json)\` checks a file and throws a
\`TypeError\` that names the wrong field (\`Accent field rules[0].map["θ"] has
symbols the IPA parser does not know: Ж\`).

## Codes

| Code | Language | Name | Base | Rules |
| --- | --- | --- | --- | --- |
`;

const MEASURES = `## Measured effects

Tier \`medium\`, seed 1 (\`node experiments/issue-57-acoustics.mjs\`; the
measures are in \`tests/helpers/accent-measures.js\` and checked by
\`tests/accents.test.js\`):

| Check | Plain | Accent |
| --- | --- | --- |
| \`город\` \`ru-x-south\`: quietest 10 ms of the first consonant below the vowel | 79.5 dB (\`ˈɡorət\`) | 7.7 dB (\`ˈɣorət\`) |
| \`pit\` \`en-x-ru\`: burst to voicing | 60.0 ms (\`ˈpɪt\`) | 12.5 ms (\`ˈp˭it\`) |
| \`bad\` \`en-x-ru\`: voiced share of the last consonant | 0.14 (\`ˈbæd\`) | 0.00 (\`ˈbɛt\`) |
| \`是\` and \`四\` \`zh-TW\`: centroid difference of the initials | 29.1 % (\`ʂɻ̩˥˩\` 5426 Hz, \`sɹ̩˥˩\` 7654 Hz) | 0.0 % (\`sɹ̩˥˩\` both) |
| \`The tiger is the biggest animal of the family.\` \`en-x-zh\`: vowel nPVI | 48.1 | 20.9 |

The retroflex place lies behind the postalveolar one (\`PLACES\` in
\`src/articulation/phones.js\`), which puts the noise of ʂ below that of s:
5946 against 7973 Hz in \`ˈaʂa\` and \`ˈasa\`
(\`node experiments/issue-57-sibilants.mjs\`; 8080 Hz before this issue).
The synthesizer devoices most of a final closure, so even a plain final d has a
voiced share of 0.14.
`;

/** The text of docs/accents.md. */
export function accentsMarkdown() {
  const lines = [HEADER.trimEnd()];
  const entries = Object.values(ACCENTS).flat();
  for (const entry of entries) {
    const definition = getAccent(entry.code);
    lines.push(
      `| [${code(entry.code)}](#${entry.code.toLowerCase()}-${definition.name
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, '')
        .replaceAll(
          ' ',
          '-'
        )}) | ${definition.language} | ${cell(definition.name)} | ${code(definition.base)} | ${definition.rules.length} |`
    );
  }
  lines.push('', '## Accents by code', '');
  for (const entry of entries) {
    lines.push(...accentSection(entry));
  }
  lines.push(MEASURES.trimEnd());
  return `${lines.join('\n')}\n`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  writeFileSync(ACCENTS_DOC_FILE, accentsMarkdown());
  console.log(
    `${path.relative(root, ACCENTS_DOC_FILE)}: ${Object.values(ACCENTS).flat().length} accents`
  );
}
