/**
 * three.js view of the simulated head: a translucent low-poly skin, the
 * vocal and nasal tract tubes coloured by acoustic pressure, the lips and
 * (with the 3D solver) the pressure in every air voxel. The tract follows
 * the articulation plan frame by frame; the jaw and lips are optional.
 * The microphone is a small sphere and the box around the head a wireframe.
 */

import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  deformJaw,
  enclosureBounds,
  headLandmarks,
  headMesh,
  lipsMesh,
  microphonePosition,
  nasalCenterline,
  noseShape,
  tractCenterline,
  tractShape,
  tubeMesh,
  updateTubeMesh,
} from '../../../../src/index.js';

const LOW = new Color(0.16, 0.32, 0.62);
const MID = new Color(0.98, 0.78, 0.25);
const HIGH = new Color(0.92, 0.2, 0.12);
const TARGET = [0, -5, 2];

/** Map 0..1 to a blue -> amber -> red ramp. */
export function pressureColor(value, out) {
  const v = Math.min(1, Math.max(0, value));
  if (v < 0.5) {
    return out.copy(LOW).lerp(MID, v * 2);
  }
  return out.copy(MID).lerp(HIGH, (v - 0.5) * 2);
}

function geometryFrom(mesh, colors = false) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(Float32Array.from(mesh.positions), 3)
  );
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  if (colors) {
    const count = mesh.positions.length / 3;
    geometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(count * 3).fill(0.6), 3)
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Normalises field values with a slowly decaying peak. */
class Normalizer {
  constructor() {
    this.peak = 1e-9;
  }

  update(values) {
    let max = 0;
    for (const value of values) {
      max = Math.max(max, Math.abs(value));
    }
    this.peak = Math.max(max, this.peak * 0.97, 1e-9);
    return this.peak;
  }
}

function colorTube(geometry, ring, values, peak) {
  const colors = geometry.getAttribute('color');
  const sections = colors.count / ring;
  const color = new Color();
  for (let section = 0; section < sections; section++) {
    const position = sections > 1 ? section / (sections - 1) : 0;
    const value = values
      ? values[Math.round(position * (values.length - 1))] / peak
      : 0.08 * position;
    pressureColor(values ? Math.sqrt(value) : value, color);
    for (let step = 0; step < ring; step++) {
      colors.setXYZ(section * ring + step, color.r, color.g, color.b);
    }
  }
  colors.needsUpdate = true;
}

export class HeadViewer {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    container.appendChild(this.renderer.domElement);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(32, 1, 1, 600);
    this.camera.position.set(62, 4, 26);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...TARGET);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });
    this.controls.update();
    this.scene.add(new AmbientLight(0xffffff, 0.35));
    this.scene.add(new HemisphereLight(0xfff4e6, 0x334455, 1.2));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 40, 50);
    this.scene.add(sun);
    this.group = new Group();
    this.scene.add(this.group);
    this.listeningGroup = new Group();
    this.scene.add(this.listeningGroup);
    this.listening = {};
    this.normalizer = new Normalizer();
    this.cellNormalizer = new Normalizer();
    this.cells = null;
    this.dirty = true;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) {
      return;
    }
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  #clear() {
    for (const child of [...this.group.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      this.group.remove(child);
    }
    this.cellPoints = null;
  }

  /**
   * Build the meshes for a head at a mesh level of detail.
   * @param {object} head Head configuration.
   * @param {number} lod 0..3
   */
  setHead(head, lod) {
    this.#clear();
    this.head = head;
    this.lod = lod;
    const skin = headMesh(head, { lod });
    this.skinBase = Float32Array.from(skin.positions);
    const skinGeometry = geometryFrom(skin);
    this.skin = new Mesh(
      skinGeometry,
      new MeshStandardMaterial({
        color: 0xe8b796,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: DoubleSide,
        flatShading: true,
      })
    );
    this.skin.renderOrder = 2;
    const wire = new Mesh(
      skinGeometry,
      new MeshBasicMaterial({
        color: 0x9a6a50,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
      })
    );
    wire.renderOrder = 3;

    const neutral = tractShape({}, head);
    this.tractMesh = tubeMesh(
      tractCenterline(head, {
        sections: neutral.areas.length,
        length: neutral.length,
      }),
      neutral.areas,
      { lod, head }
    );
    this.tract = new Mesh(
      geometryFrom(this.tractMesh, true),
      new MeshStandardMaterial({ vertexColors: true, side: DoubleSide })
    );
    const nose = noseShape(head);
    const velumDistance =
      ((neutral.velumIndex + 0.5) / neutral.areas.length) * neutral.length;
    this.noseMesh = tubeMesh(
      nasalCenterline(head, {
        sections: nose.areas.length,
        velumDistance,
        length: nose.length,
      }),
      nose.areas,
      { lod, head }
    );
    this.nose = new Mesh(
      geometryFrom(this.noseMesh, true),
      new MeshStandardMaterial({ vertexColors: true, side: DoubleSide })
    );
    this.lips = new Mesh(
      geometryFrom(lipsMesh(head, { area: neutral.areas.at(-1), lod })),
      new MeshStandardMaterial({ color: 0xc0505a, roughness: 0.6 })
    );
    this.group.add(this.tract, this.nose, this.lips, this.skin, wire);
    colorTube(this.tract.geometry, this.tractMesh.ring, null, 1);
    colorTube(this.nose.geometry, this.noseMesh.ring, null, 1);
    if (this.cells) {
      this.setCells(this.cells);
    }
    this.setListening(this.listening);
    this.dirty = true;
  }

  /**
   * Show the microphone and the box around the head.
   * @param {{microphone?: object, enclosure?: object}} listening
   *   The listening options of synthesize.
   */
  setListening(listening) {
    this.listening = listening ?? {};
    for (const child of [...this.listeningGroup.children]) {
      child.geometry.dispose();
      child.material.dispose();
      this.listeningGroup.remove(child);
    }
    if (!this.head) {
      return;
    }
    const { microphone, enclosure } = this.listening;
    const marker = new Mesh(
      new SphereGeometry(0.8, 12, 8),
      new MeshStandardMaterial({ color: 0x40464f, metalness: 0.6 })
    );
    marker.position.set(
      ...microphonePosition(microphone, headLandmarks(this.head).lips)
    );
    this.listeningGroup.add(marker);
    let box = null;
    try {
      box = enclosure ? enclosureBounds(this.head, enclosure) : null;
    } catch {
      // The settings panel explains why the box does not fit.
    }
    if (box) {
      const size = box.high.map((value, axis) => value - box.low[axis]);
      const edges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(...size)),
        new LineBasicMaterial({ color: 0x5a7fa8 })
      );
      edges.position.set(
        ...box.low.map((value, axis) => value + size[axis] / 2)
      );
      this.listeningGroup.add(edges);
    }
    this.dirty = true;
  }

  /**
   * Voxel cells of the 3D solver (positions in cm, kinds 0 tract, 1 nose, 2 air).
   * @param {{positions: Float32Array, kinds: Uint8Array}|null} cells
   */
  setCells(cells) {
    if (this.cellPoints) {
      this.group.remove(this.cellPoints);
      this.cellPoints.geometry.dispose();
      this.cellPoints.material.dispose();
      this.cellPoints = null;
    }
    this.cells = cells;
    if (!cells) {
      return;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(cells.positions, 3));
    geometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(cells.positions.length).fill(0.4), 3)
    );
    this.cellPoints = new Points(
      geometry,
      new PointsMaterial({
        size: 0.55,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    this.cellPoints.renderOrder = 1;
    this.group.add(this.cellPoints);
    this.dirty = true;
  }

  #updateTract(state) {
    const shape = tractShape(state, this.head);
    const path = tractCenterline(this.head, {
      sections: shape.areas.length,
      length: shape.length,
    });
    updateTubeMesh(this.tractMesh, path, shape.areas, {
      lod: this.lod,
      head: this.head,
    });
    const attribute = this.tract.geometry.getAttribute('position');
    attribute.array.set(this.tractMesh.positions);
    attribute.needsUpdate = true;
    this.tract.geometry.computeVertexNormals();
    return shape;
  }

  #updateMouth(shape, state, animate) {
    const area = animate ? shape.areas.at(-1) : 1.2;
    const openness = animate ? Math.min(1, Math.sqrt(area / 4)) : 0.15;
    const skin = this.skin.geometry.getAttribute('position');
    deformJaw(this.skinBase, skin.array, this.head, openness);
    skin.needsUpdate = true;
    this.skin.geometry.computeVertexNormals();
    const lips = lipsMesh(this.head, {
      area,
      rounding: animate ? (state.rounding ?? 0) : 0,
      lod: this.lod,
    });
    const attribute = this.lips.geometry.getAttribute('position');
    attribute.array.set(lips.positions);
    attribute.needsUpdate = true;
    this.lips.geometry.computeVertexNormals();
  }

  #updateField(field, showCells) {
    const waveguide = field && !this.cells ? field : null;
    const peak = waveguide ? this.normalizer.update(waveguide.pressure) : 1;
    colorTube(
      this.tract.geometry,
      this.tractMesh.ring,
      waveguide?.pressure,
      peak
    );
    colorTube(this.nose.geometry, this.noseMesh.ring, waveguide?.nose, peak);
    if (!this.cellPoints) {
      return;
    }
    this.cellPoints.visible = showCells;
    if (
      !showCells ||
      !field ||
      field.pressure.length * 3 !== this.cells.positions.length
    ) {
      return;
    }
    const cellPeak = this.cellNormalizer.update(field.pressure);
    const colors = this.cellPoints.geometry.getAttribute('color');
    const color = new Color();
    for (let index = 0; index < field.pressure.length; index++) {
      pressureColor(Math.sqrt(field.pressure[index] / cellPeak), color);
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }

  /**
   * Update the meshes for an articulator state and pressure field.
   * @param {{state: object, field: object|null, animateMouth: boolean, showCells: boolean}} frame
   */
  update(frame) {
    const shape = this.#updateTract(frame.state);
    this.#updateMouth(shape, frame.state, frame.animateMouth);
    this.#updateField(frame.field, frame.showCells);
    this.dirty = true;
  }

  /** Render if anything changed; returns whether a frame was drawn. */
  render(force = false) {
    this.controls.update();
    if (!this.dirty && !force) {
      return false;
    }
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.#clear();
    this.head = null;
    this.setListening({});
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
