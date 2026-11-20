/** Compare default articulation plans against the pre-session planner. Unlicense. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import process from 'node:process';
import { planUtterance } from '../../src/articulation/plan.js';

const ref = process.argv[2] ?? 'origin/main';
const copy = new URL(
  `../../src/articulation/.issue-78-plan-${randomUUID()}.mjs`,
  import.meta.url
);
const planner = execFileSync('git', [
  'show',
  `${ref}:src/articulation/plan.js`,
]);
writeFileSync(copy, planner, { flag: 'wx' });
try {
  const before = (await import(copy.href)).planUtterance;
  for (const [ipa, language] of [
    ['ˈpa ˈpi.', 'en'],
    ['ˈmʲjasə.', 'ru'],
    ['ma˥˩ ma˧˥', 'zh'],
    ['ˈkʰanaː', 'hi'],
  ]) {
    const oldBytes = JSON.stringify(before(ipa, { language }));
    const newBytes = JSON.stringify(planUtterance(ipa, { language }));
    if (oldBytes !== newBytes) {
      throw new Error(`Changed plan for ${language}`);
    }
    console.log(language, createHash('sha256').update(newBytes).digest('hex'));
  }
} finally {
  unlinkSync(copy);
}
