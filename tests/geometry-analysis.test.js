/**
 * Mesh analysis for comparing the head model with segmented anatomy: STL
 * reading and writing, planar slices, open boundaries, voxelisation,
 * medial paths and area functions, checked on simple solids, on the
 * model's own tract tube and on CC0 vocal tracts of the Dresden Vocal
 * Tract Dataset (tests/fixtures/dvtd).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, it, expect } from 'test-anywhere';
import { tubeFormants, SPEED_OF_SOUND } from '../src/acoustics/transfer.js';
import { tractCenterline } from '../src/geometry/centerline.js';
import {
  DVTD_SPEED_OF_SOUND,
  tractAreaFunction,
  vvtfPeaks,
} from '../src/geometry/dvtd.js';
import { tubeMesh } from '../src/geometry/mesh.js';
import {
  axisPlane,
  boundaryLoops,
  chainSegments,
  loopShape,
  meshBounds,
  sliceMesh,
} from '../src/geometry/slice.js';
import { meshesToStl, parseStl } from '../src/geometry/stl.js';
import { crossSection } from '../src/geometry/tract-analysis.js';
import {
  capLoops,
  voxelizeMesh,
  wallDistance,
} from '../src/geometry/voxelize.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import {
  DVTD_ARCHIVE,
  fetchMember,
  listMembers,
  matchesPattern,
} from '../scripts/fetch-dvtd.mjs';
import { networkSkipReason } from './helpers/network.js';
import { itUnless } from './helpers/skip.js';

// Before any test is registered: the CPU-bound tests start right away and
// would stall the probe past its timeout.
const offline = await networkSkipReason({ url: DVTD_ARCHIVE });

const FIXTURES = new globalThis.URL('./fixtures/dvtd/', import.meta.url);
const MANIFEST = JSON.parse(
  readFileSync(new globalThis.URL('manifest.json', FIXTURES))
);

/** Axis-aligned box from `min` to `max` as 12 outward-facing triangles. */
function box(min, max) {
  const corner = (index) =>
    [0, 1, 2].map((axis) => ((index >> axis) & 1 ? max[axis] : min[axis]));
  const positions = Float64Array.from(
    Array.from({ length: 8 }, (_, index) => corner(index)).flat()
  );
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const indices = Uint32Array.from(
    faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])
  );
  return { positions, indices };
}

describe('STL', () => {
  it('round-trips a mesh through binary STL with merged vertices', () => {
    const mesh = box([0, 0, 0], [1, 2, 3]);
    const parsed = parseStl(meshesToStl([mesh], { scale: 10 }));
    expect(parsed.indices.length).toBe(36);
    expect(parsed.positions.length).toBe(24);
    expect(meshBounds(parsed).max).toEqual([10, 20, 30]);
  });

  it('reads ASCII STL', () => {
    const text = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t`;
    const parsed = parseStl(new globalThis.TextEncoder().encode(text));
    expect(Array.from(parsed.indices)).toEqual([0, 1, 2]);
    expect(Array.from(parsed.positions.slice(3, 6))).toEqual([1, 0, 0]);
  });
});

describe('slices and boundaries', () => {
  it('cuts a closed loop around a box with the box cross-section', () => {
    const mesh = box([0, 0, 0], [2, 3, 4]);
    const lines = chainSegments(sliceMesh(mesh, axisPlane(2, 1.5)));
    expect(lines.length).toBe(1);
    const section = crossSection(mesh, [1, 1.5, 1.5], [0, 0, 1]);
    expect(Math.abs(section.area - 6)).toBeLessThan(1e-9);
    expect(boundaryLoops(mesh).length).toBe(0);
  });

  it('finds the two open ends of the model tract tube', () => {
    const head = normalizeHeadConfig(DEFAULT_HEAD);
    const path = tractCenterline(head, { sections: 40 });
    const mesh = tubeMesh(path, new Array(40).fill(3), { head });
    const loops = boundaryLoops(mesh);
    expect(loops.length).toBe(2);
    const areas = loops.map((loop) => loopShape(mesh, loop).area);
    expect(Math.min(...areas)).toBeGreaterThan(1);
  });
});

describe('voxelisation', () => {
  it('fills a closed box with its volume and measures the wall distance', () => {
    const grid = voxelizeMesh(box([0, 0, 0], [10, 6, 4]), { dx: 0.5 });
    const cells = grid.inside.reduce((sum, value) => sum + value, 0);
    expect(cells * 0.5 ** 3).toBe(240);
    // The deepest cells lie 2 cm (4 cells) inside the 4 cm high box.
    expect(Math.max(...wallDistance(grid))).toBe(4);
  });

  it('caps the open ends so a tube becomes a closed solid', () => {
    const head = normalizeHeadConfig(DEFAULT_HEAD);
    const path = tractCenterline(head, { sections: 40 });
    const mesh = capLoops(tubeMesh(path, new Array(40).fill(3), { head }));
    expect(boundaryLoops(mesh).length).toBe(0);
  });
});

describe('area function', () => {
  it('recovers the length and areas of the model tract tube', () => {
    const head = normalizeHeadConfig(DEFAULT_HEAD);
    const path = tractCenterline(head, { sections: 80 });
    const areas = Array.from(
      { length: 80 },
      (_, i) => 1 + 3 * Math.sin((Math.PI * i) / 79)
    );
    const mesh = tubeMesh(path, areas, { head, lod: 2 });
    const result = tractAreaFunction(mesh, {
      dx: 0.1,
      step: 0.25,
      window: 5,
      up: [0, 1, 0],
    });
    expect(Math.abs(result.length - head.vocalTractLength)).toBeLessThan(0.6);
    const middle = result.areas[Math.floor(result.areas.length / 2)];
    expect(Math.abs(middle - 4) / 4).toBeLessThan(0.1);
  });

  it('reads the resonances of a transfer function table', () => {
    const rows = Array.from({ length: 5000 }, (_, f) => {
      const peak = (centre) => 1 / (1 + ((f - centre) / 40) ** 2);
      return `${f} ${peak(500) + peak(1500)} 0`;
    });
    expect(
      vvtfPeaks(`# freq_Hz magnitude phase_rad\n${rows.join('\n')}`)
    ).toEqual([500, 1500]);
  });
});

describe('Dresden Vocal Tract Dataset fixtures', () => {
  for (const entry of MANIFEST.files) {
    it(`${entry.file} matches the archive and resonates like its FEM model`, () => {
      const bytes = gunzipSync(
        readFileSync(new globalThis.URL(entry.file, FIXTURES))
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        entry.sha256
      );
      const result = tractAreaFunction(parseStl(bytes));
      // Adult tracts are 13 to 20 cm from the glottis to the lips.
      expect(result.length).toBeGreaterThan(130);
      expect(result.length).toBeLessThan(200);
      const length =
        (result.length / 10) * (SPEED_OF_SOUND / DVTD_SPEED_OF_SOUND);
      const tube = tubeFormants(
        result.areas.map((area) => area / 100),
        length,
        { count: 3, maxFrequency: 5000, step: 2 }
      );
      entry.femResonances.forEach((fem, index) => {
        expect(Math.abs(tube[index] - fem) / fem).toBeLessThan(0.12);
      });
    });
  }
});

describe('Dresden Vocal Tract Dataset download', () => {
  it('selects archive members by wildcard patterns, not expressions', () => {
    const name = 'dvtd/s2/s2-01-ehe-schwa-inner-surface.stl';
    expect(matchesPattern('*s2-01-*inner-surface.stl', name)).toBe(true);
    expect(matchesPattern(name, name)).toBe(true);
    expect(matchesPattern('*', name)).toBe(true);
    expect(matchesPattern('*s2-01-*', name)).toBe(true);
    expect(matchesPattern('s2-01-*', name)).toBe(false);
    expect(matchesPattern('*s1-01-*', name)).toBe(false);
    expect(matchesPattern('*surface.stl*surface.stl', name)).toBe(false);
    // Expression syntax is plain text.
    expect(matchesPattern('.*', name)).toBe(false);
    expect(matchesPattern('*s2-0[1]-*', name)).toBe(false);
  });

  itUnless(offline)(
    'fetches a /u/ tract and its FEM transfer function just in time',
    async () => {
      const members = await listMembers();
      const fetchNamed = (suffix) =>
        fetchMember(members.find((member) => member.name.endsWith(suffix)));
      const surface = await fetchNamed('s2-05-bude-tense-u-inner-surface.stl');
      const transfer = await fetchNamed(
        's2-05-bude-tense-u-vvtf-calculated.txt'
      );
      const result = tractAreaFunction(parseStl(surface));
      const tube = tubeFormants(
        result.areas.map((area) => area / 100),
        (result.length / 10) * (SPEED_OF_SOUND / DVTD_SPEED_OF_SOUND),
        { count: 2, maxFrequency: 5000, step: 2 }
      );
      vvtfPeaks(transfer.toString('utf8'))
        .slice(0, 2)
        .forEach((fem, index) => {
          expect(Math.abs(tube[index] - fem) / fem).toBeLessThan(0.12);
        });
    }
  );
});
