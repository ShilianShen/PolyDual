import { add, cross, dot, scale, sub, unit } from "./geometry.ts";
import type { Vec } from "./geometry.ts";
import type { Options } from "./config.ts";

type Rotation = Options["rotation"];

/** Apply easing once per complete cut, in the solid's local coordinates. */
export function cutProgress(time: number, easing: Options["cutEasing"]): number {
  const t = Math.max(0, Math.min(1, time));
  if (easing === "linear") return t;
  return t * t * t * (10 + t * (-15 + 6 * t));
}

/** Map geometric topology boundaries back to clock time; do not ease each stage. */
export function cutTime(progress: number, easing: Options["cutEasing"]): number {
  const target = Math.max(0, Math.min(1, progress));
  if (easing === "linear" || target === 0 || target === 1) return target;
  let lo = 0, hi = 1;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (cutProgress(mid, easing) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Rodrigues' formula: rotate in world coordinates about an axis through the center.
export function rotate(v: Vec, rotation: Rotation, progress: number): Vec {
  if (!rotation.enabled) return v;
  const axis = unit(rotation.axis);
  const angle = 2 * Math.PI * rotation.turns * (progress % 1);
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

// Solve dot(R(t) normal, view) = C + A cos(theta) + B sin(theta) = 0.
// These exact silhouette times prevent sampling from delaying face visibility.
export function silhouetteTimes(normal: Vec, view: Vec, rotation: Rotation): number[] {
  if (!rotation.enabled) return [];
  const axis = unit(rotation.axis);
  const parallel = scale(axis, dot(axis, normal));
  const a = dot(sub(normal, parallel), view);
  const b = dot(cross(axis, normal), view);
  const c = dot(parallel, view);
  const radius = Math.hypot(a, b);
  if (radius < 1e-12 || Math.abs(c) > radius + 1e-12) return [];
  const phase = Math.atan2(b, a), offset = Math.acos(Math.max(-1, Math.min(1, -c / radius)));
  const total = 2 * Math.PI * rotation.turns;
  const min = Math.min(0, total), max = Math.max(0, total);
  const roots: number[] = [];
  for (const base of [phase - offset, phase + offset]) {
    for (let k = Math.ceil((min - base) / (2 * Math.PI)); k <= Math.floor((max - base) / (2 * Math.PI)); k++) {
      const t = (base + 2 * Math.PI * k) / total;
      if (t > 0 && t < 1) roots.push(t);
    }
  }
  return uniqueTimes(roots);
}

export function uniqueTimes(times: number[]): number[] {
  const result: number[] = [];
  for (const t of times.sort((a, b) => a - b)) {
    if (!result.length || t - result[result.length - 1] > 1e-12) result.push(t);
    // Retain the exact SMIL endpoint when a silhouette lies almost at t=1.
    else if (t === 1) result[result.length - 1] = 1;
  }
  return result;
}
