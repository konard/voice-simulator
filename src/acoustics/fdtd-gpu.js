/**
 * WebGPU version of the FDTD step loop (see fdtd3d.js).
 *
 * The grids of the head are small (a few thousand to some ten thousand
 * cells), too small to fill a GPU with one dispatch per step: the launch
 * overhead would dominate. Instead one workgroup runs a whole chunk of
 * steps in a single dispatch and synchronises the link and cell passes of
 * each step with workgroup barriers, so the state never leaves the GPU
 * between steps and only the output samples are read back.
 *
 * The CPU keeps doing everything that is not the step loop: it sets the
 * shape, selects the noise links and integrates the sources. Steps are
 * queued with their noise force and source pressure; whenever the solver's
 * coefficients change (a new tract shape), a segment starts that carries
 * the new conductance and damping of the tube links and the gain of the
 * tube cells. The arithmetic is f32, so the output follows the f64 CPU
 * kernels closely but not bit for bit.
 *
 * Cells gather the flux of their links through a compressed adjacency
 * list (no atomics), and each step's output is summed in OUTPUT_PARTS
 * partial sums that the CPU adds up.
 */

const OUTPUT_PARTS = 8;
const MAX_WORKGROUP = 1024;
/** Segment flags: new link and cell coefficients, new noise links. */
const UPDATE_COEFFICIENTS = 1;
const UPDATE_NOISE = 2;
/** Words per segment record: first step, step count, data offset, flags. */
const SEGMENT_WORDS = 4;
const PARAM_WORDS = 16;
/** GPUBufferUsage and GPUMapMode flags (fixed by the WebGPU standard). */
const MAP_READ = 0x1;
const COPY_SRC = 0x4;
const COPY_DST = 0x8;
const UNIFORM = 0x40;
const STORAGE = 0x80;

const shader = (workgroup) => /* wgsl */ `
struct Params {
  links: u32, cells: u32, segments: u32, stepBase: u32,
  trackedLinks: u32, trackedCells: u32, outputs: u32, microphone: u32,
  linkB: u32, cellStart: u32, cellLinks: u32, trackedLinkBase: u32,
  trackedCellBase: u32, outputBase: u32, courant: f32, flowMode: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> topology: array<u32>;
@group(0) @binding(2) var<storage, read> chunk: array<u32>;
// velocity, flux, conductance, damping, noise sign, output signs
@group(0) @binding(3) var<storage, read_write> links: array<f32>;
// pressure, keep, gain, source weight, sum of squared pressure
@group(0) @binding(4) var<storage, read_write> cells: array<f32>;
@group(0) @binding(5) var<storage, read_write> out: array<f32>;

const WORKGROUP = ${workgroup}u;
const PARTS = ${OUTPUT_PARTS}u;

fn applySegment(lid: u32, data: u32, flags: u32) {
  let L = params.links;
  let C = params.cells;
  let TL = params.trackedLinks;
  if ((flags & ${UPDATE_COEFFICIENTS}u) != 0u) {
    for (var k = lid; k < TL; k += WORKGROUP) {
      let link = topology[params.trackedLinkBase + k];
      let conductance = bitcast<f32>(chunk[data + k]);
      links[2u * L + link] = conductance;
      links[3u * L + link] = bitcast<f32>(chunk[data + TL + k]);
      // Shut links (teeth, closed velum) lose their flow.
      if (conductance == 0.0) {
        links[link] = 0.0;
      }
    }
    for (var k = lid; k < params.trackedCells; k += WORKGROUP) {
      let cell = topology[params.trackedCellBase + k];
      let gain = bitcast<f32>(chunk[data + 2u * TL + k]);
      // A negative gain marks a solid cell, which holds no pressure.
      if (gain < 0.0) {
        cells[cell] = 0.0;
      }
      cells[2u * C + cell] = abs(gain);
    }
  }
  if ((flags & ${UPDATE_NOISE}u) != 0u) {
    var base = data;
    if ((flags & ${UPDATE_COEFFICIENTS}u) != 0u) {
      base += 2u * TL + params.trackedCells;
    }
    for (var k = lid; k < TL; k += WORKGROUP) {
      let link = topology[params.trackedLinkBase + k];
      links[4u * L + link] = bitcast<f32>(chunk[base + k]);
    }
  }
}

fn linkPass(lid: u32, force: f32) {
  let L = params.links;
  for (var link = lid; link < L; link += WORKGROUP) {
    let a = topology[link];
    let b = topology[params.linkB + link];
    let velocity = links[link] + force * links[4u * L + link];
    let u = links[3u * L + link] *
      (velocity - params.courant * (cells[b] - cells[a]));
    links[link] = u;
    links[L + link] = links[2u * L + link] * u;
  }
}

fn cellPass(lid: u32, step: u32, inject: f32) {
  let L = params.links;
  let C = params.cells;
  for (var cell = lid; cell < C; cell += WORKGROUP) {
    var divergence = 0.0;
    let last = topology[params.cellStart + cell + 1u];
    for (var k = topology[params.cellStart + cell]; k < last; k++) {
      let entry = topology[params.cellLinks + k];
      let flux = links[L + (entry >> 1u)];
      divergence += select(flux, -flux, (entry & 1u) == 1u);
    }
    let pressure = cells[C + cell] * cells[cell] -
      cells[2u * C + cell] * divergence + cells[3u * C + cell] * inject;
    cells[cell] = pressure;
    cells[4u * C + cell] += pressure * pressure;
    if (cell == params.microphone) {
      out[step * PARTS] = pressure;
    }
  }
}

fn flowPart(lid: u32, step: u32) {
  let L = params.links;
  var sum = 0.0;
  for (var k = lid; k < params.outputs; k += PARTS) {
    let link = topology[params.outputBase + k];
    sum += links[5u * L + k] * links[L + link];
  }
  out[step * PARTS + lid] = sum;
}

@compute @workgroup_size(WORKGROUP)
fn main(@builtin(local_invocation_index) lid: u32) {
  for (var segment = 0u; segment < params.segments; segment++) {
    let record = segment * ${SEGMENT_WORDS}u;
    let first = chunk[record];
    let count = chunk[record + 1u];
    applySegment(lid, chunk[record + 2u], chunk[record + 3u]);
    storageBarrier();
    for (var step = first; step < first + count; step++) {
      let force = bitcast<f32>(chunk[params.stepBase + 2u * step]);
      let inject = bitcast<f32>(chunk[params.stepBase + 2u * step + 1u]);
      linkPass(lid, force);
      storageBarrier();
      if (params.flowMode == 1u && lid < PARTS) {
        flowPart(lid, step);
      }
      cellPass(lid, step, inject);
      storageBarrier();
    }
  }
}
`;

/** A Uint32Array that grows by doubling, with a Float32Array view. */
class Words {
  constructor(capacity = 1024) {
    this.#allocate(capacity);
    this.length = 0;
  }

  #allocate(capacity) {
    const previous = this.u32;
    this.u32 = new Uint32Array(capacity);
    this.f32 = new Float32Array(this.u32.buffer);
    if (previous) {
      this.u32.set(previous.subarray(0, this.length));
    }
  }

  /** Reserve `count` words; returns the offset of the first. */
  reserve(count) {
    if (this.length + count > this.u32.length) {
      this.#allocate(Math.max(2 * this.u32.length, this.length + count));
    }
    const offset = this.length;
    this.length += count;
    return offset;
  }
}

/** Compressed adjacency: for each cell, its links (link * 2 + 1 if it is b). */
function cellAdjacency(linkA, linkB, cellCount) {
  const start = new Uint32Array(cellCount + 1);
  for (let link = 0; link < linkA.length; link++) {
    start[linkA[link] + 1]++;
    start[linkB[link] + 1]++;
  }
  for (let cell = 0; cell < cellCount; cell++) {
    start[cell + 1] += start[cell];
  }
  const fill = start.slice(0, cellCount);
  const entries = new Uint32Array(2 * linkA.length);
  for (let link = 0; link < linkA.length; link++) {
    entries[fill[linkA[link]]++] = link * 2;
    entries[fill[linkB[link]]++] = link * 2 + 1;
  }
  return { start, entries };
}

/**
 * Request a WebGPU device for the solver, or null where WebGPU (or a
 * usable adapter) is missing. Asks for the largest workgroup the adapter
 * offers, up to 1024 invocations.
 * @param {{gpu?: object}} [options]
 * @returns {Promise<object|null>}
 */
export async function requestGpuDevice(options = {}) {
  const gpu = options.gpu ?? globalThis.navigator?.gpu;
  if (!gpu) {
    return null;
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return null;
    }
    const size = Math.min(
      MAX_WORKGROUP,
      adapter.limits.maxComputeInvocationsPerWorkgroup,
      adapter.limits.maxComputeWorkgroupSizeX
    );
    return await adapter.requestDevice({
      requiredLimits: {
        maxComputeInvocationsPerWorkgroup: size,
        maxComputeWorkgroupSizeX: size,
      },
    });
  } catch {
    return null;
  }
}

/**
 * GPU step loop of one Fdtd3d solver. The solver queues steps
 * (`queue(force, inject)`) and collects their outputs with `flush()`.
 */
export class FdtdGpu {
  /**
   * @param {object} solver The Fdtd3d it runs for.
   * @param {object} device A GPUDevice.
   */
  constructor(solver, device) {
    this.solver = solver;
    this.device = device;
    this.workgroup = Math.max(
      1,
      Math.min(
        MAX_WORKGROUP,
        device.limits.maxComputeInvocationsPerWorkgroup,
        device.limits.maxComputeWorkgroupSizeX
      )
    );
    this.#buildTopology();
    const storage = (words, usage = 0) =>
      device.createBuffer({
        size: Math.max(16, words * 4),
        usage: STORAGE | COPY_DST | usage,
      });
    const { linkCount: L, cellCount: C } = solver;
    this.buffers = {
      params: device.createBuffer({
        size: PARAM_WORDS * 4,
        usage: UNIFORM | COPY_DST,
      }),
      topology: storage(this.topology.length),
      links: storage(5 * L + this.outputCount, COPY_SRC),
      cells: storage(5 * C, COPY_SRC),
      chunk: null,
      out: null,
    };
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: shader(this.workgroup) }),
        entryPoint: 'main',
      },
    });
    this.uploaded = false;
    this.clearState = false;
    this.#startChunk();
  }

  #buildTopology() {
    const { solver } = this;
    const { linkA, linkB, linkCount, cellCount } = solver;
    const { start, entries } = cellAdjacency(linkA, linkB, cellCount);
    this.trackedLinks = Uint32Array.from(solver.tubeLinks);
    this.trackedCells = Uint32Array.from([
      ...solver.tubeCells[0],
      ...solver.tubeCells[1],
    ]);
    this.outputCount = solver.outputLinks.length;
    const sections = [
      linkA,
      linkB,
      start,
      entries,
      this.trackedLinks,
      this.trackedCells,
      solver.outputLinks,
    ];
    const offsets = [];
    let total = 0;
    for (const section of sections) {
      offsets.push(total);
      total += section.length;
    }
    this.topology = new Uint32Array(total);
    sections.forEach((section, index) =>
      this.topology.set(section, offsets[index])
    );
    this.offsets = offsets;
    this.linkCount = linkCount;
    this.cellCount = cellCount;
  }

  #startChunk() {
    this.segments = [];
    this.steps = new Words(2048);
    this.data = new Words(4096);
    this.stepCount = 0;
    // Every chunk opens with the coefficients of the current shape.
    this.version = -1;
    this.noiseVersion = -1;
  }

  /** The current tube coefficients, in the segment data layout. */
  #pushCoefficients() {
    const { solver, trackedLinks, trackedCells } = this;
    const count = trackedLinks.length;
    const offset = this.data.reserve(2 * count + trackedCells.length);
    const values = this.data.f32;
    for (let k = 0; k < count; k++) {
      values[offset + k] = solver.conductance[trackedLinks[k]];
      values[offset + count + k] = solver.damping[trackedLinks[k]];
    }
    const base = offset + 2 * count;
    for (let k = 0; k < trackedCells.length; k++) {
      const cell = trackedCells[k];
      const gain = solver.gain[cell];
      values[base + k] = solver.solid[cell] ? -gain : gain;
    }
    return offset;
  }

  #pushNoise() {
    const { solver, trackedLinks } = this;
    const signs = new Map();
    solver.noiseLinks.forEach((link, index) =>
      signs.set(link, solver.noiseSigns[index])
    );
    const offset = this.data.reserve(trackedLinks.length);
    for (let k = 0; k < trackedLinks.length; k++) {
      this.data.f32[offset + k] = signs.get(trackedLinks[k]) ?? 0;
    }
    return offset;
  }

  /**
   * Queue one step.
   * @param {number} force Noise force on the noise links (already scaled).
   * @param {number} inject Pressure added to the source cells (per keep).
   */
  queue(force, inject) {
    const { solver } = this;
    const coefficients = solver.version !== this.version;
    const noise = solver.noiseVersion !== this.noiseVersion;
    if (coefficients || noise || this.segments.length === 0) {
      let flags = 0;
      let offset = this.data.length;
      if (coefficients) {
        flags |= UPDATE_COEFFICIENTS;
        offset = this.#pushCoefficients();
      }
      if (noise) {
        flags |= UPDATE_NOISE;
        const noiseOffset = this.#pushNoise();
        if (!coefficients) {
          offset = noiseOffset;
        }
      }
      this.version = solver.version;
      this.noiseVersion = solver.noiseVersion;
      this.segments.push([this.stepCount, 0, offset, flags]);
    }
    this.segments.at(-1)[1]++;
    const at = this.steps.reserve(2);
    this.steps.f32[at] = force;
    this.steps.f32[at + 1] = inject;
    this.stepCount++;
  }

  /** Clear the pressure and velocity before the next chunk. */
  reset() {
    this.clearState = true;
  }

  #uploadStatic() {
    const { device, solver, buffers } = this;
    const { linkCount: L, cellCount: C } = this;
    device.queue.writeBuffer(buffers.topology, 0, this.topology);
    const links = new Float32Array(5 * L + this.outputCount);
    links.set(solver.velocity.subarray(0, L));
    links.set(solver.conductance.subarray(0, L), 2 * L);
    links.set(solver.damping.subarray(0, L), 3 * L);
    links.set(solver.outputSigns, 5 * L);
    device.queue.writeBuffer(buffers.links, 0, links);
    const cells = new Float32Array(5 * C);
    cells.set(solver.pressure.subarray(0, C));
    cells.set(solver.keep.subarray(0, C), C);
    cells.set(solver.gain.subarray(0, C), 2 * C);
    for (const index of solver.sourceCells) {
      cells[3 * C + index] = solver.keep[index];
    }
    device.queue.writeBuffer(buffers.cells, 0, cells);
    this.uploaded = true;
  }

  /** Grow a buffer (and drop the bind group) when `bytes` do not fit. */
  #ensure(name, bytes, usage) {
    const buffer = this.buffers[name];
    if (buffer && buffer.size >= bytes) {
      return buffer;
    }
    buffer?.destroy();
    this.buffers[name] = this.device.createBuffer({
      size: Math.max(256, 2 ** Math.ceil(Math.log2(bytes))),
      usage,
    });
    this.bindGroup = null;
    return this.buffers[name];
  }

  #chunkWords() {
    const segmentWords = SEGMENT_WORDS * this.segments.length;
    const stepBase = segmentWords;
    const dataBase = stepBase + this.steps.length;
    const words = new Uint32Array(dataBase + this.data.length);
    this.segments.forEach(([first, count, offset, flags], index) => {
      words.set(
        [first, count, dataBase + offset, flags],
        index * SEGMENT_WORDS
      );
    });
    words.set(this.steps.u32.subarray(0, this.steps.length), stepBase);
    words.set(this.data.u32.subarray(0, this.data.length), dataBase);
    return { words, stepBase };
  }

  #params(stepBase) {
    const { solver, offsets } = this;
    const params = new Uint32Array(PARAM_WORDS);
    const floats = new Float32Array(params.buffer);
    params.set([
      this.linkCount,
      this.cellCount,
      this.segments.length,
      stepBase,
      this.trackedLinks.length,
      this.trackedCells.length,
      this.outputCount,
      solver.output === 'microphone' ? solver.microphone : 0xffffffff,
      ...offsets.slice(1),
    ]);
    floats[14] = solver.courant;
    params[15] = solver.output === 'microphone' ? 0 : 1;
    return params;
  }

  #bindGroup() {
    const { buffers } = this;
    this.bindGroup ??= this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: ['params', 'topology', 'chunk', 'links', 'cells', 'out'].map(
        (name, binding) => ({ binding, resource: { buffer: buffers[name] } })
      ),
    });
    return this.bindGroup;
  }

  /**
   * Run the queued steps and read their outputs back. With `field`, the
   * solver's pressure array receives the RMS pressure of every cell over
   * these steps.
   * @param {{field?: boolean}} [options]
   * @returns {Promise<Float64Array>}
   */
  async flush(options = {}) {
    const count = this.stepCount;
    if (count === 0) {
      return new Float64Array(0);
    }
    const { device, solver } = this;
    if (!this.uploaded) {
      this.#uploadStatic();
    }
    const { words, stepBase } = this.#chunkWords();
    const chunk = this.#ensure('chunk', words.byteLength, STORAGE | COPY_DST);
    const outBytes = count * OUTPUT_PARTS * 4;
    const out = this.#ensure('out', outBytes, STORAGE | COPY_SRC | COPY_DST);
    const field = options.field ? 4 * this.cellCount : 0;
    const read = this.#ensure('read', outBytes + field, MAP_READ | COPY_DST);
    device.queue.writeBuffer(chunk, 0, words);
    device.queue.writeBuffer(this.buffers.params, 0, this.#params(stepBase));
    const encoder = device.createCommandEncoder();
    const { links, cells } = this.buffers;
    if (this.clearState) {
      encoder.clearBuffer(links, 0, 8 * this.linkCount);
      encoder.clearBuffer(cells, 0, 4 * this.cellCount);
      this.clearState = false;
    }
    encoder.clearBuffer(out, 0, outBytes);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.#bindGroup());
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(out, 0, read, 0, outBytes);
    // The squared pressure sums restart with every chunk.
    const squares = 16 * this.cellCount;
    if (field) {
      encoder.copyBufferToBuffer(cells, squares, read, outBytes, field);
    }
    encoder.clearBuffer(cells, squares, 4 * this.cellCount);
    device.queue.submit([encoder.finish()]);
    this.#startChunk();
    await read.mapAsync(MAP_READ, 0, outBytes + field);
    const mapped = new Float32Array(read.getMappedRange(0, outBytes + field));
    const scale =
      solver.output === 'microphone'
        ? solver.microphoneGain
        : solver.dx * solver.dx;
    const outputs = new Float64Array(count);
    for (let step = 0; step < count; step++) {
      let sum = 0;
      for (let part = 0; part < OUTPUT_PARTS; part++) {
        sum += mapped[step * OUTPUT_PARTS + part];
      }
      outputs[step] = sum * scale;
    }
    if (field) {
      const squares = mapped.subarray(count * OUTPUT_PARTS);
      for (let cell = 0; cell < this.cellCount; cell++) {
        solver.pressure[cell] = Math.sqrt(squares[cell] / count);
      }
    }
    read.unmap();
    return outputs;
  }

  destroy() {
    for (const buffer of Object.values(this.buffers)) {
      buffer?.destroy();
    }
  }
}
