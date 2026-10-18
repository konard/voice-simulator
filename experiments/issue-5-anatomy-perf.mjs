// Interleaved timing of every audio tier for two checkouts (default: the
// current tree against a copy of the base commit), so machine noise hits
// both alike. Prints the median render seconds per tier.
// Usage: node experiments/issue-5-anatomy-perf.mjs /path/to/base-checkout
// ROUNDS (default 3), DURATION (seconds, default 0.4) and KERNEL apply.
import { pathToFileURL } from 'node:url';

const base = process.argv[2];
const rounds = Number(process.env.ROUNDS ?? 3);
const seconds = Number(process.env.DURATION ?? 0.4);
const trees = {
  current: new globalThis.URL('../src/index.js', import.meta.url).href,
  base: pathToFileURL(`${base}/src/index.js`).href,
};
const libraries = {};
for (const [name, url] of Object.entries(trees)) {
  libraries[name] = await import(url);
}

const times = {};
for (let round = 0; round < rounds; round++) {
  for (const [name, library] of Object.entries(libraries)) {
    const head = library.DEFAULT_HEAD;
    const plan = library.planUtterance('ˈhæloʊ ˈsiːz', { head });
    const short = { ...plan, duration: seconds };
    for (const tier of library.AUDIO_TIERS) {
      const model =
        tier.solver === 'fdtd3d'
          ? library.buildVoxelModel(head, { dx: tier.dx })
          : null;
      const began = globalThis.performance.now();
      library.renderPlan(short, {
        ...tier,
        head,
        model,
        kernel: process.env.KERNEL,
      });
      const key = `${tier.name} ${name}`;
      (times[key] ??= []).push((globalThis.performance.now() - began) / 1000);
    }
  }
}

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const tier of libraries.current.AUDIO_TIERS) {
  const [now, before] = ['current', 'base'].map((name) =>
    median(times[`${tier.name} ${name}`])
  );
  console.log(
    `${tier.name.padEnd(8)} base ${before.toFixed(3)} s  current ${now.toFixed(3)} s  ${(
      (100 * (now - before)) /
      before
    ).toFixed(1)}%`
  );
}
