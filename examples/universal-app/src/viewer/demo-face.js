/**
 * A head-only character built in code, with morph targets named after the
 * ARKit blendshapes, the way MetaHuman, Ready Player Me and most face
 * capture rigs name them. It is animated like any loaded model: through
 * bindRig, which only sees the morph target names. Units are centimetres;
 * the face looks along +z and the character's left is +x.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  BackSide,
} from 'three';

const RADII = [7.4, 10.2, 8.6];
const MOUTH_Y = -4.6;
const MOUTH_HALF_WIDTH = 2.5;
/** Hole in the skin the lips cover, half height. */
const HOLE_HALF_HEIGHT = 0.75;
/**
 * Jaw hinge, a little in front of the ear, and its widest rotation: at
 * jawOpen 1 the incisors part by MAX_OPENING (4.5 cm), as in the rig.
 */
const HINGE = [0, -1.6, -1.5];
const JAW_ANGLE = 0.54;

function smoothstep(low, high, value) {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/** Rotate a point about the jaw hinge (x axis) by angle × weight. */
function openJaw([x, y, z], weight, angle = JAW_ANGLE) {
  const a = angle * weight;
  const dy = y - HINGE[1];
  const dz = z - HINGE[2];
  return [
    x,
    HINGE[1] + dy * Math.cos(a) - dz * Math.sin(a),
    HINGE[2] + dy * Math.sin(a) + dz * Math.cos(a),
  ];
}

/** Front of the skin at (x, y). */
function surfaceZ(x, y) {
  const [rx, ry, rz] = RADII;
  const inside = 1 - (x / rx) ** 2 - (y / ry) ** 2;
  return rz * Math.sqrt(Math.max(0, inside));
}

/** How much of a skin point moves with the mandible. */
function jawShare(y, z) {
  return smoothstep(MOUTH_Y + 0.2, MOUTH_Y - 1.2, y) * smoothstep(-5, 2, z);
}

function skinPoint(theta, phi) {
  const [rx, ry, rz] = RADII;
  let x = rx * Math.sin(phi) * Math.sin(theta);
  const y = ry * Math.cos(phi);
  let z = rz * Math.sin(phi) * Math.cos(theta);
  // Narrower chin and jaw, flatter cheeks.
  const chin = smoothstep(-2, -10, y);
  x *= 1 - 0.3 * chin;
  z *= 1 - 0.08 * chin;
  return [x, y, z];
}

function inMouthHole([x, y, z]) {
  return (
    z > 0 &&
    (x / MOUTH_HALF_WIDTH) ** 2 + ((y - MOUTH_Y) / HOLE_HALF_HEIGHT) ** 2 < 1
  );
}

/** Mesh data with morph targets from a function of the shape weights. */
function morphGeometry(build, shapes) {
  const base = build({});
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(base.positions, 3)
  );
  geometry.setIndex(base.indices);
  geometry.morphAttributes.position = shapes.map((name) => {
    const shaped = build({ [name]: 1 }).positions;
    const delta = shaped.map((value, index) => value - base.positions[index]);
    const attribute = new Float32BufferAttribute(delta, 3);
    attribute.name = name;
    return attribute;
  });
  geometry.morphTargetsRelative = true;
  geometry.computeVertexNormals();
  return geometry;
}

function skin(weights, columns = 96, rows = 64) {
  const positions = [];
  const indices = [];
  const points = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const point = skinPoint(
        (column / columns) * Math.PI * 2,
        (row / rows) * Math.PI
      );
      points.push(point);
      const [x, y, z] = openJaw(
        aroundMouth(point, weights),
        (weights.jawOpen ?? 0) * jawShare(point[1], point[2])
      );
      positions.push(x, y, z);
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * stride + column;
      const quad = [a, a + stride, a + 1, a + stride + 1];
      const centre = [0, 1, 2].map(
        (axis) => quad.reduce((sum, index) => sum + points[index][axis], 0) / 4
      );
      if (!inMouthHole(centre)) {
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
  }
  return { positions, indices };
}

/** Centre line and thickness of a lip at s in -1..1 (corner to corner). */
/** Weight of a left or right shape at s (-1 right corner, 1 left). */
function sided(w, left, right, s) {
  return (
    (w[left] ?? 0) * smoothstep(-0.2, 1, s) +
    (w[right] ?? 0) * smoothstep(0.2, -1, s)
  );
}

/** How far the mouth corner moves in and out (1 at rest). */
function cornerScale(w, s) {
  const side = (left, right) => sided(w, left, right, s);
  return (
    1 -
    0.38 * (w.mouthFunnel ?? 0) -
    0.5 * (w.mouthPucker ?? 0) +
    0.22 * side('mouthStretchLeft', 'mouthStretchRight') +
    0.1 * side('mouthSmileLeft', 'mouthSmileRight')
  );
}

/** The skin around the mouth follows the lip corners and protrusion. */
function aroundMouth([x, y, z], w) {
  if (z <= 0) {
    return [x, y, z];
  }
  const near = Math.exp(
    -((x / (MOUTH_HALF_WIDTH + 1.2)) ** 2) - ((y - MOUTH_Y) / 1.6) ** 2
  );
  const s = Math.max(-1, Math.min(1, x / MOUTH_HALF_WIDTH));
  const scale = 1 + (cornerScale(w, s) - 1) * near;
  const forward =
    near * (0.45 * (w.mouthFunnel ?? 0) + 0.9 * (w.mouthPucker ?? 0));
  return [x * scale, y, z + forward];
}

function lipSection(upper, s, w) {
  const side = (left, right) => sided(w, left, right, s);
  const middle = (1 - s * s) ** 0.7;
  const sign = upper ? 1 : -1;
  const funnel = w.mouthFunnel ?? 0;
  const pucker = w.mouthPucker ?? 0;
  const stretch = side('mouthStretchLeft', 'mouthStretchRight');
  const smile = side('mouthSmileLeft', 'mouthSmileRight');
  const press = side('mouthPressLeft', 'mouthPressRight');
  const roll = (upper ? w.mouthRollUpper : w.mouthRollLower) ?? 0;
  const raise = upper
    ? side('mouthUpperUpLeft', 'mouthUpperUpRight')
    : -side('mouthLowerDownLeft', 'mouthLowerDownRight');
  const x = MOUTH_HALF_WIDTH * s * cornerScale(w, s);
  let radius = (upper ? 0.42 : 0.5) * (0.35 + 0.65 * Math.sqrt(1 - s * s));
  radius *= 1 - 0.25 * press - 0.3 * roll - 0.2 * stretch + 0.3 * pucker;
  let y = MOUTH_Y + sign * radius;
  y += sign * middle * (0.55 * funnel) + middle * 0.65 * raise;
  y += Math.abs(s) ** 2 * (0.45 * smile - 0.25 * stretch);
  y -= sign * (0.1 * press + 0.12 * roll);
  let z = surfaceZ(x, MOUTH_Y) + 0.1 + middle * (0.55 * funnel + 1.1 * pucker);
  z -= 0.35 * roll * middle;
  return { centre: [x, y, z], radius };
}

function lip(upper, weights, segments = 40, sides = 14) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const s = -1 + (2 * i) / segments;
    const { centre, radius } = lipSection(upper, s, weights);
    let point = centre;
    if (!upper) {
      // The lower lip rides on the mandible; mouthClose holds it against
      // the upper lip while the jaw opens.
      const share = 1 - 0.55 * Math.abs(s) ** 4;
      const close = weights.mouthClose ?? 0;
      point = openJaw(centre, share * ((weights.jawOpen ?? 0) - close));
    }
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      positions.push(
        point[0],
        point[1] + radius * Math.cos(angle),
        point[2] + radius * 0.85 * Math.sin(angle)
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  return { positions, indices };
}

/** A row of incisors and canines as one arch of small boxes. */
function teeth(upper, weights) {
  const positions = [];
  const indices = [];
  const count = 10;
  for (let tooth = 0; tooth < count; tooth++) {
    const s = -0.9 + (1.8 * tooth) / (count - 1);
    const x = MOUTH_HALF_WIDTH * 0.85 * s;
    const z = surfaceZ(x, MOUTH_Y) - 0.75 - 1.6 * s * s;
    const top = upper ? MOUTH_Y + 0.75 : MOUTH_Y - 0.1;
    const bottom = upper ? MOUTH_Y + 0.05 : MOUTH_Y - 0.8;
    const half = 0.19;
    const corners = [];
    for (const dy of [bottom, top]) {
      for (const dz of [z - 0.35, z]) {
        for (const dx of [x - half, x + half]) {
          corners.push([dx, dy, dz]);
        }
      }
    }
    const start = positions.length / 3;
    for (const corner of corners) {
      const [px, py, pz] = upper
        ? corner
        : openJaw(corner, weights.jawOpen ?? 0);
      positions.push(px, py, pz);
    }
    for (const [a, b, c, d] of [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ]) {
      indices.push(
        start + a,
        start + b,
        start + c,
        start + a,
        start + c,
        start + d
      );
    }
  }
  return { positions, indices };
}

function tongue(weights) {
  const sphere = new SphereGeometry(1, 24, 12);
  const source = sphere.getAttribute('position');
  const positions = [];
  const out = weights.tongueOut ?? 0;
  for (let index = 0; index < source.count; index++) {
    const x = source.getX(index) * 1.7;
    const y = source.getY(index) * 0.55 + MOUTH_Y - 0.95;
    let z = source.getZ(index) * 2.4 + surfaceZ(0, MOUTH_Y) - 3.1;
    z += out * 2 * smoothstep(-1, 1, source.getZ(index));
    positions.push(...openJaw([x, y - 0.4 * out, z], weights.jawOpen ?? 0));
  }
  const indices = Array.from(sphere.getIndex().array);
  sphere.dispose();
  return { positions, indices };
}

function ellipsoid(radii, position, material) {
  const mesh = new Mesh(new SphereGeometry(1, 32, 16), material);
  mesh.scale.set(...radii);
  mesh.position.set(...position);
  return mesh;
}

const LIP_SHAPES = [
  'jawOpen',
  'mouthClose',
  'mouthFunnel',
  'mouthPucker',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
];

/**
 * Build the demo character.
 * @returns {Group} Meshes with ARKit-named morph targets.
 */
export function demoFace() {
  const group = new Group();
  const skinMaterial = new MeshStandardMaterial({
    color: 0xe9b99a,
    roughness: 0.75,
  });
  const lipMaterial = new MeshStandardMaterial({
    color: 0xc25b5f,
    roughness: 0.55,
  });
  const toothMaterial = new MeshStandardMaterial({
    color: 0xf4eee0,
    roughness: 0.3,
  });
  const dark = new MeshStandardMaterial({
    color: 0x3a1418,
    roughness: 0.9,
    side: BackSide,
  });
  const add = (geometry, material, name) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  add(
    morphGeometry(skin, [
      'jawOpen',
      'mouthFunnel',
      'mouthPucker',
      'mouthSmileLeft',
      'mouthSmileRight',
      'mouthStretchLeft',
      'mouthStretchRight',
    ]),
    skinMaterial,
    'Head'
  );
  add(
    morphGeometry((w) => lip(true, w), LIP_SHAPES),
    lipMaterial,
    'UpperLip'
  );
  add(
    morphGeometry((w) => lip(false, w), LIP_SHAPES),
    lipMaterial,
    'LowerLip'
  );
  add(
    morphGeometry((w) => teeth(true, w), ['jawOpen']),
    toothMaterial,
    'UpperTeeth'
  );
  add(
    morphGeometry((w) => teeth(false, w), ['jawOpen']),
    toothMaterial,
    'LowerTeeth'
  );
  add(
    morphGeometry(tongue, ['jawOpen', 'tongueOut']),
    new MeshStandardMaterial({ color: 0xc8656d, roughness: 0.6 }),
    'Tongue'
  );
  const front = surfaceZ(0, MOUTH_Y);
  group.add(ellipsoid([2.9, 2.4, 3.4], [0, MOUTH_Y - 0.6, front - 3.4], dark));
  const white = new MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.2 });
  const iris = new MeshStandardMaterial({ color: 0x3d5a73, roughness: 0.3 });
  const brow = new MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const eyeZ = surfaceZ(2.9, 1.6) - 0.75;
    group.add(ellipsoid([1.15, 1.15, 1.15], [2.9 * side, 1.6, eyeZ], white));
    group.add(
      ellipsoid([0.55, 0.55, 0.3], [2.9 * side, 1.6, eyeZ + 1.0], iris)
    );
    const browMesh = ellipsoid(
      [1.5, 0.22, 0.4],
      [2.9 * side, 3.3, surfaceZ(2.9, 3.3) + 0.1],
      brow
    );
    browMesh.rotation.z = -0.12 * side;
    group.add(browMesh);
    group.add(ellipsoid([1, 2.3, 1.4], [7.1 * side, 0.3, -0.6], skinMaterial));
  }
  group.add(
    ellipsoid([1.1, 2.1, 1.6], [0, -1.1, surfaceZ(0, -1.1) - 0.2], skinMaterial)
  );
  const hair = new MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.85 });
  const cap = ellipsoid([7.8, 7.2, 8.9], [0, 4.6, -1.2], hair);
  group.add(cap);
  group.add(ellipsoid([3.6, 6, 3.6], [0, -11, -2], skinMaterial));
  return group;
}
