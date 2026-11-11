import assert from "node:assert/strict";
import { test } from "node:test";
import { cutProgress, cutTime } from "../src/motion.ts";
import { initialSolids, transition } from "../src/geometry.ts";
import { renderSVG } from "../src/svg.ts";
import { referenceOptions } from "./fixtures.ts";
import { attributes, numericValues } from "./svg-helpers.ts";

test("cut easing: monotone progress, unchanged endpoints, and inverse topology timing", () => {
  for (const easing of ["linear", "smootherstep"] as const) {
    assert.equal(cutProgress(-1, easing), 0);
    assert.equal(cutProgress(2, easing), 1);
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000, progress = cutProgress(t, easing);
      assert.ok(progress >= previous);
      assert.ok(Math.abs(cutTime(progress, easing) - t) < 1e-9);
      previous = progress;
    }
    for (const item of initialSolids()) {
      const forward = transition(item.solid);
      for (const tr of [forward, transition(forward.target)]) for (const stage of tr.stages) {
        for (const p of [stage.start, stage.end]) assert.ok(Math.abs(cutProgress(cutTime(p, easing), easing) - p) < 1e-12);
      }
    }
  }
});

test("cut easing: quintic profile starts and stops with zero velocity and acceleration", () => {
  const e = 1e-4, f = (t: number) => cutProgress(t, "smootherstep");
  assert.ok(f(e) / e < 1e-6);
  assert.ok((1 - f(1 - e)) / e < 1e-6);
  assert.ok(Math.abs((f(2 * e) - 2 * f(e) + f(0)) / (e * e)) < 0.01);
  assert.ok(Math.abs((f(1) - 2 * f(1 - e) + f(1 - 2 * e)) / (e * e)) < 0.01);
  assert.equal(f(0.5), 0.5);
  assert.ok(f(0.1) < 0.1 && f(0.9) > 0.9);
  assert.ok(Math.abs((f(0.5 + e) - f(0.5 - e)) / (2 * e) - 1.875) < 1e-6);
});

test("cut easing: topology groups meet at inverse-eased times without a second slowdown", () => {
  for (const item of initialSolids()) {
    const options = referenceOptions, duration = 2 * (options.seconds + options.hold);
    const forward = transition(item.solid), backward = transition(forward.target);
    const stages = [forward, backward].flatMap((tr, half) => tr.stages.map(stage => ({ stage, half })));
    const svg = renderSVG(item, options);
    const groups = [...svg.matchAll(/<g display="[^>]*>.*?<\/g>/gs)].map(m => m[0]);
    let previousEnd = 0;
    groups.forEach((group, i) => {
      const { stage, half } = stages[i];
      const display = [...group.matchAll(/<animate\b[^>]*\/>/g)].map(m => attributes(m[0])).find(a => a.attributeName === "display")!;
      const times = display.keyTimes.split(";").map(Number), values = display.values.split(";");
      const start = times.find((_, n) => values[n] === "inline")!;
      const end = times.find((t, n) => t > start && values[n] === "none") ?? 1;
      assert.equal(start, previousEnd);
      assert.ok(Math.abs(end - (half * duration / 2 + options.hold + options.seconds * cutTime(stage.end, options.cutEasing)) / duration) < 1e-12);
      previousEnd = end;
    });
    assert.equal(previousEnd, 1);
  }
});

test("cut easing: emitted paths also move slowly on the first and last cutting intervals", () => {
  const options = referenceOptions, duration = 2 * (options.seconds + options.hold), cutStart = options.hold / duration;
  const svg = renderSVG(initialSolids()[1], options);
  const groups = [...svg.matchAll(/<g display="[^>]*>.*?<\/g>/gs)].map(m => m[0]);
  let peak = 0, first = 0, last = 0;
  groups.forEach((group, g) => {
    for (const tag of group.matchAll(/<animate\b[^>]*\/>/g)) {
      const a = attributes(tag[0]); if (a.attributeName !== "d") continue;
      const times = a.keyTimes.split(";").map(Number), points = a.values.split(";").map(numericValues);
      for (let i = 1; i < times.length; i++) for (let j = 0; j < points[i].length; j += 2) {
        const speed = Math.hypot(points[i][j] - points[i - 1][j], points[i][j + 1] - points[i - 1][j + 1]) / ((times[i] - times[i - 1]) * duration);
        peak = Math.max(peak, speed);
        if (g === 0 && Math.abs(times[i - 1] - cutStart) < 1e-12) first = Math.max(first, speed);
        if (g === groups.length - 1 && times[i] === 1) last = Math.max(last, speed);
      }
    }
  });
  assert.ok(peak > 0);
  assert.ok(first < peak * 0.15 && last < peak * 0.15);
});
