/**
 * Run against the Vite preview of the built app with a Chromium Playwright page.
 * Generate the input with `node bin/voice-simulator.js say "Hello world." -o /tmp/hello.wav`.
 */
import assert from 'node:assert/strict';

export async function verifyRecognition(page, { base, wav, screenshot }) {
  await page.goto(base, { waitUntil: 'networkidle' });
  const panel = page.getByRole('region', { name: 'Recognise speech' });
  await panel.scrollIntoViewIfNeeded();

  await panel.evaluate((root) => {
    const marks = [];
    let tentative = false;
    const observer = new globalThis.MutationObserver(() => {
      const current = root.querySelector('.spoken-text .syllable-current');
      if (current && marks.at(-1) !== current.textContent) {
        marks.push(current.textContent);
      }
      tentative ||= Boolean(root.querySelector('.spoken-text .tentative'));
    });
    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    root.recognitionProbe = () => ({ marks, tentative });
  });

  const context = page.context();
  const requests = [];
  const record = (request) => requests.push(request.url());
  await context.setOffline(true);
  context.on('request', record);
  const status = panel.getByRole('status');
  try {
    await panel.drop({ files: [wav] });
    await status
      .filter({ hasText: 'Recognition complete' })
      .waitFor({ timeout: 90000 });
  } finally {
    context.off('request', record);
    await context.setOffline(false);
  }

  const text = await panel.locator('.spoken-text').innerText();
  const ipa = await panel.locator('.spoken-ipa').first().innerText();
  const { marks, tentative } = await panel.evaluate((root) =>
    root.recognitionProbe()
  );
  assert.equal(text, 'Hello world.');
  assert.equal(ipa, 'həˈloʊ ˈwɝld');
  assert.equal(tentative, true);
  assert.equal(marks.length, 3);
  assert.equal(marks.join('').toLowerCase(), 'helloworld');
  assert.equal(await panel.locator('.syllable-current').count(), 0);
  assert.deepEqual(requests, []);

  if (screenshot) {
    await panel.screenshot({ path: screenshot });
  }

  await panel.getByRole('button', { name: 'Speak back' }).click();
  assert.equal(await page.locator('#speech-text').inputValue(), text);
  assert.equal(await page.locator('#speech-lang').inputValue(), 'en');
  const synthesis = page.locator('.speak-panel .spoken-text');
  await synthesis.filter({ hasText: text }).waitFor();
  return { text, ipa, marks, tentative, requestCount: requests.length };
}
