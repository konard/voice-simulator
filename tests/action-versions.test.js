import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';

function yamlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return yamlFiles(path);
    }
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

describe('action versions', () => {
  it('use one ref per action across every workflow and composite action', () => {
    // A bump that misses some files leaves jobs on different majors.
    const refs = new Map();
    for (const file of yamlFiles('.github')) {
      const text = readFileSync(file, 'utf8');
      for (const [, action, ref] of text.matchAll(
        /uses: ([\w.-]+\/[\w./-]+)@([\w.-]+)/g
      )) {
        refs.set(action, new Set([...(refs.get(action) ?? []), ref]));
      }
    }

    expect(refs.get('actions/checkout')).toEqual(new Set(['v7']));
    for (const [action, versions] of refs) {
      expect(`${action} ${[...versions].join(', ')}`).toBe(
        `${action} ${[...versions][0]}`
      );
    }
  });
});
