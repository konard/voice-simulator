// Issue 15: show what the policy check reads in this repository, so that a
// clean result can be told apart from a parser that reads nothing.
// Usage: node experiments/issue-15-policy-coverage.mjs [root]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  collectDependencies,
  importedNames,
  isScanned,
  trackedFiles,
} from '../scripts/check-policy.mjs';

const root = path.resolve(process.argv[2] ?? REPO_ROOT);
const files = trackedFiles(root);
const count = (items, key) =>
  items.reduce(
    (map, item) => map.set(key(item), (map.get(key(item)) ?? 0) + 1),
    new Map()
  );

const dependencies = collectDependencies(root, files);
console.log(
  'dependency entries by file:',
  Object.fromEntries(count(dependencies, (d) => d.file))
);

const names = files
  .filter(isScanned)
  .flatMap((file) =>
    importedNames(file, readFileSync(path.join(root, file), 'utf8')).map(
      (entry) => ({ file, ...entry })
    )
  );
console.log(
  'imported names by kind:',
  Object.fromEntries(count(names, (n) => `${n.ecosystem} ${n.how}`))
);
for (const how of ['URL', 'install', 'use']) {
  const sample = [
    ...new Set(
      names.filter((n) => n.how === how).map((n) => `${n.ecosystem}:${n.name}`)
    ),
  ];
  console.log(
    `${how} names (${sample.length}):`,
    sample.slice(0, 40).join(' ')
  );
}
