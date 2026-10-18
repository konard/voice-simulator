#!/usr/bin/env node
/**
 * Print where two same-sized PNG screenshots differ: the number of changed
 * pixels and the bounding box of the changes in each cell of a coarse grid.
 * Used for issue 7 to find which parts of the example-app preview images
 * change between two captures of the same build.
 *
 * Usage:
 *   PREVIEW_CHROMIUM=/path/to/chrome node experiments/issue-7-png-diff-regions.mjs a.png b.png [grid]
 *
 * Set DIFF_OUT=diff.png to also write an image with changed pixels in red.
 */
/* global document, Image */
import { readFile, writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

const [first, second, gridArg] = process.argv.slice(2);
if (!first || !second) {
  console.error(
    'Usage: node experiments/issue-7-png-diff-regions.mjs a.png b.png [grid]'
  );
  process.exit(2);
}
const grid = Number(gridArg ?? 80);

const browser = await chromium.launch({
  executablePath: process.env.PREVIEW_CHROMIUM || undefined,
});
const page = await browser.newPage();
const toDataUrl = async (file) =>
  `data:image/png;base64,${(await readFile(file)).toString('base64')}`;

const result = await page.evaluate(
  async ({ a, b, cell }) => {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    const pixels = (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [imageA, imageB] = await Promise.all([load(a), load(b)]);
    const dataA = pixels(imageA);
    const dataB = pixels(imageB);
    const { width, height } = imageA;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.globalAlpha = 0.25;
    context.drawImage(imageB, 0, 0);
    context.globalAlpha = 1;
    context.fillStyle = 'red';
    let changed = 0;
    const cells = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        if (
          dataA[index] !== dataB[index] ||
          dataA[index + 1] !== dataB[index + 1] ||
          dataA[index + 2] !== dataB[index + 2]
        ) {
          changed++;
          context.fillRect(x, y, 1, 1);
          const key = `${Math.floor(x / cell) * cell},${Math.floor(y / cell) * cell}`;
          cells.set(key, (cells.get(key) ?? 0) + 1);
        }
      }
    }
    return {
      width,
      height,
      changed,
      cells: [...cells.entries()],
      diff: canvas.toDataURL('image/png'),
    };
  },
  { a: await toDataUrl(first), b: await toDataUrl(second), cell: grid }
);
await browser.close();
if (process.env.DIFF_OUT) {
  await writeFile(
    process.env.DIFF_OUT,
    Buffer.from(result.diff.split(',')[1], 'base64')
  );
}

console.log(
  `${result.width}x${result.height}: ${result.changed} changed pixels in ${result.cells.length} ${grid}px cells`
);
for (const [key, count] of result.cells
  .sort((x, y) => y[1] - x[1])
  .slice(0, 25)) {
  console.log(`  cell ${key}: ${count}`);
}
