import assert from "node:assert/strict";
import { test } from "node:test";
import { initialSolids } from "../src/geometry.ts";
import { selectKeyframes, visibilityInWindow } from "../src/optimize.ts";
import { renderSVG } from "../src/svg.ts";
import { referenceOptions } from "./fixtures.ts";
import { attributes, numericValues } from "./svg-helpers.ts";

type Track = { times: number[]; values: number[][]; strings: string[]; discrete: boolean };
function track(element: string, name: string): Track {
  const attrs = [...element.matchAll(/<animate\b[^>]*\/>/g)].map(m => attributes(m[0])).find(a => a.attributeName === name);
  const strings = attrs ? attrs.values.split(";") : [attributes(element)[name], attributes(element)[name]];
  assert.ok(strings.every(v => v !== undefined), `Missing attribute ${name}`);
  return { times: attrs ? attrs.keyTimes.split(";").map(Number) : [0, 1], strings,
    values: strings.map(numericValues), discrete: !attrs || attrs.calcMode === "discrete" };
}
function at(tr: Track, time: number): { string: string; numbers: number[] } {
  const i = tr.times.findLastIndex(t => t <= time);
  if (tr.discrete || i === tr.times.length - 1) return { string: tr.strings[i], numbers: tr.values[i] };
  const u = (time - tr.times[i]) / (tr.times[i + 1] - tr.times[i]);
  return { string: "", numbers: tr.values[i].map((v, j) => v + (tr.values[i + 1][j] - v) * u) };
}
function groups(svg: string): string[] {
  return [...svg.matchAll(/<g display="[^>]*>.*?<\/g>/gs)].map(m => m[0]);
}
function paths(group: string): Map<string, string> {
  return new Map([...group.matchAll(/<path\b[^>]*>.*?<\/path>/gs)].map(m => [attributes(m[0]).id, m[0]]));
}
function uses(group: string): Map<string, string> {
  return new Map([...group.matchAll(/<use\b[^>]*>.*?<\/use>/gs)].map(m => [attributes(m[0]).href.slice(1), m[0]]));
}

test("optimization: window visibility ignores inactive phases and respects boundary events", () => {
  const tr = { times: [0, 0.2, 0.4, 1], values: ["hidden", "visible", "hidden", "hidden"] as const };
  const track = { times: tr.times, values: [...tr.values] };
  assert.equal(visibilityInWindow(track, 0, 0.2), "hidden");
  assert.equal(visibilityInWindow(track, 0.2, 0.4), "visible");
  assert.equal(visibilityInWindow(track, 0.1, 0.3), "mixed");
  assert.equal(visibilityInWindow(track, 0.4, 1), "hidden");
});

test("optimization: linear motion can drop redundant knots while retaining mandatory events", () => {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const positions = times.map(t => [[100 * t, -20 * t] as [number, number]]);
  assert.deepEqual(selectKeyframes(times, positions, [], [0, 0.5, 1]), [0, 2, 4]);
  assert.deepEqual(selectKeyframes(times, positions, [], [0, 1e-12, 1]), [0, 4]);
  assert.deepEqual(selectKeyframes(times, positions, [[0, 0, 1, 0, 0]], [0, 1]), [0, 1, 2, 3, 4]);
});

for (const item of initialSolids()) {
  test(`${item.id}: pruning preserves visibility, interpolation stays bounded, events and references survive`, () => {
    const variants = [
      referenceOptions,
      { ...referenceOptions, view: [4, -0.9, 2] as [number, number, number], rotation: { enabled: true, axis: [0.35, 1, -0.25] as [number, number, number], turns: 1 } },
      { ...referenceOptions, hold: 0, samples: 30, rotation: { enabled: true, axis: [1, 2, 3] as [number, number, number], turns: -1 } },
    ];
    for (const options of variants) {
      const baseline = renderSVG(item, options, false), optimized = renderSVG(item, options);
      assert.ok(Buffer.byteLength(optimized) < Buffer.byteLength(baseline) * 0.65);
      assert.ok([...optimized.matchAll(/<animate\b/g)].length < [...baseline.matchAll(/<animate\b/g)].length);
      const beforeGroups = groups(baseline), afterGroups = groups(optimized);
      assert.equal(beforeGroups.length, afterGroups.length);
      for (let i = 0; i < beforeGroups.length; i++) {
        const before = beforeGroups[i], after = afterGroups[i];
        const display = track(before, "display"), afterDisplay = track(after, "display");
        assert.deepEqual(afterDisplay, display);
        const start = display.times.find((_, n) => display.strings[n] === "inline")!;
        const end = display.times.find((t, n) => t > start && display.strings[n] === "none") ?? 1;
        const oldPaths = paths(before), newPaths = paths(after), oldUses = uses(before), newUses = uses(after);
        for (const id of newPaths.keys()) assert.ok(oldPaths.has(id));
        for (const id of newUses.keys()) assert.ok(newPaths.has(id), `Dangling shading reference ${id}`);
        for (const [id, path] of oldPaths) {
          const originalVisibility = track(path, "visibility");
          const replacement = newPaths.get(id);
          const replacementVisibility = replacement ? track(replacement, "visibility") : undefined;
          const events = [...new Set([start, end, ...originalVisibility.times, ...(replacementVisibility?.times ?? [])])]
            .filter(t => t >= start && t <= end).sort((a, b) => a - b);
          for (let n = 1; n < events.length; n++) {
            const t = (events[n - 1] + events[n]) / 2;
            assert.equal(replacementVisibility ? at(replacementVisibility, t).string : "hidden", at(originalVisibility, t).string);
          }
          if (!replacement) { assert.ok(!newUses.has(id)); continue; }
          const originalD = track(path, "d"), reducedD = track(replacement, "d");
          for (const t of [start, end, ...originalVisibility.times]) {
            if (t < start || t > end) continue;
            assert.ok(reducedD.times.some(k => Math.abs(k - t) < 1e-12), `Dropped silhouette or stage event at ${t}`);
          }
          assert.ok(reducedD.strings.every(v => (v.match(/\d+\.(\d+)/g) ?? []).every(n => n.split(".")[1].length <= 2)));
          for (const t of originalD.times.filter(t => t >= start && t <= end)) {
            const a = at(originalD, t).numbers, b = at(reducedD, t).numbers;
            assert.equal(a.length, b.length);
            for (let n = 0; n < a.length; n += 2) assert.ok(Math.hypot(a[n] - b[n], a[n + 1] - b[n + 1]) < 0.05, `Path error ${id} at ${t}`);
          }
          if (oldUses.has(id)) {
            assert.ok(newUses.has(id));
            const originalOpacity = track(oldUses.get(id)!, "opacity"), reducedOpacity = track(newUses.get(id)!, "opacity");
            for (const t of originalOpacity.times) {
              assert.ok(Math.abs(at(originalOpacity, t).numbers[0] - at(reducedOpacity, t).numbers[0]) <= 0.002 + 1e-12);
            }
          }
        }
      }
    }
  });
}
