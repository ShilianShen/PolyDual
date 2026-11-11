export type Point = [number, number];
export type Visibility = "visible" | "hidden";
export type VisibilityTrack = { times: number[]; values: Visibility[] };

// Errors are measured in the internal 640 × 640 canvas. Coordinate rounding
// adds at most sqrt(2) * 0.005, keeping the total below 0.05 canvas pixels.
export const POSITION_ERROR = 0.04;
export const OPACITY_ERROR = 0.002;

export function constantValue(values: number[]): number | undefined {
  return values.every(v => v === values[0]) ? values[0] : undefined;
}

/** Classify only the interval in which the parent stage is displayed. */
export function visibilityInWindow(track: VisibilityTrack, start: number, end: number): Visibility | "mixed" {
  const states = new Set<Visibility>();
  for (let i = 0; i < track.times.length - 1; i++) {
    if (Math.max(start, track.times[i]) < Math.min(end, track.times[i + 1])) states.add(track.values[i]);
  }
  if (!states.size) throw new Error("Empty stage visibility interval");
  return states.size === 1 ? [...states][0] : "mixed";
}

/**
 * Simplify the shared, piecewise-linear trajectory using a maximum error bound
 * across every vertex and opacity track. Testing every original knot bounds
 * the whole interpolation interval, not just its midpoint. Mandatory times
 * retain holds, stage boundaries, and exact silhouette events.
 */
export function selectKeyframes(times: number[], positions: Point[][], opacities: number[][], mandatory: number[]): number[] {
  const keep = new Set([0, times.length - 1]);
  for (const time of mandatory) {
    const index = times.findIndex(t => Math.abs(t - time) <= 1e-12);
    if (index < 0) throw new Error("Mandatory animation event is missing from the sample grid");
    keep.add(index);
  }
  const initial = [...keep].sort((a, b) => a - b);
  const pending = initial.slice(1).map((end, i) => [initial[i], end] as const);
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let worst = 1, split = -1;
    for (let i = start + 1; i < end; i++) {
      const u = (times[i] - times[start]) / (times[end] - times[start]);
      let error = 0;
      for (let v = 0; v < positions[i].length; v++) {
        const a = positions[start][v], b = positions[end][v], p = positions[i][v];
        error = Math.max(error, Math.hypot(p[0] - a[0] - u * (b[0] - a[0]), p[1] - a[1] - u * (b[1] - a[1])) / POSITION_ERROR);
      }
      for (const opacity of opacities) {
        error = Math.max(error, Math.abs(opacity[i] - opacity[start] - u * (opacity[end] - opacity[start])) / OPACITY_ERROR);
      }
      if (error > worst) { worst = error; split = i; }
    }
    if (split >= 0) {
      keep.add(split);
      pending.push([start, split], [split, end]);
    }
  }
  return [...keep].sort((a, b) => a - b);
}
