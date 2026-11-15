/**
 * Issue 40: the voxel tract goes on below the glottis. Compares the cells
 * of the default model with those of a checkout without the extension
 * (path in argv[2], e.g. a git worktree of main): every old cell must be
 * there with the same kind, and the new ones are tract cells below the
 * glottis.
 *   node experiments/issue-40-voxel-extension.mjs /tmp/vs-old [dx]
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const oldRoot = process.argv[2];
const dx = Number(process.argv[3] ?? 1);
const key = (point) => point.map((value) => value.toFixed(4)).join(',');
const now = buildVoxelModel(DEFAULT_HEAD, { dx });
console.log(
  `dx ${dx}: ${now.cells.length} cells, travel ${now.larynxTravel.toFixed(2)} cm`
);
if (oldRoot) {
  const { buildVoxelModel: buildOld } = await import(
    pathToFileURL(join(oldRoot, 'src/acoustics/voxel-model.js'))
  );
  const before = buildOld(DEFAULT_HEAD, { dx });
  const cells = new Map(now.cells.map((cell) => [key(cell.point), cell]));
  let changed = 0;
  let arcs = 0;
  for (const cell of before.cells) {
    const match = cells.get(key(cell.point));
    if (!match || match.kind !== cell.kind || match.tube !== cell.tube) {
      changed++;
    } else if (Math.abs(match.arc - cell.arc) > 1e-9) {
      arcs++;
    }
  }
  const added = now.cells.filter((cell) => cell.arc < -dx / 2).length;
  console.log(
    `old ${before.cells.length} cells: ${changed} changed kind or missing, ${arcs} with another arc; ${added} new cells below the glottis`
  );
  const linkKey = (model, link) =>
    [model.links.a[link], model.links.b[link]]
      .map((cell) => key(model.cells[cell].point))
      .sort()
      .join('|');
  const links = new Map();
  for (let link = 0; link < now.links.a.length; link++) {
    links.set(linkKey(now, link), now.links.kind[link]);
  }
  let lost = 0;
  for (let link = 0; link < before.links.a.length; link++) {
    if (links.get(linkKey(before, link)) !== before.links.kind[link]) {
      lost++;
    }
  }
  const newCells = new Set(
    now.cells.filter((cell) => cell.arc < -dx / 2).map((c) => key(c.point))
  );
  let outside = 0;
  for (let link = 0; link < now.links.a.length; link++) {
    const [a, b] = [now.links.a[link], now.links.b[link]];
    const fresh = [a, b].filter((cell) =>
      newCells.has(key(now.cells[cell].point))
    );
    if (fresh.length > 0 && [a, b].some((cell) => now.cells[cell].kind !== 0)) {
      outside++;
    }
  }
  console.log(
    `links ${before.links.a.length} -> ${now.links.a.length}: ${lost} old links lost or changed, ${outside} new links from the tube below to other kinds`
  );
}
