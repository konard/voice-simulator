#!/usr/bin/env node
/**
 * Issue 7: add rounding noise (+/- `delta` colour levels on `count` pixels)
 * to a PNG, to check that scripts/update-preview-images.mjs treats such an
 * image as unchanged.
 *
 * Usage:
 *   PREVIEW_CHROMIUM=/path/to/chrome node experiments/issue-7-perturb-png.mjs in.png out.png [count] [delta]
 */
/* global document, Image */
import { readFile, writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const [input, output, countArg, deltaArg] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.PREVIEW_CHROMIUM || undefined,
});
const page = await browser.newPage();
const dataUrl = await page.evaluate(
  async ({ url, count, delta }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    for (let pixel = 0; pixel < count; pixel++) {
      const index = (pixel * 7919 * 4) % pixels.data.length;
      const value = pixels.data[index];
      pixels.data[index] = value + delta > 255 ? value - delta : value + delta;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  },
  {
    url: `data:image/png;base64,${(await readFile(input)).toString('base64')}`,
    count: Number(countArg ?? 50),
    delta: Number(deltaArg ?? 1),
  }
);
await browser.close();
await writeFile(output, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`wrote ${output}`);
