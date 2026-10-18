/**
 * Software rendering of meshes and slice outlines to RGBA images and
 * PNG files, with no browser or GPU: shaded orthographic views ("3D
 * photos") of the head model and of segmented anatomy, and overlays of
 * their cross-sections, for documentation and for image-based tests.
 *
 * A view maps head coordinates to pixels: `right` and `up` are unit
 * vectors of the image plane, `center` is the point drawn in the middle
 * of the image and `scale` is pixels per unit. Points nearer the viewer
 * (along right x up) hide the ones behind them.
 */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Blank image.
 * @param {number} width
 * @param {number} height
 * @param {number[]} [background] RGB.
 */
export function createRaster(width, height, background = [255, 255, 255]) {
  const color = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    color.set([...background, 255], index * 4);
  }
  return {
    width,
    height,
    color,
    depth: new Float32Array(width * height).fill(-Infinity),
  };
}

/**
 * Orthographic projection of a raster.
 * @param {{width: number, height: number}} raster
 * @param {{right: number[], up: number[], center: number[], scale: number}} view
 * @returns {(point: ArrayLike<number>) => number[]} Pixel x, pixel y, depth.
 */
export function projector(raster, view) {
  const { right, up, center, scale } = view;
  const toward = cross(right, up);
  return (point) => {
    const offset = [
      point[0] - center[0],
      point[1] - center[1],
      point[2] - center[2],
    ];
    return [
      raster.width / 2 + dot(offset, right) * scale,
      raster.height / 2 - dot(offset, up) * scale,
      dot(offset, toward),
    ];
  };
}

function blend(raster, pixel, rgb, alpha) {
  const at = pixel * 4;
  for (let channel = 0; channel < 3; channel++) {
    raster.color[at + channel] =
      raster.color[at + channel] * (1 - alpha) + rgb[channel] * alpha;
  }
}

/**
 * Draw a triangle mesh with two-sided Lambert shading and a depth test.
 * @param {ReturnType<typeof createRaster>} raster
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>}} mesh
 * @param {{right: number[], up: number[], center: number[], scale: number}} view
 * @param {number[]} rgb
 * @param {{light?: number[], alpha?: number}} [options] `light` is the
 *   direction towards the light in head coordinates; with `alpha` below 1
 *   the mesh is see-through and does not hide what is drawn later.
 */
export function drawMesh(raster, mesh, view, rgb, options = {}) {
  const project = projector(raster, view);
  const toward = cross(view.right, view.up);
  const light = options.light ?? [
    0.4 * view.right[0] + 0.6 * view.up[0] + toward[0],
    0.4 * view.right[1] + 0.6 * view.up[1] + toward[1],
    0.4 * view.right[2] + 0.6 * view.up[2] + toward[2],
  ];
  const norm = Math.hypot(...light);
  const alpha = options.alpha ?? 1;
  const { positions, indices } = mesh;
  const projected = [];
  for (let index = 0; index < positions.length; index += 3) {
    projected.push(
      project([positions[index], positions[index + 1], positions[index + 2]])
    );
  }
  for (let index = 0; index < indices.length; index += 3) {
    const corners = [indices[index], indices[index + 1], indices[index + 2]];
    const world = corners.map((corner) => [
      positions[corner * 3],
      positions[corner * 3 + 1],
      positions[corner * 3 + 2],
    ]);
    const normal = cross(
      world[1].map((value, axis) => value - world[0][axis]),
      world[2].map((value, axis) => value - world[0][axis])
    );
    const length = Math.hypot(...normal);
    if (length === 0) {
      continue;
    }
    const shade = 0.3 + 0.7 * Math.abs(dot(normal, light) / (length * norm));
    fillTriangle(
      raster,
      corners.map((corner) => projected[corner]),
      rgb.map((value) => value * shade),
      alpha
    );
  }
}

function fillTriangle(raster, [a, b, c], rgb, alpha) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (area === 0) {
    return;
  }
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(raster.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(raster.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
      const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) {
        continue;
      }
      const depth = wa * a[2] + wb * b[2] + wc * c[2];
      const pixel = y * raster.width + x;
      if (depth > raster.depth[pixel]) {
        if (alpha >= 1) {
          raster.depth[pixel] = depth;
        }
        blend(raster, pixel, rgb, alpha);
      }
    }
  }
}

/**
 * Draw a line between two pixel positions, on top of everything.
 * @param {ReturnType<typeof createRaster>} raster
 * @param {number[]} from
 * @param {number[]} to
 * @param {number[]} rgb
 * @param {number} [width] Pixels.
 */
export function drawLine(raster, from, to, rgb, width = 2) {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) * 2)
  );
  const radius = width / 2;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    for (let py = Math.floor(y - radius); py <= Math.ceil(y + radius); py++) {
      for (let px = Math.floor(x - radius); px <= Math.ceil(x + radius); px++) {
        const inside =
          px >= 0 && py >= 0 && px < raster.width && py < raster.height;
        if (inside && Math.hypot(px + 0.5 - x, py + 0.5 - y) <= radius + 0.5) {
          blend(raster, py * raster.width + px, rgb, 1);
        }
      }
    }
  }
}

/**
 * Draw 3D polylines (for instance slice outlines or centrelines) through
 * a view, on top of everything.
 * @param {ReturnType<typeof createRaster>} raster
 * @param {number[][][]} lines
 * @param {{right: number[], up: number[], center: number[], scale: number}} view
 * @param {number[]} rgb
 * @param {number} [width]
 */
export function drawPolylines(raster, lines, view, rgb, width = 2) {
  const project = projector(raster, view);
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      drawLine(
        raster,
        project(line[index - 1]),
        project(line[index]),
        rgb,
        width
      );
    }
  }
}

/** 5x7 glyphs: seven rows of five bits (the highest bit is the left column). */
const GLYPHS = {
  A: '0e11111f111111',
  B: '1e11111e11111e',
  C: '0e11101010110e',
  D: '1e11111111111e',
  E: '1f10101e10101f',
  F: '1f10101e101010',
  G: '0e11101711110f',
  H: '1111111f111111',
  I: '0e04040404040e',
  J: '0702020202120c',
  K: '11121418141211',
  L: '1010101010101f',
  M: '111b1515111111',
  N: '11111915131111',
  O: '0e11111111110e',
  P: '1e11111e101010',
  Q: '0e111111151209',
  R: '1e11111e141211',
  S: '0f10100e01011e',
  T: '1f040404040404',
  U: '1111111111110e',
  V: '11111111110a04',
  W: '1111111515150a',
  X: '11110a040a1111',
  Y: '1111110a040404',
  Z: '1f01020408101f',
  0: '0e11131519110e',
  1: '040c040404040e',
  2: '0e11010204081f',
  3: '1f02040201110e',
  4: '02060a121f0202',
  5: '1f101e0101110e',
  6: '0608101e11110e',
  7: '1f010204080808',
  8: '0e11110e11110e',
  9: '0e11110f01020c',
  '-': '0000001f000000',
  '.': '00000000000c0c',
  ',': '000000000c0408',
  '/': '00010204081000',
  ':': '000c0c000c0c00',
  '(': '02040808080402',
  ')': '08040202020408',
  '%': '18190204081303',
  '=': '00001f001f0000',
  '+': '0004041f040400',
  ' ': '00000000000000',
};

/**
 * Write text with the built-in 5x7 font (letters are drawn in capitals).
 * @param {ReturnType<typeof createRaster>} raster
 * @param {string} text
 * @param {number} x Left edge in pixels.
 * @param {number} y Top edge in pixels.
 * @param {number[]} rgb
 * @param {number} [size] Pixels per font dot.
 */
export function drawText(raster, text, x, y, rgb, size = 2) {
  const plot = (px, py) => {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const cx = px + dx;
        const cy = py + dy;
        if (cx >= 0 && cy >= 0 && cx < raster.width && cy < raster.height) {
          blend(raster, cy * raster.width + cx, rgb, 1);
        }
      }
    }
  };
  let left = x;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character] ?? GLYPHS[' '];
    for (let row = 0; row < 7; row++) {
      const bits = parseInt(glyph.slice(row * 2, row * 2 + 2), 16);
      for (let column = 0; column < 5; column++) {
        if (bits & (16 >> column)) {
          plot(left + column * size, y + row * size);
        }
      }
    }
    left += 6 * size;
  }
}

/**
 * Copy a raster into another one at a pixel offset (for side-by-side
 * panels).
 */
export function pasteRaster(target, source, x, y) {
  for (let row = 0; row < source.height; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= target.height) {
      continue;
    }
    for (let column = 0; column < source.width; column++) {
      const tx = x + column;
      if (tx >= 0 && tx < target.width) {
        const from = (row * source.width + column) * 4;
        target.color.set(
          source.color.subarray(from, from + 4),
          (ty * target.width + tx) * 4
        );
      }
    }
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(
    Array.from(type, (character) => character.charCodeAt(0)),
    4
  );
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

/**
 * PNG file of a raster (8-bit RGB).
 * @param {ReturnType<typeof createRaster>} raster
 * @param {(bytes: Uint8Array) => Uint8Array} deflate A zlib compressor,
 *   for instance zlib.deflateSync in Node.js.
 * @returns {Uint8Array}
 */
export function encodePng(raster, deflate) {
  const { width, height, color } = raster;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      rows.set(color.subarray(from, from + 3), start + 1 + x * 3);
    }
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflate(rows))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}
