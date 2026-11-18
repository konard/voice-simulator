/** Blocked acceptance criteria: warn on pull requests, fail elsewhere. */
import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import { checkBlockedGate } from './helpers/blocked-gate.js';

const gate = {
  criterion: 'sd below 5',
  measured: 'got 5.9',
  action: 'the author decides',
};

function jobBlock(name) {
  const lines = readFileSync('.github/workflows/release.yml', 'utf8')
    .replaceAll('\r\n', '\n')
    .split('\n');
  const start = lines.indexOf(`  ${name}:`);
  const end = lines.findIndex(
    (line, i) => i > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

describe('blocked acceptance criteria', () => {
  it('passes a met criterion without output in every environment', () => {
    for (const env of [{}, { BLOCKED_GATES: 'warn' }]) {
      const logged = [];
      expect(
        checkBlockedGate({
          ...gate,
          passed: true,
          env,
          log: (m) => logged.push(m),
        })
      ).toBe('passed');
      expect(logged).toEqual([]);
    }
  });

  it('fails an unmet criterion and names the human action', () => {
    for (const env of [{}, { BLOCKED_GATES: '' }, { BLOCKED_GATES: '1' }]) {
      expect(() => checkBlockedGate({ ...gate, passed: false, env })).toThrow(
        'Blocked acceptance criterion "sd below 5": got 5.9. Human action required: the author decides'
      );
    }
  });

  it('only warns with BLOCKED_GATES=warn', () => {
    const logged = [];
    expect(
      checkBlockedGate({
        ...gate,
        passed: false,
        env: { BLOCKED_GATES: 'warn' },
        log: (m) => logged.push(m),
      })
    ).toBe('warned');
    expect(logged).toEqual([
      '::warning title=Blocked acceptance criterion::Blocked acceptance criterion "sd below 5": got 5.9. Human action required: the author decides',
    ]);
  });

  // Pull requests cannot change an issue's acceptance criteria; pushes to
  // the default branch keep failing until the issue author decides.
  it('defers blocked criteria in the test job on pull requests only', () => {
    expect(jobBlock('test').match(/BLOCKED_GATES: .*/g)).toEqual([
      "BLOCKED_GATES: ${{ github.event_name == 'pull_request' && 'warn' || '' }}",
    ]);
  });
});
