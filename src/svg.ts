import { cross, dot, initialSolids, normalizedPoints, transition, unit } from "./geometry.ts";
import type { Stage, Vec } from "./geometry.ts";

export type Options = { seconds: number; hold: number; samples: number; size: number };
export const defaults: Options = { seconds: 5, hold: 0.8, samples: 60, size: 640 };
// This oblique view exposes at least two faces of both tetrahedron endpoints.
const view = unit([4, 1.5, 2]);
const right = unit(cross([0, 1, 0], view));
const up = cross(view, right);
const light = unit([-3, 5, 6]);
const fmt = (n: number): string => Number(n.toFixed(5)).toString();
const xml = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function path(points: Vec[], indices: number[]): string {
  return indices.map((i, n) => `${n ? "L" : "M"}${fmt(320 + 225 * dot(points[i], right))},${fmt(325 - 225 * dot(points[i], up))}`).join(" ") + " Z";
}

function visibility(start: number, end: number, duration: number): string {
  const times = [0], values = [start === 0 ? "visible" : "hidden"];
  if (start > 0) { times.push(start); values.push("visible"); }
  if (end < 1) { times.push(end); values.push("hidden"); }
  times.push(1); values.push(values[values.length - 1]);
  return `<animate attributeName="visibility" calcMode="discrete" values="${values.join(";")}" keyTimes="${times.map(fmt).join(";")}" dur="${fmt(duration)}s" repeatCount="indefinite"/>`;
}

function stageSVG(stage: Stage, half: number, first: boolean, hue: number, options: Options): string {
  const { hold, seconds, samples } = options;
  const halfDuration = hold + seconds, duration = 2 * halfDuration;
  const cutStart = (half * halfDuration + hold + seconds * stage.start) / duration;
  const cutEnd = (half * halfDuration + hold + seconds * stage.end) / duration;
  const visibleStart = stage.start === 0 ? half / 2 : cutStart;
  const count = Math.max(2, Math.ceil((stage.end - stage.start) * seconds * samples));
  const times = [0], frames = [normalizedPoints(stage, stage.start)];
  if (cutStart > 0) { times.push(cutStart); frames.push(frames[0]); }
  for (let i = 1; i <= count; i++) {
    const u = i / count;
    times.push(cutStart + (cutEnd - cutStart) * u);
    frames.push(normalizedPoints(stage, stage.start + (stage.end - stage.start) * u));
  }
  if (cutEnd < 1) { times.push(1); frames.push(frames[frames.length - 1]); }
  // For a convex solid in orthographic projection, outward faces pointing at
  // the viewer cover exactly the visible surface; rear faces are omitted.
  const faces = stage.faces.filter(f => dot(f.normal, view) > 1e-8);
  const paths = faces.map(f => {
    const brightness = 43 + 30 * Math.max(0, dot(f.normal, light));
    const ds = frames.map(points => path(points, f.vertices));
    return `<path d="${ds[0]}" fill="hsl(${hue},58%,${fmt(brightness)}%)"><animate attributeName="d" values="${ds.join(";")}" keyTimes="${times.map(fmt).join(";")}" calcMode="linear" dur="${fmt(duration)}s" repeatCount="indefinite"/></path>`;
  });
  return `<g visibility="${first ? "visible" : "hidden"}" stroke="#142c3a" stroke-width="1.25" stroke-linejoin="round">${visibility(visibleStart, cutEnd, duration)}\n${paths.join("\n")}\n</g>`;
}

export function renderSVG(item: ReturnType<typeof initialSolids>[number], options: Options): string {
  const forward = transition(item.solid);
  // Compute the return cut from new vertices, rather than reversing frames.
  const backward = transition(forward.target);
  const phases = [forward, backward].flatMap((tr, half) => tr.stages.map((stage, i) =>
    stageSVG(stage, half, half === 0 && i === 0, item.color, options)));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="0 0 640 640" role="img" aria-labelledby="title desc">
<title id="title">${xml(item.title)}</title>
<desc id="desc">所有顶点的切割平面同时等速向中心移动，到达对偶正多面体后重新切割。固定正交视角，外接球半径恒定。周期 ${fmt(2 * (options.seconds + options.hold))} 秒。</desc>
<rect width="640" height="640" rx="24" fill="#f5f8fb"/>
<g font-family="system-ui, sans-serif" text-anchor="middle" fill="#173145">
<text x="320" y="48" font-size="23" font-weight="600">${xml(item.title)}</text>
<text x="320" y="77" font-size="13" fill="#526a7c">DUALITY OF REGULAR POLYHEDRA</text>
</g>
${phases.join("\n")}
<g font-family="system-ui, sans-serif" text-anchor="middle" fill="#526a7c" font-size="14">
<text x="320" y="590">同步切割 · 固定外接球半径 · 正交投影</text>
<text x="320" y="615" font-size="12">${options.seconds} 秒 / 次变换 · 端点停留 ${options.hold} 秒</text>
</g>
</svg>
`;
}
