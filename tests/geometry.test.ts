import assert from "node:assert/strict";
import { test } from "node:test";
import { dot, initialSolids, length, normalizedPoints, position, scale, sub, transition } from "../src/geometry.ts";
import type { Solid, Vec } from "../src/geometry.ts";
import { renderSVG } from "../src/svg.ts";
import { referenceOptions as defaults } from "./fixtures.ts";

function samePoints(a: Vec[], b: Vec[], tolerance = 1e-7): void {
  for (const v of a) assert.ok(b.some(w => length(sub(v, w)) < tolerance), `Missing vertex ${v}`);
  for (const v of b) assert.ok(a.some(w => length(sub(v, w)) < tolerance), `Unexpected vertex ${v}`);
}

function checkRegular(solid: Solid, vertices: number, faces: number): void {
  assert.equal(solid.vertices.length, vertices);
  assert.equal(solid.faces.length, faces);
  const edges = new Map<string, number>();
  const lengths: number[] = [];
  for (const face of solid.faces) {
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      const key = [a, b].sort((x, y) => x - y).join(",");
      edges.set(key, (edges.get(key) ?? 0) + 1);
      lengths.push(length(sub(solid.vertices[a], solid.vertices[b])));
    }
  }
  assert.ok([...edges.values()].every(n => n === 2));
  assert.equal(vertices - edges.size + faces, 2);
  assert.ok(Math.max(...lengths) - Math.min(...lengths) < 1e-7, "All edges must have the same length");
}

const expected = [[4, 4], [8, 6], [20, 12]];
for (const [index, item] of initialSolids().entries()) {
  test(`${item.id}: regular endpoints, genuine return cut, seamless cycle`, () => {
    const [v, f] = expected[index];
    checkRegular(item.solid, v, f);
    const forward = transition(item.solid), backward = transition(forward.target);
    checkRegular(forward.target, f, v);
    checkRegular(backward.target, v, f);
    samePoints(backward.target.vertices, item.solid.vertices);
    for (const tr of [forward, backward]) {
      samePoints(normalizedPoints(tr.stages[0], 0), tr.source.vertices);
      samePoints(normalizedPoints(tr.stages.at(-1)!, 1), tr.target.vertices);
      for (let i = 1; i < tr.stages.length; i++) {
        const t = tr.stages[i].start;
        samePoints(normalizedPoints(tr.stages[i - 1], t), normalizedPoints(tr.stages[i], t));
      }
    }
  });

  test(`${item.id}: cutting halfspaces, face planarity, constant radius and interpolation error`, () => {
    const forward = transition(item.solid);
    for (const tr of [forward, transition(forward.target)]) {
      for (const stage of tr.stages) {
        for (let k = 0; k <= 20; k++) {
          const t = stage.start + (stage.end - stage.start) * k / 20;
          const raw = stage.vertices.map(v => position(v, t));
          for (const p of raw) {
            for (const f of tr.source.faces) assert.ok(dot(f.normal, p) <= f.distance + 1e-7);
            for (const n of tr.source.vertices) assert.ok(dot(n, p) <= 1 + (tr.stop - 1) * t + 1e-7);
          }
          for (const f of stage.faces) {
            const distances = f.vertices.map(i => dot(f.normal, raw[i]));
            assert.ok(Math.max(...distances) - Math.min(...distances) < 1e-7);
          }
          assert.ok(Math.abs(Math.max(...normalizedPoints(stage, t).map(length)) - 1) < 1e-12);
        }
        // SMIL linearly interpolates sampled projected coordinates. Bound the
        // underlying 3D midpoint error at the default sampling rate (< 0.03 px).
        const count = Math.ceil((stage.end - stage.start) * defaults.seconds * defaults.samples);
        for (let i = 0; i < count; i++) {
          const a = stage.start + (stage.end - stage.start) * i / count;
          const b = stage.start + (stage.end - stage.start) * (i + 1) / count;
          const pa = normalizedPoints(stage, a), pb = normalizedPoints(stage, b);
          const exact = normalizedPoints(stage, (a + b) / 2);
          for (let j = 0; j < exact.length; j++) {
            const interpolated = scale([pa[j][0] + pb[j][0], pa[j][1] + pb[j][1], pa[j][2] + pb[j][2]], 0.5);
            assert.ok(length(sub(exact[j], interpolated)) * 225 < 0.03);
          }
        }
      }
    }
  });

  test(`${item.id}: SMIL paths have matching commands and strictly increasing key times`, () => {
    for (const options of [defaults, { ...defaults, hold: 0 }, { ...defaults, rotation: { ...defaults.rotation, enabled: true } }]) {
      const svg = renderSVG(item, options);
      assert.ok(!svg.includes("NaN") && !svg.includes("Infinity") && !svg.includes("<script"));
      for (const match of svg.matchAll(/<animate\b([^>]+)\/>/g)) {
        const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        const times = attrs.keyTimes.split(";").map(Number);
        const values = attrs.values.split(";");
        assert.equal(times.length, values.length);
        assert.equal(times[0], 0); assert.equal(times.at(-1), 1);
        assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]));
        if (attrs.attributeName === "d") {
          const signature = values[0].replace(/[^MLZ]/g, "");
          assert.ok(values.every(v => v.replace(/[^MLZ]/g, "") === signature));
        }
      }
    }
  });
}
