import { add, cross, dot, scale, sub, unit } from "./geometry.ts";
import type { Vec } from "./geometry.ts";
import type { Options } from "./config.ts";

type Rotation = Options["rotation"];

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
