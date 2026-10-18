/**
 * three.js view of a talking character: the demo face or a model the user
 * loads (glTF, GLB or VRM). Whatever the model, its mouth is driven by the
 * same face rig: bindRig maps the morph target names (ARKit, Oculus,
 * VRM, VRoid, MMD) and VRM files bind through the vowel expressions they
 * declare.
 */

import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  bindRig,
  faceRig,
  rigFrame,
  vrmExpressions,
  vrmVowelBinds,
} from '../../../../src/index.js';
import { demoFace } from './demo-face.js';

function morphMeshes(root) {
  const meshes = [];
  root.traverse((object) => {
    if (object.morphTargetDictionary && object.morphTargetInfluences) {
      meshes.push(object);
    }
  });
  return meshes;
}

function meshesOf(object) {
  const meshes = [];
  object?.traverse((child) => {
    if (child.morphTargetInfluences) {
      meshes.push(child);
    }
  });
  return meshes;
}

/**
 * Bind a VRM file's vowel expressions to its loaded meshes.
 * @returns {Promise<{vowel: string, mesh: object, index: number, weight: number}[]|null>}
 */
async function vrmTargets(gltf) {
  const binds = vrmVowelBinds(gltf.parser.json);
  if (!binds) {
    return null;
  }
  const nodes = gltf.parser.json.nodes ?? [];
  const targets = [];
  for (const [vowel, list] of Object.entries(binds)) {
    for (const bind of list) {
      const nodeIndices =
        bind.node !== undefined
          ? [bind.node]
          : nodes.flatMap((node, index) =>
              node.mesh === bind.mesh ? [index] : []
            );
      for (const nodeIndex of nodeIndices) {
        const node = await gltf.parser.getDependency('node', nodeIndex);
        for (const mesh of meshesOf(node)) {
          targets.push({ vowel, mesh, index: bind.index, weight: bind.weight });
        }
      }
    }
  }
  return targets.length > 0 ? targets : null;
}

export class CharacterViewer {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    container.appendChild(this.renderer.domElement);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(30, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new AmbientLight(0xffffff, 0.45));
    this.scene.add(new HemisphereLight(0xfff4e6, 0x334455, 1.1));
    const key = new DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 4, 6);
    this.scene.add(key);
    this.model = new Group();
    this.scene.add(this.model);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setModel(demoFace(), 'demo');
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    if (!clientWidth || !clientHeight) {
      return;
    }
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Show a model and bind its morph targets.
   * @param {object} root three.js object.
   * @param {string} name Shown in the status line.
   * @param {object[]|null} [vrm] Targets from vrmTargets().
   * @returns {{name: string, format: string|null, bound: number}}
   */
  setModel(root, name, vrm = null) {
    this.scene.remove(this.model);
    this.model = root;
    this.scene.add(root);
    this.meshes = morphMeshes(root);
    const names = [
      ...new Set(
        this.meshes.flatMap((mesh) => Object.keys(mesh.morphTargetDictionary))
      ),
    ];
    this.vrm = vrm;
    this.binding = bindRig(names);
    this.frame(root);
    this.info = {
      name,
      format: vrm ? 'vrm' : this.binding.format,
      bound: vrm ? vrm.length : this.binding.targets.length,
    };
    return this.info;
  }

  /** Point the camera at the face: the top fifth of the model's box. */
  frame(root) {
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());
    const tall = size.y > size.x * 2.2;
    const centre = box.getCenter(new Vector3());
    const height = tall ? size.y * 0.16 : size.y;
    if (tall) {
      centre.y = box.max.y - height * 0.55;
    }
    const distance =
      (height * 0.62) / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      centre.x + distance * 0.35,
      centre.y + distance * 0.05,
      centre.z + distance * 0.94
    );
    this.controls.target.copy(centre);
    this.controls.update();
  }

  /**
   * Load a glTF, GLB or VRM file.
   * @param {ArrayBuffer} data
   * @param {string} name
   */
  async load(data, name) {
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const root = gltf.scene;
    // VRM 0.x models face -z.
    if (gltf.parser.json.extensions?.VRM) {
      root.rotation.y = Math.PI;
    }
    return this.setModel(root, name, await vrmTargets(gltf));
  }

  showDemo() {
    return this.setModel(demoFace(), 'demo');
  }

  /**
   * Pose the mouth for an articulator state.
   * @param {object} state sampleState() output, {} for rest.
   * @param {object} head Head configuration.
   */
  update(state, head) {
    const rig = faceRig(state, head);
    for (const mesh of this.meshes) {
      mesh.morphTargetInfluences.fill(0);
    }
    if (this.vrm) {
      const weights = vrmExpressions(rig);
      for (const target of this.vrm) {
        const value = weights[target.vowel] * target.weight;
        target.mesh.morphTargetInfluences[target.index] = Math.max(
          target.mesh.morphTargetInfluences[target.index],
          value
        );
      }
      return;
    }
    const frame = rigFrame(this.binding, rig);
    for (const mesh of this.meshes) {
      for (const [name, value] of Object.entries(frame)) {
        const index = mesh.morphTargetDictionary[name];
        if (index !== undefined) {
          mesh.morphTargetInfluences[index] = value;
        }
      }
    }
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
