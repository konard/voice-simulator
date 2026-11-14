/**
 * Issue 13: a folder `docs/case-studies/issue-N` holds the case study of
 * issue N of this repository and nothing else. Case studies inherited from
 * the template repository live in `docs/case-studies/template-issue-N`, and
 * `docs/case-studies/README.md` lists every folder.
 *
 * The test only reads files, so it runs unchanged on Node.js, Bun and Deno.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'test-anywhere';

const root = fileURLToPath(new URL('../docs/case-studies/', import.meta.url));
const OWN = /^issue-(\d+)$/;
const TEMPLATE = /^template-issue-\d+$/;

function folders() {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** `README.md`, or else the first `*.md` file in alphabetical order. */
function mainDocument(folder) {
  const dir = path.join(root, folder);
  if (existsSync(path.join(dir, 'README.md'))) {
    return path.join(dir, 'README.md');
  }
  const markdown = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  return markdown.length > 0 ? path.join(dir, markdown[0]) : null;
}

describe('docs/case-studies folders', () => {
  it('keeps issue-N folders for issues of this repository', () => {
    const own = folders().filter((name) => OWN.test(name));
    expect(own.length > 0).toBe(true);
    const problems = [];
    for (const name of own) {
      const number = OWN.exec(name)[1];
      const file = mainDocument(name);
      if (file === null) {
        problems.push(`${name}: no Markdown document`);
        continue;
      }
      const text = readFileSync(file, 'utf8');
      const ownLink =
        text.includes(`konard/voice-simulator/issues/${number}`) ||
        text.includes('konard/voice-simulator/pull/');
      if (!ownLink) {
        problems.push(`${name}: no link to konard/voice-simulator`);
      }
      const templateIssue = new RegExp(
        `js-ai-driven-development-pipeline-template/issues/${number}(?!\\d)`
      );
      if (templateIssue.test(text)) {
        problems.push(`${name}: describes an issue of the template`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('allows only known folder name patterns', () => {
    const unknown = folders().filter(
      (name) => !OWN.test(name) && !TEMPLATE.test(name)
    );
    expect(unknown).toEqual([]);
  });

  it('lists every folder in the index', () => {
    const index = readFileSync(path.join(root, 'README.md'), 'utf8');
    const missing = folders().filter(
      (name) => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(index)
    );
    expect(missing).toEqual([]);
  });
});
