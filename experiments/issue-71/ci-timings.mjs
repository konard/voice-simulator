/** Summarize Bun's per-test timings in a saved CI log. Unlicense. */
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const groups = new Map();
  let group = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = line.match(/##\[group\](tests\/[^:]+):/u);
    if (heading) {
      group = heading[1];
      groups.set(group, { file: group, tests: 0, milliseconds: 0 });
    }
    const elapsed = line.match(/\(pass\).*\[([\d.]+)ms\]/u);
    if (elapsed && group) {
      const row = groups.get(group);
      row.tests++;
      row.milliseconds += Number(elapsed[1]);
    }
  }
  console.log(file);
  console.log(
    JSON.stringify(
      [...groups.values()]
        .sort((a, b) => b.milliseconds - a.milliseconds)
        .slice(0, 12),
      null,
      2
    )
  );
}
