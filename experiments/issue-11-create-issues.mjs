#!/usr/bin/env node
/**
 * Issue 11: turn the plan in docs/case-studies/issue-11/plan/ into GitHub
 * issues with types, labels, milestones and "blocked by" dependencies.
 *
 * Every plan file is Markdown with a small front matter:
 *
 *   ---
 *   id: P30
 *   title: Mandarin third tone loses its dip
 *   type: Bug            (Bug | Feature)
 *   milestone: M3
 *   blocked_by: [P12, P13]
 *   requirements: [R17]
 *   ---
 *
 * In the body `{{P30}}` stands for the number of that planned issue.
 *
 * Usage:
 *   node experiments/issue-11-create-issues.mjs check
 *   node experiments/issue-11-create-issues.mjs render <directory>
 *   node experiments/issue-11-create-issues.mjs create [--repo owner/name]
 *   node experiments/issue-11-create-issues.mjs roadmap
 *   node experiments/issue-11-create-issues.mjs link <file>
 *
 * `link` replaces every `{{P30}}` in a document with a link to the created
 * issue, for documents that refer to the plan.
 *
 * `create` is idempotent: what it created is recorded in
 * docs/case-studies/issue-11/data/created-issues.json and skipped next time.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASE = join(ROOT, 'docs/case-studies/issue-11');
const PLAN = join(CASE, 'plan');
const STATE = join(CASE, 'data/created-issues.json');
const ROADMAP = join(ROOT, 'docs/ROADMAP.md');
const DEFAULT_REPO = 'konard/voice-simulator';
const BLOB = (repo) => `https://github.com/${repo}/blob/main`;

export const MILESTONES = [
  {
    id: 'M0',
    title: 'Roadmap 0: Foundations and measurement',
    description:
      'Clean up, policy checks, manually triggered heavy checks, public datasets, objective metrics and listening tests. Everything later is measured with these.',
  },
  {
    id: 'M1',
    title: 'Roadmap 1: Rust engine and adaptive quality',
    description:
      'Simulation core in Rust (WebAssembly and native), multicore with a single-core fallback, load-time benchmark, lowest-settings tiers and quality that adapts while streaming.',
  },
  {
    id: 'M2',
    title: 'Roadmap 2: Voice physics and configuration',
    description:
      'Physical vocal folds and lungs, noise sources, losses, articulation dynamics, durations and a much larger voice configuration.',
  },
  {
    id: 'M3',
    title: 'Roadmap 3: Languages and modes of speech',
    description:
      'Pronunciation bugs, lexicons, tones, intonation, markup, loudness, whisper, voice qualities, emotions, paralinguistic sounds and accents for speaking.',
  },
  {
    id: 'M4',
    title: 'Roadmap 4: Reverse simulation (listening)',
    description:
      'Audio to IPA to language to text by inverting the simulation: analysis front end, inversion, decoding, language identification, API, app and benchmarks.',
  },
  {
    id: 'M5',
    title: 'Roadmap 5: Voice copy and state-of-the-art validation',
    description:
      'Multi-pass voice copy with continuous recognition, copy synthesis of real recordings, lowest-settings certification and the final evaluation.',
  },
];

const REQUIRED_SECTIONS = [
  '## Goal',
  '## Why',
  '## Current state',
  '## What to do',
  '## Tests',
  '## Acceptance criteria',
  '## Out of scope',
  '## References',
];

const RULES = (repo) => `## Rules for every roadmap issue

- Read [docs/VISION.md](${BLOB(repo)}/docs/VISION.md), [docs/ROADMAP.md](${BLOB(repo)}/docs/ROADMAP.md) and [docs/CONTRIBUTING.md](${BLOB(repo)}/docs/CONTRIBUTING.md) first.
- **No neural networks** in the library, the app, the tests or the tools, and no playback of recorded speech. Allowed: physics, closed-form signal processing, search, optimisation, dynamic programming and small documented tables.
- **Public domain.** New code is Unlicense. New dependencies need a permissive licence (MIT, BSD, Apache-2.0, ISC, Zlib, CC0, Unlicense). Committed data is public domain or CC0; anything else is downloaded at test time and never committed.
- One pull request per issue. Do not start before every issue under "Blocked by" is closed.
- Work in the JavaScript reference implementation in \`src/\` unless the issue says otherwise. If the directory \`crates/\` exists when you start, implement the same numerical code in the Rust core too and extend the parity tests.
- Same input, seed and options must give the same samples on Node.js, Bun and Deno. Take randomness only from \`src/random.js\`.
- Add tests in \`tests/\` that fail before the change and pass after it. Tests that need more than about 10 seconds or a download run only in the manually triggered workflow.
- Keep every source and Markdown file under 1500 lines, run \`npm run check\` and \`npm test\`, and add a changeset (\`npm run changeset\`) when code changes.
- Update \`README.md\`, \`src/index.d.ts\`, the command line help and \`docs/ROADMAP.md\` when behaviour or the public API changes. Put experiment scripts in \`experiments/\` and name them after this issue's number unless the issue gives a file name.
- Report measured numbers with the command that produced them. Do not write a claim that was not measured.`;

function parseList(value) {
  const inner = value.trim().replace(/^\[/u, '').replace(/\]$/u, '').trim();
  return inner ? inner.split(',').map((item) => item.trim()) : [];
}

/** The value of a YAML scalar that may be in single or double quotes. */
export function unquote(value) {
  if (/^'.*'$/u.test(value)) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^".*"$/u.test(value)) {
    return value.slice(1, -1).replaceAll('\\"', '"');
  }
  return value;
}

function parsePlanFile(file) {
  const text = readFileSync(join(PLAN, file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text);
  if (!match) {
    throw new Error(`${file}: no front matter`);
  }
  const meta = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) {
      meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return {
    file,
    id: meta.id,
    title: unquote(meta.title ?? ''),
    type: meta.type,
    milestone: meta.milestone,
    blockedBy: parseList(meta.blocked_by ?? ''),
    requirements: parseList(meta.requirements ?? ''),
    body: match[2].trim(),
  };
}

export function loadPlan() {
  const files = readdirSync(PLAN)
    .filter((name) => /^P\d+-.*\.md$/u.test(name))
    .sort();
  return files.map(parsePlanFile);
}

/** Problems of the front matter of one plan file. */
function validateHeader(item) {
  const errors = [];
  if (!/^P\d{2}$/u.test(item.id ?? '')) {
    errors.push(`bad id ${item.id}`);
  }
  if (!item.file.startsWith(`${item.id}-`)) {
    errors.push(`file name does not start with ${item.id}-`);
  }
  if (!item.title || item.title.length > 110) {
    errors.push('title missing or longer than 110 characters');
  }
  if (!['Bug', 'Feature'].includes(item.type)) {
    errors.push('type must be Bug or Feature');
  }
  if (!MILESTONES.some((milestone) => milestone.id === item.milestone)) {
    errors.push(`unknown milestone ${item.milestone}`);
  }
  if (item.requirements.length === 0) {
    errors.push('no requirements');
  }
  return errors;
}

/** Problems of the text of one plan file. */
function validateBody(item) {
  const errors = [];
  for (const section of REQUIRED_SECTIONS) {
    if (
      !item.body.includes(`\n${section}\n`) &&
      !item.body.startsWith(section)
    ) {
      errors.push(`missing section "${section}"`);
    }
  }
  if (!/- \[ \] /u.test(item.body)) {
    errors.push('no acceptance checklist');
  }
  if (item.body.length > 60000) {
    errors.push('body longer than 60000 characters (GitHub allows 65536)');
  }
  for (const name of bareMentions(item.body)) {
    errors.push(`"@${name}" outside code would notify a GitHub account`);
  }
  for (const number of bareIssueNumbers(item.body)) {
    errors.push(`"#${number}" outside code would link to another issue`);
  }
  return errors;
}

/** The text without fenced code blocks and inline code. */
function proseOf(text) {
  return text.replace(/^ *```[\s\S]*?^ *```/gmu, '').replace(/`[^`\n]*`/gu, '');
}

/** Numbers that GitHub would turn into a link to an issue: `#12` in prose. */
export function bareIssueNumbers(text) {
  const found = proseOf(text).matchAll(/(?<![&\w/#])#(\d+)\b/gu);
  return [...new Set([...found].map((match) => match[1]))];
}

/** Names that GitHub would read as a mention: `@name` outside code. */
export function bareMentions(text) {
  const prose = proseOf(text);
  const found = prose.matchAll(/(?<![\w/.`-])@([A-Za-z\d][A-Za-z\d-]*)/gu);
  return [...new Set([...found].map((match) => match[1]))];
}

/** Problems that would make the created issues wrong. */
export function validate(plan) {
  const errors = [];
  const ids = new Map();
  for (const item of plan) {
    const found = [...validateHeader(item), ...validateBody(item)];
    if (ids.has(item.id)) {
      found.push(`duplicate id ${item.id}`);
    }
    ids.set(item.id, item);
    errors.push(...found.map((message) => `${item.file}: ${message}`));
  }
  for (const item of plan) {
    for (const blocker of item.blockedBy) {
      if (!ids.has(blocker)) {
        errors.push(`${item.file}: blocked by unknown ${blocker}`);
      }
    }
    for (const [, token] of item.body.matchAll(/\{\{(P\d+)\}\}/gu)) {
      if (!ids.has(token)) {
        errors.push(`${item.file}: reference to unknown {{${token}}}`);
      }
    }
  }
  if (errors.length === 0) {
    try {
      topologicalOrder(plan);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

/** Blockers first; ties keep the order of the ids. */
export function topologicalOrder(plan) {
  const byId = new Map(plan.map((item) => [item.id, item]));
  const done = new Set();
  const active = new Set();
  const order = [];
  const visit = (item) => {
    if (done.has(item.id)) {
      return;
    }
    if (active.has(item.id)) {
      throw new Error(`Dependency cycle through ${item.id}`);
    }
    active.add(item.id);
    for (const blocker of [...item.blockedBy].sort()) {
      visit(byId.get(blocker));
    }
    active.delete(item.id);
    done.add(item.id);
    order.push(item);
  };
  for (const item of plan) {
    visit(item);
  }
  return order;
}

function blocksOf(plan) {
  const blocks = new Map(plan.map((item) => [item.id, []]));
  for (const item of plan) {
    for (const blocker of item.blockedBy) {
      blocks.get(blocker).push(item.id);
    }
  }
  return blocks;
}

/** Issue body in which every plan id is a GitHub issue number. */
export function renderBody(item, plan, numbers, repo = DEFAULT_REPO) {
  const byId = new Map(plan.map((entry) => [entry.id, entry]));
  const reference = (id) =>
    numbers[id] ? `#${numbers[id]}` : `"${byId.get(id).title}"`;
  const list = (ids) =>
    ids.length
      ? ids.map((id) => `- ${reference(id)} ${byId.get(id).title}`).join('\n')
      : '- Nothing.';
  const milestone = MILESTONES.find((entry) => entry.id === item.milestone);
  const body = item.body.replace(/\{\{(P\d+)\}\}/gu, (_, id) => reference(id));
  return [
    `> Part of the roadmap planned in #11 (${milestone.title}). Type: **${item.type}**. Requirements of #11 covered: ${item.requirements.join(', ')} (see the [case study](${BLOB(repo)}/docs/case-studies/issue-11/README.md)).`,
    '',
    body,
    '',
    '## Dependencies',
    '',
    '**Blocked by** (must be closed before work starts):',
    '',
    list(item.blockedBy),
    '',
    '**Blocks:**',
    '',
    list(blocksOf(plan).get(item.id)),
    '',
    RULES(repo),
    '',
  ].join('\n');
}

function gh(args, input) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function api(method, path, payload) {
  const args = ['api', '--method', method, path];
  if (payload) {
    args.push('--input', '-');
  }
  const output = gh(args, payload ? JSON.stringify(payload) : undefined);
  return output.trim() ? JSON.parse(output) : null;
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function readState() {
  return existsSync(STATE)
    ? JSON.parse(readFileSync(STATE, 'utf8'))
    : { repo: DEFAULT_REPO, milestones: {}, issues: {}, dependencies: [] };
}

function writeState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}

function ensureMilestones(repo, state) {
  const existing = api(
    'GET',
    `repos/${repo}/milestones?state=all&per_page=100`
  );
  for (const milestone of MILESTONES) {
    if (state.milestones[milestone.id]) {
      continue;
    }
    const found =
      existing.find((entry) => entry.title === milestone.title) ??
      api('POST', `repos/${repo}/milestones`, {
        title: milestone.title,
        description: milestone.description,
      });
    state.milestones[milestone.id] = {
      number: found.number,
      url: found.html_url,
    };
    writeState(state);
  }
}

function nextIssueNumber(repo) {
  const [latest] = api(
    'GET',
    `repos/${repo}/issues?state=all&per_page=1&sort=created&direction=desc`
  );
  return (latest?.number ?? 0) + 1;
}

/**
 * Plan files are wrapped at 80 columns for reading in an editor. GitHub
 * shows every line end of an issue body as a line break, so the paragraphs
 * are joined into one line each before a body is sent. Only white space
 * and the width of table rules change; that is checked.
 */
export async function unwrapBodies(plan) {
  // Table rules shrink to three dashes; nothing else may differ.
  const bare = (text) => text.replace(/\s+/gu, '').replace(/-{3,}/gu, '---');
  for (const item of plan) {
    const joined = await format(item.body, {
      parser: 'markdown',
      proseWrap: 'never',
      embeddedLanguageFormatting: 'off',
    });
    if (bare(joined) !== bare(item.body)) {
      throw new Error(`${item.id}: joining the lines changed the text`);
    }
    item.body = joined.trim();
  }
  return plan;
}

async function create(repo) {
  const plan = await unwrapBodies(loadPlan());
  const errors = validate(plan);
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  const state = readState();
  state.repo = repo;
  ensureMilestones(repo, state);
  const order = topologicalOrder(plan);
  // Predict the numbers so that the first version of every body is final.
  const numbers = {};
  let next = nextIssueNumber(repo);
  for (const item of order) {
    numbers[item.id] = state.issues[item.id]?.number ?? next++;
  }
  const stale = new Set();
  for (const item of order) {
    if (state.issues[item.id]) {
      continue;
    }
    const created = api('POST', `repos/${repo}/issues`, {
      title: item.title,
      body: renderBody(item, plan, numbers, repo),
      labels: [item.type === 'Bug' ? 'bug' : 'enhancement'],
      milestone: state.milestones[item.milestone].number,
      type: item.type,
    });
    if (created.number !== numbers[item.id]) {
      numbers[item.id] = created.number;
      for (const other of plan) {
        stale.add(other.id);
      }
    }
    state.issues[item.id] = {
      number: created.number,
      id: created.id,
      url: created.html_url,
      title: item.title,
      type: item.type,
      milestone: item.milestone,
    };
    writeState(state);
    console.log(`${item.id} -> #${created.number} ${item.title}`);
    await sleep(2500);
  }
  for (const id of stale) {
    const actual = Object.fromEntries(
      Object.entries(state.issues).map(([key, value]) => [key, value.number])
    );
    const item = plan.find((entry) => entry.id === id);
    api('PATCH', `repos/${repo}/issues/${state.issues[id].number}`, {
      body: renderBody(item, plan, actual, repo),
    });
    console.log(`updated body of #${state.issues[id].number}`);
    await sleep(1000);
  }
  for (const item of order) {
    for (const blocker of item.blockedBy) {
      const key = `${item.id}<-${blocker}`;
      if (state.dependencies.includes(key)) {
        continue;
      }
      api(
        'POST',
        `repos/${repo}/issues/${state.issues[item.id].number}/dependencies/blocked_by`,
        { issue_id: state.issues[blocker].id }
      );
      state.dependencies.push(key);
      writeState(state);
      await sleep(1500);
    }
  }
  console.log(
    `${Object.keys(state.issues).length} issues, ${state.dependencies.length} dependencies`
  );
}

function numbersFromState() {
  const state = readState();
  return Object.fromEntries(
    Object.entries(state.issues).map(([key, value]) => [key, value.number])
  );
}

async function render(directory) {
  const plan = await unwrapBodies(loadPlan());
  const numbers = numbersFromState();
  mkdirSync(directory, { recursive: true });
  for (const item of plan) {
    writeFileSync(
      join(directory, item.file),
      `# ${item.title}\n\n${renderBody(item, plan, numbers)}`
    );
  }
  console.log(`${plan.length} bodies written to ${directory}`);
}

function roadmapSection(plan, numbers, repo) {
  const link = (id) =>
    numbers[id]
      ? `[#${numbers[id]}](https://github.com/${repo}/issues/${numbers[id]})`
      : id;
  const lines = [];
  for (const milestone of MILESTONES) {
    const items = plan.filter((item) => item.milestone === milestone.id);
    lines.push(`### ${milestone.title}`, '', milestone.description, '');
    lines.push('| Issue | Type | Title | Blocked by | Requirements |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const item of items) {
      const blockers = item.blockedBy.map(link).join(', ') || 'nothing';
      const title = item.title.replaceAll('|', '\\|');
      lines.push(
        `| ${link(item.id)} | ${item.type} | ${title} | ${blockers} | ${item.requirements.join(', ')} |`
      );
    }
    lines.push('');
  }
  lines.push('### Dependency graph', '');
  lines.push(
    'An arrow points from an issue to the issues it blocks. Bugs have rounded boxes.',
    ''
  );
  lines.push('```mermaid', 'flowchart LR');
  for (const milestone of MILESTONES) {
    lines.push(`  subgraph ${milestone.id}["${milestone.title}"]`);
    for (const item of plan.filter(
      (entry) => entry.milestone === milestone.id
    )) {
      const label = numbers[item.id] ? `#${numbers[item.id]}` : item.id;
      lines.push(
        item.type === 'Bug'
          ? `    ${item.id}(["${label}"])`
          : `    ${item.id}["${label}"]`
      );
    }
    lines.push('  end');
  }
  for (const item of plan) {
    for (const blocker of item.blockedBy) {
      lines.push(`  ${blocker} --> ${item.id}`);
    }
  }
  lines.push('```', '');
  return lines.join('\n');
}

function roadmap() {
  const plan = loadPlan();
  const state = readState();
  const section = roadmapSection(plan, numbersFromState(), state.repo);
  const text = readFileSync(ROADMAP, 'utf8');
  const begin = '<!-- roadmap:begin -->';
  const end = '<!-- roadmap:end -->';
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < from) {
    throw new Error(`${ROADMAP}: markers not found`);
  }
  writeFileSync(
    ROADMAP,
    `${text.slice(0, from + begin.length)}\n\n${section}\n${text.slice(to)}`
  );
  console.log(`${ROADMAP} updated with ${plan.length} issues`);
}

function link(file) {
  const state = readState();
  const text = readFileSync(file, 'utf8');
  const missing = new Set();
  const linked = text.replace(/\{\{(P\d+)\}\}/gu, (token, id) => {
    const issue = state.issues[id];
    if (!issue) {
      missing.add(id);
      return token;
    }
    return `[#${issue.number}](${issue.url})`;
  });
  if (missing.size) {
    throw new Error(`${file}: no created issue for ${[...missing].join(', ')}`);
  }
  writeFileSync(file, linked);
  console.log(`${file} linked`);
}

function check() {
  const plan = loadPlan();
  const errors = validate(plan);
  for (const error of errors) {
    console.error(error);
  }
  if (errors.length) {
    process.exitCode = 1;
    return;
  }
  const count = (type) => plan.filter((item) => item.type === type).length;
  const edges = plan.reduce((sum, item) => sum + item.blockedBy.length, 0);
  console.log(
    `${plan.length} issues (${count('Bug')} bugs, ${count('Feature')} features), ${edges} dependencies, no cycles`
  );
  console.log(
    topologicalOrder(plan)
      .map((item) => item.id)
      .join(' ')
  );
}

const [command, ...rest] = process.argv.slice(2);
const repoFlag = rest.indexOf('--repo');
const repo = repoFlag >= 0 ? rest[repoFlag + 1] : DEFAULT_REPO;
if (command === 'check') {
  check();
} else if (command === 'render') {
  await render(rest[0] ?? join(CASE, 'data/rendered-issues'));
} else if (command === 'create') {
  await create(repo);
} else if (command === 'roadmap') {
  roadmap();
} else if (command === 'link' && rest[0]) {
  link(rest[0]);
} else {
  console.error(
    'Usage: issue-11-create-issues.mjs check|render|create|roadmap|link'
  );
  process.exitCode = 1;
}
