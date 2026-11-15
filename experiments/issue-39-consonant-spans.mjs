/**
 * Issue 39: the planned span of the consonant of [ˈasa], [ˈaza] and
 * [ˈama], which the turbulence and nasal-murmur tests measure inside.
 * Usage: node experiments/issue-39-consonant-spans.mjs [path to src]
 */
const root = process.argv[2] ?? '../src';
const { planUtterance } = await import(`${root}/articulation/plan.js`);
const { normalizeHeadConfig } = await import(`${root}/head-config.js`);
for (const ipa of ['ˈasa', 'ˈaza', 'ˈama', 'ˈafa']) {
  const plan = planUtterance(ipa, { head: normalizeHeadConfig({}) });
  const parts = plan.segments.map(
    (segment) =>
      `${segment.kind}:${segment.token?.base ?? ''}:${(segment.duration * 1000).toFixed(0)}`
  );
  console.log(ipa.padEnd(6), parts.join(' '));
}
