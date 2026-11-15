/**
 * Geometry of the 2D acoustic sheet (issue 37): the vocal tract unrolled
 * into the plane x (glottis -> lips) times y (left -> right wall), with a
 * depth h per cell, for the 2D FDTD solver (fdtd2d.js).
 *
 * The tract keeps its area function: every column of cells holds exactly
 * the cross-section of the tract at its position (sum(h) * dx = area). The
 * width shows what the 1D waveguide cannot: transverse modes across a wide
 * cavity, and air passing beside the tongue for laterals ([l]).
 *
 * A column of area A is w(x) = min(W(x), sqrt(4 A / (pi * 0.4))) wide: an
 * ellipse with a depth/width ratio of 0.4, up to the anatomical width W(x)
 * of the region (3.2 cm times the head's pharynxWidth in the pharynx,
 * 4.5 cm times oralWidth in the mouth, 4 cm times mouthWidth at the lips,
 * blended linearly over 2 cm). Across that width the depth follows the
 * ellipse h(y) = h0 sqrt(1 - (2y / w)²) with h0 = 4 A / (pi w); each cell
 * takes the mean of the ellipse over its own width, and the column is then
 * scaled so its area is exact. Cells shallower than WALL_DEPTH are walls,
 * except that a column always keeps its deepest cell: a closure narrows
 * the column to one cell of the (tiny) closure area, as the 1D waveguide
 * keeps its minimum area.
 *
 * The grid has the head's rest tract length (the solver stretches its time
 * step with the dynamic length, as the waveguide and the 3D solver do) and
 * ceil(max W / dx) + 2 rows, so it never changes size; only h changes.
 *
 * Laterals: with the shape's `lateral` channel at 1 the tongue blocks the
 * middle third of the width in the 3 columns around the tongue
 * constriction (h = 0 there) and the outer cells carry the area. In those
 * columns the tract takes the full width W(x), since the tongue sides
 * leave two channels against the cheeks.
 */

import { normalizeHeadConfig } from '../head-config.js';

/** Default cell size (cm). */
export const SHEET_DX = 0.6;
/** Cells shallower than this (cm) are walls. */
export const WALL_DEPTH = 0.02;
/** Depth / width of the elliptic cross-section. */
const ASPECT = 0.4;
/** Distance (cm) over which the region widths blend into each other. */
const BLEND = 2;
/** Widths (cm) of the pharynx, the mouth and the lips for a 1x head. */
const PHARYNX_WIDTH = 3.2;
const ORAL_WIDTH = 4.5;
const LIP_WIDTH = 4;
/** Start of the lip region as a share of the tract. */
const LIP_START = 0.93;

function blend(x, edge, from, to) {
  const t = Math.min(1, Math.max(0, (x - edge + BLEND / 2) / BLEND));
  return from + (to - from) * t;
}

/**
 * Anatomical width W(x) (cm) at `x` cm from the glottis of a tract of
 * `length` cm.
 * @param {number} x
 * @param {number} length
 * @param {Record<string, number>} head Normalised head configuration.
 */
export function regionWidth(x, length, head) {
  const pharynx = PHARYNX_WIDTH * head.pharynxWidth;
  const mouth = ORAL_WIDTH * head.oralWidth;
  const lips = LIP_WIDTH * head.mouthWidth;
  const oral = blend(x, head.pharynxRatio * length, pharynx, mouth);
  return blend(x, LIP_START * length, oral, lips);
}

/**
 * The sheet of a head: a fixed grid whose depths updateSheet sets.
 * @param {object} [head] Head configuration (normalised here).
 * @param {{dx?: number}} [options]
 */
export function buildSheet(head = {}, options = {}) {
  const config = normalizeHeadConfig(head);
  const dx = options.dx ?? SHEET_DX;
  const restLength = config.vocalTractLength;
  const columns = Math.max(4, Math.round(restLength / dx));
  const length = columns * dx;
  const widths = new Float64Array(columns);
  for (let column = 0; column < columns; column++) {
    widths[column] = regionWidth((column + 0.5) * dx, length, config);
  }
  const maxWidth = Math.max(...widths);
  const rows = Math.ceil(maxWidth / dx) + 2;
  const centers = Float64Array.from(
    { length: rows },
    (_, row) => (row - (rows - 1) / 2) * dx
  );
  return {
    dx,
    columns,
    rows,
    /** Grid length (cm): the rest tract length rounded to whole cells. */
    length,
    head: config,
    /** Anatomical width W(x) per column (cm). */
    widths,
    /** Lateral position of the row centres (cm, 0 on the midline). */
    centers,
    /** Depth per cell (cm), column-major: index = column * rows + row. */
    h: new Float64Array(columns * rows),
    /** Area per column (cm²): sum(h) * dx. */
    areas: new Float64Array(columns),
    /** Width the tract takes per column (cm). */
    width: new Float64Array(columns),
    /** Area of the lip opening (cm²): the last value of the area function. */
    lipArea: 0,
    /** Column of the velopharyngeal port. */
    velumColumn: 0,
    /** Columns blocked in the middle by the tongue (lateral), or empty. */
    lateralColumns: [],
  };
}

/**
 * Column of a position given as a share of the tract (0 at the glottis, 1
 * at the lips).
 * @param {{columns: number}} sheet
 * @param {number} share
 */
export function sheetColumn(sheet, share) {
  return Math.min(
    sheet.columns - 1,
    Math.max(0, Math.floor(share * sheet.columns))
  );
}

/**
 * Column of a section of an area function of `sections` entries: section
 * i spans i / sections to (i + 1) / sections of the tract, as in the
 * waveguide.
 */
function sectionColumn(sheet, index, sections) {
  return sheetColumn(sheet, (index + 0.5) / Math.max(1, sections));
}

/**
 * Area of a column: the sections it overlaps in series (their inertances
 * add), so a constriction shorter than a cell keeps its inertance.
 */
function columnArea(areas, column, columns) {
  const sections = areas.length;
  const from = (column / columns) * sections;
  const to = ((column + 1) / columns) * sections;
  let inverse = 0;
  for (let index = Math.floor(from); index < Math.min(sections, to); index++) {
    const overlap = Math.min(to, index + 1) - Math.max(from, index);
    inverse += overlap / Math.max(areas[index], 1e-12);
  }
  return (to - from) / inverse;
}

/** Integral of sqrt(1 - t²) from 0 to t. */
function quarterEllipse(t) {
  const clamped = Math.min(1, Math.max(-1, t));
  return (clamped * Math.sqrt(1 - clamped * clamped) + Math.asin(clamped)) / 2;
}

/**
 * Fill one column with the elliptic profile of `area` over `width`, then
 * block the middle third by `blocked` (0..1) for a lateral.
 */
function fillColumn(sheet, column, area, width, blocked) {
  const { rows, dx, centers, h } = sheet;
  const offset = column * rows;
  const half = width / 2;
  const h0 = (4 * area) / (Math.PI * Math.max(width, 1e-9));
  let deepest = offset;
  for (let row = 0; row < rows; row++) {
    const low = (centers[row] - dx / 2) / half;
    const high = (centers[row] + dx / 2) / half;
    const value =
      low >= 1 || high <= -1
        ? 0
        : (h0 * half * (quarterEllipse(high) - quarterEllipse(low))) / dx;
    h[offset + row] = value;
    if (value > h[deepest]) {
      deepest = offset + row;
    }
  }
  if (h[deepest] <= 0) {
    // Narrower than any cell centre can see: one cell on the midline.
    deepest = offset + Math.floor(rows / 2);
    h[deepest] = 1;
  }
  if (blocked > 0) {
    blockMiddle(sheet, column, width, blocked);
  }
  normalizeColumn(sheet, column, area, deepest);
  sheet.areas[column] = area;
  sheet.width[column] = width;
}

/** Scale the middle third of a column by 1 - blocked. */
function blockMiddle(sheet, column, width, blocked) {
  const { rows, centers, h } = sheet;
  const offset = column * rows;
  let nearest = Infinity;
  for (let row = 0; row < rows; row++) {
    nearest = Math.min(nearest, Math.abs(centers[row]));
  }
  // The middle third, or the cells nearest the midline when no cell
  // centre falls into it.
  const limit = Math.max(width / 6, nearest + 1e-9);
  for (let row = 0; row < rows; row++) {
    if (Math.abs(centers[row]) <= limit) {
      h[offset + row] *= 1 - blocked;
    }
  }
}

/**
 * Scale a column to `area` and turn cells shallower than WALL_DEPTH into
 * walls (shallowest first), keeping at least the cell `keep` or the deepest.
 */
function normalizeColumn(sheet, column, area, keep) {
  const { rows, dx, h } = sheet;
  const offset = column * rows;
  for (;;) {
    let sum = 0;
    let open = 0;
    let shallowest = -1;
    for (let index = offset; index < offset + rows; index++) {
      if (h[index] > 0) {
        sum += h[index];
        open++;
        if (shallowest < 0 || h[index] < h[shallowest]) {
          shallowest = index;
        }
      }
    }
    if (sum <= 0) {
      h[keep] = area / dx;
      return;
    }
    const scale = area / (sum * dx);
    if (open > 1 && h[shallowest] * scale < WALL_DEPTH) {
      h[shallowest] = 0;
      continue;
    }
    for (let index = offset; index < offset + rows; index++) {
      h[index] *= scale;
    }
    return;
  }
}

/**
 * Set the depths of the sheet for a tract shape (see tractShape): column
 * areas from the area function, the elliptic profile across the width,
 * the lateral channels and the column of the velopharyngeal port.
 * @param {ReturnType<typeof buildSheet>} sheet
 * @param {{areas: ArrayLike<number>, velumIndex?: number, lateral?: number, frication?: {index?: number}}} shape
 * @returns {ReturnType<typeof buildSheet>} The sheet.
 */
export function updateSheet(sheet, shape) {
  const { areas } = shape;
  const sections = areas.length;
  const lateral = Math.max(0, Math.min(1, shape.lateral ?? 0));
  sheet.lateralColumns = [];
  if (lateral > 0) {
    const center = sectionColumn(
      sheet,
      shape.frication?.index ?? Math.round(sections / 2),
      sections
    );
    for (let column = center - 1; column <= center + 1; column++) {
      if (column >= 0 && column < sheet.columns) {
        sheet.lateralColumns.push(column);
      }
    }
  }
  for (let column = 0; column < sheet.columns; column++) {
    const area = Math.max(0, columnArea(areas, column, sheet.columns));
    const full = sheet.widths[column];
    const round = Math.sqrt((4 * area) / (Math.PI * ASPECT));
    const blocked = sheet.lateralColumns.includes(column) ? lateral : 0;
    // Laterals spread the air to the cheeks: the tract widens to W(x).
    const width = Math.min(full, round) * (1 - blocked) + full * blocked;
    fillColumn(sheet, column, area, width, blocked);
  }
  sheet.lipArea = Math.max(0, areas[sections - 1]);
  sheet.velumColumn = sectionColumn(
    sheet,
    shape.velumIndex ?? Math.round(0.45 * (sections - 1)),
    sections
  );
  return sheet;
}
