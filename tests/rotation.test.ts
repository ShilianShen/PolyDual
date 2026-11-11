import assert from "node:assert/strict";
import { test } from "node:test";
import { cross, dot, initialSolids, length, normalizedPoints, sub, transition, unit } from "../src/geometry.ts";
import type { Vec } from "../src/geometry.ts";
import { rotate, silhouetteTimes, uniqueTimes } from "../src/motion.ts";
import { renderSVG } from "../src/svg.ts";
import { referenceOptions } from "./fixtures.ts";

test("rotation: right-handed direction, rigid distances, disabled state and closed loops", () => {
  const rotation = { enabled: true, axis: [0, 1, 0] as Vec, turns: 1 };
  assert.ok(length(sub(rotate([1, 0, 0], rotation, 0.25), [0, 0, -1])) < 1e-12);
  for (const axis of [[0, 1, 0], [1, 2, 3]] as Vec[]) for (const turns of [-2, -1, 1, 2]) {
    const settings = { ...rotation, axis, turns };
    const a: Vec = [0.2, 0.3, 0.7], b: Vec = [-0.1, 0.8, -0.4];
    for (const t of [0, 0.1, 0.5, 0.9, 1]) {
      const ra = rotate(a, settings, t), rb = rotate(b, settings, t);
      assert.ok(Math.abs(length(ra) - length(a)) < 1e-12);
      assert.ok(Math.abs(length(sub(ra, rb)) - length(sub(a, b))) < 1e-12);
    }
    assert.deepEqual(rotate(a, settings, 0), rotate(a, settings, 1));
    assert.deepEqual(rotate(a, { ...settings, enabled: false }, 0.3), a);
  }
});

test("rotation: silhouette events locate front/back changes for either direction", () => {
  assert.deepEqual(uniqueTimes([0, 1e-15, 1 - 1e-15, 1]), [0, 1]);
  const view = unit(referenceOptions.view);
  for (const turns of [-2, -1, 1, 2]) {
    const rotation = { enabled: true, axis: [0, 1, 0] as Vec, turns };
    const normal = unit([1, 0.2, 0.3]);
    const roots = silhouetteTimes(normal, view, rotation);
    assert.equal(roots.length, 2 * Math.abs(turns));
    for (const t of roots) {
      assert.ok(Math.abs(dot(rotate(normal, rotation, t), view)) < 1e-12);
      assert.ok(dot(rotate(normal, rotation, t - 1e-6), view) * dot(rotate(normal, rotation, t + 1e-6), view) < 0);
    }
  }
});

function track(markup: string, attribute: string, t: number): string {
  const tags = [...markup.matchAll(/<animate\b([^>]+)\/>/g)];
  const attrs = tags.map(tag => Object.fromEntries([...tag[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])))
    .find(a => a.attributeName === attribute)!;
  const times = attrs.keyTimes.split(";").map(Number), values = attrs.values.split(";");
  const i = times.findLastIndex(time => time <= t);
  if (attrs.calcMode === "discrete" || i === times.length - 1) return values[i];
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  const numbers = (value: string) => (value.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) ?? []).map(Number);
  const a = numbers(values[i]), b = numbers(values[i + 1]);
  return a.map((v, j) => v + (b[j] - v) * u).join(",");
}

for (const item of initialSolids()) {
  test(`${item.id}: rotating SVG projects the cut, updates lighting and hides back faces`, () => {
    const options = { ...referenceOptions, rotation: { enabled: true, axis: [0, 1, 0] as Vec, turns: 1 } };
    const svg = renderSVG(item, options);
    const groups = [...svg.matchAll(/<g display="[^>]*>(.*?)<\/g>/gs)].map(m => m[1]);
    const forward = transition(item.solid), backward = transition(forward.target);
    const stages = [forward, backward].flatMap((tr, half) => tr.stages.map(stage => ({ stage, half })));
    const duration = 2 * (options.seconds + options.hold);
    const view = unit(options.view), right = unit(cross([0, 1, 0], view)), up = cross(view, right);
    for (const t of [0, 0.03, 0.13, 0.23, 0.35, 0.46, 0.5, 0.53, 0.64, 0.79, 0.93, 0.99999]) {
      const active = groups.flatMap((g, i) => track(g, "display", t) === "inline" ? [i] : []);
      assert.equal(active.length, 1, `Exactly one cut stage should show at t=${t}`);
      const i = active[0], { stage, half } = stages[i];
      const progress = Math.max(stage.start, Math.min(stage.end, (t * duration - half * duration / 2 - options.hold) / options.seconds));
      const points = normalizedPoints(stage, progress).map(p => rotate(p, options.rotation, t));
      const paths = [...groups[i].matchAll(/<path\b[^>]*>(.*?)<\/path>/gs)].map(m => m[1]);
      let visible = 0;
      paths.forEach((path, faceIndex) => {
        const face = stage.faces[faceIndex];
        const facing = dot(rotate(face.normal, options.rotation, t), view);
        if (Math.abs(facing) > 1e-7) assert.equal(track(path, "visibility", t), facing > 0 ? "visible" : "hidden");
        if (track(path, "visibility", t) === "visible") visible++;
        const expected = face.vertices.flatMap(n => [320 + 225 * dot(points[n], right), 320 - 225 * dot(points[n], up)]);
        const actual = track(path, "d", t).split(",").map(Number);
        assert.equal(actual.length, expected.length);
        assert.ok(actual.every((v, n) => Math.abs(v - expected[n]) < 0.05), `Projected geometry at t=${t}`);
      });
      assert.ok(visible > 0);
    }
    const firstPaths = [...groups[0].matchAll(/<path\b[^>]*>(.*?)<\/path>/gs)].map(m => m[1]);
    const firstPath = firstPaths[0];
    assert.notEqual(track(firstPath, "d", 0), track(firstPath, "d", options.hold / duration / 2), "Rotation continues during a cutting hold");
    const shades = [...groups[0].matchAll(/<use\b[^>]*>(.*?)<\/use>/gs)].map(m => m[1]);
    assert.ok(shades.some(p => track(p, "opacity", 0) !== track(p, "opacity", 0.1)), "World-fixed light changes face brightness");
  });
}
