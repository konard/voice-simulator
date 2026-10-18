// Air volume of each 3D side pouch against its anatomical area x depth,
// and the open conductance of its links into the tract (issue 9).
// Usage: node experiments/issue-9-pouch-volume.mjs [dx]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { CELL_SINUS, LINK_SINUS } from '../src/acoustics/voxel-model.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tractShape } from '../src/articulation/tract-shape.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 0.5);
const head = normalizeHeadConfig({});
const s = tractShape(
  { ...vowelTarget({ phoneme: getPhoneme('ə') }), rhotic: 0 },
  head
);
const solver = new Fdtd3d({ head, dx, kernel: 'js' });
solver.setShape(s.areas, 0, s.velumIndex, s.teeth);
for (const sinus of solver.model.sinuses) {
  let volume = 0;
  let cells = 0;
  for (let i = 0; i < solver.cellCount; i++) {
    if (
      solver.cellKind[i] === CELL_SINUS &&
      solver.model.cells[i].tube === sinus.tube
    ) {
      volume += solver.fill[i] * dx ** 3;
      cells++;
    }
  }
  let links = 0;
  let open = 0;
  const { a, b, kind } = solver.model.links;
  for (let l = 0; l < kind.length; l++) {
    if (kind[l] !== LINK_SINUS) {
      continue;
    }
    const cell =
      solver.model.cells[solver.cellKind[a[l]] === CELL_SINUS ? a[l] : b[l]];
    if (cell.tube !== sinus.tube) {
      continue;
    }
    links++;
    open += Math.min(solver.fill[a[l]], solver.fill[b[l]]) * dx * dx;
  }
  console.log(
    `${sinus.name ?? sinus.tube}: cells ${cells} volume 3D ${volume.toFixed(2)} cm³ ` +
      `target ${(sinus.area * sinus.length).toFixed(2)} | opening links ${links} open ${open.toFixed(2)} cm² (area ${sinus.area.toFixed(2)})`
  );
}
