import { test } from 'node:test';
import { join } from 'node:path';
import {
  assertCopyResults,
  checkAppCopy,
  playwrightChromium,
} from '../../scripts/check-app-copy.mjs';

test(
  'copies a voice from a real Chromium microphone stream',
  { timeout: 300_000 },
  async (t) => {
    if (!(await playwrightChromium())) {
      t.skip('Playwright Chromium is not installed');
      return;
    }
    const screenshot = join(
      process.env.HEAVY_OUT ?? 'reports/heavy',
      'copy-voice.png'
    );
    assertCopyResults(await checkAppCopy({ screenshot }));
  }
);
