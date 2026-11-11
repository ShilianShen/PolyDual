export type Vec = [number, number, number];
export type Face = { normal: Vec; distance: number; vertices: number[] };
export type Solid = { vertices: Vec[]; faces: Face[] };
type Plane = { normal: Vec; start: number; delta: number };
export type MovingVertex = { start: Vec; delta: Vec };
export type Stage = {
  start: number;
  end: number;
  vertices: MovingVertex[];
  faces: { normal: Vec; vertices: number[] }[];
};
export type Transition = { source: Solid; target: Solid; stop: number; stages: Stage[] };
const EPS = 1e-8;

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k, v[2] * k];
export const sub = (a: Vec, b: Vec): Vec => add(a, scale(b, -1));
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
export const length = (v: Vec): number => Math.hypot(...v);
export const unit = (v: Vec): Vec => scale(v, 1 / length(v));
export const position = (v: MovingVertex, t: number): Vec => add(v.start, scale(v.delta, t));

// Order a convex face counterclockwise about its outward normal.
function orderFace(indices: number[], vertices: Vec[], normal: Vec): number[] {
  const center = scale(indices.reduce((s, i) => add(s, vertices[i]), [0, 0, 0] as Vec), 1 / indices.length);
  const u = unit(sub(vertices[indices[0]], center));
  const v = cross(normal, u);
  return indices.sort((i, j) => {
    const a = sub(vertices[i], center), b = sub(vertices[j], center);
    return Math.atan2(dot(a, v), dot(a, u)) - Math.atan2(dot(b, v), dot(b, u));
  });
}

// Small convex hull: enumerate supporting planes, merging coplanar triangles.
export function hull(vertices: Vec[]): Solid {
  const faces: Face[] = [];
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      for (let k = j + 1; k < vertices.length; k++) {
        const raw = cross(sub(vertices[j], vertices[i]), sub(vertices[k], vertices[i]));
        if (length(raw) < EPS) continue;
        let normal = unit(raw), distance = dot(normal, vertices[i]);
        if (distance < 0) { normal = scale(normal, -1); distance = -distance; }
        if (vertices.some(v => dot(normal, v) > distance + EPS)) continue;
        if (faces.some(f => length(sub(f.normal, normal)) < EPS)) continue;
        const indices = vertices.flatMap((v, n) => Math.abs(dot(normal, v) - distance) < EPS ? [n] : []);
        faces.push({ normal, distance, vertices: orderFace(indices, vertices, normal) });
      }
    }
  }
  if (faces.length < 4) throw new Error("Cannot construct a three-dimensional convex hull");
  return { vertices, faces };
}

export function initialSolids(): { id: string; title: string; color: number; solid: Solid }[] {
  const tetra: Vec[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const cube: Vec[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z]);
  const phi = (1 + Math.sqrt(5)) / 2;
  const dodeca: Vec[] = [...cube];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    dodeca.push([0, a / phi, b * phi], [a / phi, b * phi, 0], [b * phi, 0, a / phi]);
  }
  return [
    { id: "tetrahedron", title: "正四面体 ↔ 对偶正四面体", color: 163, vertices: tetra },
    { id: "cube-octahedron", title: "立方体 ↔ 正八面体", color: 209, vertices: cube },
    { id: "dodecahedron-icosahedron", title: "正十二面体 ↔ 正二十面体", color: 33, vertices: dodeca },
  ].map(({ vertices, ...meta }) => ({ ...meta, solid: hull(vertices.map(unit)) }));
}

function intersection(a: Vec, b: Vec, c: Vec, distances: Vec): Vec | null {
  const det = dot(a, cross(b, c));
  if (Math.abs(det) < EPS) return null;
  return scale(add(add(scale(cross(b, c), distances[0]), scale(cross(c, a), distances[1])),
    scale(cross(a, b), distances[2])), 1 / det);
}

export function transition(source: Solid): Transition {
  const h = source.faces[0].distance;
  if (source.faces.some(f => Math.abs(f.distance - h) > EPS) ||
      source.vertices.some(v => Math.abs(length(v) - 1) > EPS)) {
    throw new Error("Expected a centered regular solid with unit circumradius");
  }
  // The unit dual vertices are source face normals. At the first dual endpoint
  // their raw radius is h, so each cutting-plane distance is exactly h².
  const stop = h * h;
  const target = hull(source.faces.map(f => f.normal));
  const planes: Plane[] = [
    ...source.faces.map(f => ({ normal: f.normal, start: f.distance, delta: 0 })),
    ...source.vertices.map(v => ({ normal: v, start: 1, delta: stop - 1 })),
  ];
  const candidates: (MovingVertex & { lo: number; hi: number })[] = [];
  const breaks = [0, 1];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
    for (let k = j + 1; k < planes.length; k++) {
      const [a, b, c] = [planes[i], planes[j], planes[k]];
      const start = intersection(a.normal, b.normal, c.normal, [a.start, b.start, c.start]);
      if (!start) continue;
      const delta = intersection(a.normal, b.normal, c.normal, [a.delta, b.delta, c.delta])!;
      let lo = 0, hi = 1;
      for (const p of planes) {
        const intercept = dot(p.normal, start) - p.start;
        const slope = dot(p.normal, delta) - p.delta;
        if (Math.abs(slope) < EPS) {
          if (intercept > EPS) { hi = -1; break; }
        } else if (slope > 0) hi = Math.min(hi, -intercept / slope);
        else lo = Math.max(lo, -intercept / slope);
      }
      if (hi - lo > EPS) {
        candidates.push({ start, delta, lo, hi });
        breaks.push(lo, hi);
      }
    }
  }
  const times = breaks.sort((a, b) => a - b).filter((t, i, ts) => i === 0 || t - ts[i - 1] > EPS);
  times[0] = 0; times[times.length - 1] = 1;
  const stages: Stage[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i], end = times[i + 1], mid = (start + end) / 2;
    const vertices: MovingVertex[] = [];
    for (const c of candidates) {
      if (mid < c.lo || mid > c.hi) continue;
      if (!vertices.some(v => length(sub(position(v, mid), position(c, mid))) < EPS)) vertices.push(c);
    }
    const points = vertices.map(v => position(v, mid));
    const faces = planes.flatMap(p => {
      const indices = points.flatMap((v, n) => Math.abs(dot(p.normal, v) - p.start - p.delta * mid) < EPS ? [n] : []);
      return indices.length < 3 ? [] : [{ normal: p.normal, vertices: orderFace(indices, points, p.normal) }];
    });
    stages.push({ start, end, vertices, faces });
  }
  if (!stages.length) throw new Error("No feasible cutting stages");
  return { source, target, stop, stages };
}

export function normalizedPoints(stage: Stage, t: number): Vec[] {
  const points = stage.vertices.map(v => position(v, t));
  const radius = Math.max(...points.map(length));
  return points.map(v => scale(v, 1 / radius));
}
