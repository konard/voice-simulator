/** Bounded Nelder–Mead, with an external evaluation budget. Unlicense. */
const clamp = (x) => Math.max(0, Math.min(1, x));
export function* simplex(initial, evaluate, budget) {
  if (!initial.length || budget < 1) {
    return [];
  }
  const vertices = [];
  let used = 0;
  const run = function* (x) {
    if (used >= budget) {
      return null;
    }
    used++;
    const value = evaluate(x.map(clamp));
    yield value;
    return { x: x.map(clamp), ...value };
  };
  vertices.push(yield* run(initial));
  for (let i = 0; i < initial.length && used < budget; i++) {
    const x = [...initial];
    x[i] += x[i] < 0.5 ? 0.1 : -0.1;
    vertices.push(yield* run(x));
  }
  if (vertices.length < initial.length + 1) {
    return vertices;
  }
  while (used < budget) {
    vertices.sort((a, b) => a.cost - b.cost);
    if (vertices.at(-1).cost - vertices[0].cost < 0.01) {
      break;
    }
    const worst = vertices.at(-1),
      n = initial.length;
    const centre = initial.map(
      (_, i) => vertices.slice(0, n).reduce((s, v) => s + v.x[i], 0) / n
    );
    const point = (factor) =>
      centre.map((v, i) => clamp(v + factor * (v - worst.x[i])));
    const reflected = yield* run(point(1));
    if (reflected.cost < vertices[0].cost) {
      const expanded = yield* run(point(2));
      vertices[n] =
        expanded && expanded.cost < reflected.cost ? expanded : reflected;
    } else if (reflected.cost < vertices[n - 1].cost) {
      vertices[n] = reflected;
    } else {
      yield* contract(
        vertices,
        reflected,
        worst,
        point,
        run,
        () => used < budget
      );
    }
  }
  return vertices.sort((a, b) => a.cost - b.cost);
}

function* contract(vertices, reflected, worst, point, run, available) {
  const n = vertices.length - 1;
  const outside = reflected.cost < worst.cost;
  const contracted = yield* run(point(outside ? 0.5 : -0.5));
  if (contracted && contracted.cost < (outside ? reflected.cost : worst.cost)) {
    vertices[n] = contracted;
  } else if (contracted) {
    for (let i = 1; i < vertices.length && available(); i++) {
      vertices[i] = yield* run(
        vertices[0].x.map((v, j) => v + 0.5 * (vertices[i].x[j] - v))
      );
    }
  }
}
