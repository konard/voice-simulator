/**
 * node:test reporter used by scripts/run-heavy.mjs.
 *
 * Writes one JSON line per event that tells which test file passed or
 * failed and how long it took, so that the runner can build one summary row
 * per file. The spec reporter still prints the human readable output; this
 * reporter only feeds the summary.
 */

const KEPT_EVENTS = new Set(['test:pass', 'test:fail', 'test:complete']);

export default async function* heavyReporter(source) {
  for await (const event of source) {
    if (!KEPT_EVENTS.has(event.type)) {
      continue;
    }
    const { data } = event;
    yield `${JSON.stringify({
      type: event.type,
      file: data.file ?? null,
      name: data.name ?? null,
      nesting: data.nesting ?? 0,
      line: data.line ?? null,
      passed: data.details?.passed ?? null,
      durationMs: data.details?.duration_ms ?? null,
    })}\n`;
  }
}
