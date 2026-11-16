/**
 * Cross-origin isolation of the example app (issue 24): the COOP/COEP
 * headers of the dev server and the optional coi-serviceworker, both only
 * with VITE_CROSS_ORIGIN_ISOLATION=1.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'test-anywhere';

import {
  ISOLATION_WORKER,
  crossOriginIsolation,
  isolationHeaders,
  isolationWorker,
} from '../examples/universal-app/cross-origin-isolation.js';

const appRoot = 'examples/universal-app';

describe('cross-origin isolation of the example app', () => {
  it('is off unless VITE_CROSS_ORIGIN_ISOLATION is 1', () => {
    expect(crossOriginIsolation({})).toBe(false);
    expect(crossOriginIsolation({ VITE_CROSS_ORIGIN_ISOLATION: '0' })).toBe(
      false
    );
    expect(crossOriginIsolation({ VITE_CROSS_ORIGIN_ISOLATION: 'true' })).toBe(
      false
    );
    expect(crossOriginIsolation({ VITE_CROSS_ORIGIN_ISOLATION: '1' })).toBe(
      true
    );
  });

  it('sends the two headers only when on', () => {
    expect(isolationHeaders(false)).toBe(undefined);
    expect(isolationHeaders(true)).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
  });

  it('loads the service worker only when on', () => {
    expect(isolationWorker(false).transformIndexHtml()).toEqual([]);
    expect(isolationWorker(true).transformIndexHtml()).toEqual([
      {
        tag: 'script',
        attrs: { src: 'coi-serviceworker.js' },
        injectTo: 'head-prepend',
      },
    ]);
    // No page names the file itself, so a default build never loads it.
    const html = readFileSync(`${appRoot}/index.html`, 'utf8');
    expect(html.includes(ISOLATION_WORKER)).toBe(false);
    const config = readFileSync(`${appRoot}/vite.config.js`, 'utf8');
    expect(config).toContain('isolationWorker(isolated)');
    expect(config).toContain('headers,');
  });

  it('ships coi-serviceworker as a separate MIT file', () => {
    const worker = readFileSync(
      `${appRoot}/public/${ISOLATION_WORKER}`,
      'utf8'
    );
    expect(worker).toContain('coi-serviceworker v0.1.7');
    expect(worker).toContain('MIT License');
    expect(worker).toContain('Copyright (c) 2021 Guido Zuidhof');
    expect(worker).toContain('Cross-Origin-Embedder-Policy');
  });
});
