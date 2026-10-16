import { describe, it, expect } from 'test-anywhere';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { runCli } from '../bin/voice-simulator.js';
import { itUnless, sandboxed } from './helpers/skip.js';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const lockJson = JSON.parse(readFileSync('package-lock.json', 'utf8'));

function windowsSymlinkSkipReason() {
  if (sandboxed || process.platform !== 'win32') {
    return null;
  }
  const fixture = mkdtempSync(join(tmpdir(), 'symlink-permission-'));
  try {
    symlinkSync(resolve('bin/voice-simulator.js'), join(fixture, 'bin'));
    return null;
  } catch (error) {
    if (error.code === 'EPERM') {
      return 'Windows file symlinks require developer mode or administrator privileges';
    }
    throw error;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const symlinkSkipReason = windowsSymlinkSkipReason();

describe('publishable package metadata', () => {
  it('uses the voice-simulator package name', () => {
    expect(packageJson.name).toBe('voice-simulator');
    expect(packageJson.publishConfig).toEqual({ access: 'public' });
    expect(lockJson.name).toBe('voice-simulator');
    expect(lockJson.packages[''].name).toBe('voice-simulator');
  });

  it('defines a globally installable CLI command', () => {
    expect(packageJson.bin).toEqual({
      'voice-simulator': './bin/voice-simulator.js',
    });
    expect(existsSync('bin/voice-simulator.js')).toBe(true);
  });

  it('runs package functions through the CLI command', async () => {
    const stdout = [];
    const stderr = [];

    expect(
      await runCli(['ipa', '--lang', 'ru', 'мама'], {
        stderr: (line) => stderr.push(line),
        stdout: (line) => stdout.push(line),
      })
    ).toBe(0);

    expect(stdout).toEqual(['ˈmamə']);
    expect(stderr).toEqual([]);
  });

  it('reports unknown commands with a non-zero exit code', async () => {
    const stderr = [];
    expect(
      await runCli(['nope'], {
        stderr: (line) => stderr.push(line),
        stdout: () => {},
      })
    ).toBe(1);
    expect(stderr[0]).toBe('Unknown command: nope');
  });

  itUnless(
    sandboxed,
    symlinkSkipReason,
    globalThis.Deno &&
      'Deno resolves relative imports from the bin symlink directory'
  )('runs when invoked through an npm-style bin symlink', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'voice-simulator-'));
    const linkPath = join(tempRoot, 'voice-simulator');

    try {
      symlinkSync(resolve('bin/voice-simulator.js'), linkPath);
      const result = spawnSync(
        process.execPath,
        [
          ...(globalThis.Deno ? ['run', '-A'] : []),
          linkPath,
          'ipa',
          '--lang',
          'en',
          'cat',
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('ˈkæt');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it('publishes only the package runtime surface', () => {
    expect(packageJson.files).toEqual([
      'bin/',
      'src/',
      'CHANGELOG.md',
      'LICENSE',
      'README.md',
    ]);
  });
});
