import { cross, dot, initialSolids, normalizedPoints, stageEdges, transition, unit } from "./geometry.ts";
import type { Stage, Vec } from "./geometry.ts";
import type { Options } from "./config.ts";
import { rotate, silhouetteTimes, uniqueTimes } from "./motion.ts";
import { constantValue, selectKeyframes, visibilityInWindow } from "./optimize.ts";
import type { Point, VisibilityTrack } from "./optimize.ts";

const fmt = (n: number): string => Number(n.toFixed(5)).toString();
const xml = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function path(points: Point[], indices: number[], digits: number, closed: boolean): string {
  const coordinate = (n: number) => Number(n.toFixed(digits)).toString();
  return indices.map((i, n) => `${n ? "L" : "M"}${coordinate(points[i][0])},${coordinate(points[i][1])}`).join(" ") + (closed ? " Z" : "");
}

function display(start: number, end: number, duration: number): string {
  const times = [0], values = [start === 0 ? "inline" : "none"];
  if (start > 0) { times.push(start); values.push("inline"); }
  if (end < 1) { times.push(end); values.push("none"); }
  times.push(1); values.push(values[values.length - 1]);
  return animation("display", values, times, duration, "discrete");
}

function animation(attribute: string, values: string[], times: number[], duration: number, mode = "linear"): string {
  return `<animate attributeName="${attribute}" values="${values.join(";")}" keyTimes="${times.join(";")}" calcMode="${mode}" begin="0s" dur="${duration}s" repeatCount="indefinite"/>`;
}

function facing(normal: Vec, view: Vec, options: Options): VisibilityTrack {
  const times = uniqueTimes([0, ...silhouetteTimes(normal, view, options.rotation), 1]);
  const values = times.map((t, i) => {
    const mid = i < times.length - 1 ? (t + times[i + 1]) / 2 : (times[i - 1] + t) / 2;
    return dot(rotate(normal, options.rotation, mid), view) > 1e-10 ? "visible" : "hidden";
  });
  return { times, values };
}

function hiddenFacing(normals: Vec[], view: Vec, options: Options): VisibilityTrack {
  const times = uniqueTimes([0, ...normals.flatMap(n => silhouetteTimes(n, view, options.rotation)), 1]);
  const values = times.map((t, i) => {
    const mid = i < times.length - 1 ? (t + times[i + 1]) / 2 : (times[i - 1] + t) / 2;
    // In a convex solid, an edge is occluded only if both incident faces
    // point away from the viewer. Silhouette edges remain solid.
    return normals.every(n => dot(rotate(n, options.rotation, mid), view) < -1e-10) ? "visible" : "hidden";
  });
  return { times, values };
}

function stageSVG(stage: Stage, half: number, first: boolean, options: Options, prefix: string, optimize: boolean): string {
  const { hold, seconds, samples } = options;
  const view = unit(options.view), light = unit(options.light);
  const right = unit(cross([0, 1, 0], view)), up = cross(view, right);
  const halfDuration = hold + seconds, duration = 2 * halfDuration;
  const cutStart = (half * halfDuration + hold + seconds * stage.start) / duration;
  const cutEnd = (half * halfDuration + hold + seconds * stage.end) / duration;
  const visibleStart = stage.start === 0 ? half / 2 : cutStart;
  // Include endpoint holds in sampling: cutting pauses, but rotation continues.
  const count = Math.max(2, Math.ceil((cutEnd - visibleStart) * duration * samples));
  if (cutEnd <= cutStart || !Number.isSafeInteger(count)) {
    throw new Error("切割时长、端点停留时长或采样数的比例过于极端，无法生成有效时间序列");
  }
  const activeTimes = [visibleStart, cutStart, cutEnd];
  for (let i = 1; i < count; i++) activeTimes.push(visibleStart + (cutEnd - visibleStart) * i / count);
  const mandatory = [0, visibleStart, cutStart, cutEnd, 1];
  for (const face of stage.faces) mandatory.push(...silhouetteTimes(face.normal, view, options.rotation).filter(t => t > visibleStart && t < cutEnd));
  activeTimes.push(...mandatory);
  const times = uniqueTimes([0, ...activeTimes, 1]);
  if (times.some((t, i) => i > 0 && t <= times[i - 1])) {
    throw new Error("切割时长、端点停留时长或采样数的比例过于极端，无法生成有效时间序列");
  }
  const frames = times.map(time => {
    const t = Math.max(visibleStart, Math.min(cutEnd, time));
    const progress = Math.max(stage.start, Math.min(stage.end, (t * duration - half * halfDuration - hold) / seconds));
    return normalizedPoints(stage, progress).map(v => rotate(v, options.rotation, t));
  });
  const positions = frames.map(points => points.map((p): Point => [320 + 225 * dot(p, right), 320 - 225 * dot(p, up)]));
  const faces = stage.faces.flatMap((face, faceIndex) => {
    const visibility = facing(face.normal, view, options);
    const state = visibilityInWindow(visibility, visibleStart, cutEnd);
    if (optimize && state === "hidden") return [];
    const shades = times.map(time => {
      const t = Math.max(visibleStart, Math.min(cutEnd, time));
      return Number(fmt(0.1 + 0.35 * (1 - Math.max(0, dot(rotate(face.normal, options.rotation, t), light)))));
    });
    return [{ face, faceIndex, visibility, state, shades }];
  });
  const hidden = options.hiddenEdges;
  const edges = hidden.enabled ? stageEdges(stage).flatMap((edge, edgeIndex) => {
    const visibility = hiddenFacing(edge.faces.map(i => stage.faces[i].normal), view, options);
    const state = visibilityInWindow(visibility, visibleStart, cutEnd);
    return optimize && state === "hidden" ? [] : [{ edge, edgeIndex, visibility, state }];
  }) : [];
  const indices = optimize ? selectKeyframes(times, positions, faces.map(f => f.shades), mandatory) : times.map((_, i) => i);
  const selectedTimes = indices.map(i => times[i]);
  const selectedPositions = indices.map(i => positions[i]);
  const visibilitySVG = (track: VisibilityTrack, state: string) => optimize && state === "visible"
    ? { initial: "visible", animation: "" }
    : { initial: track.values[0], animation: animation("visibility", track.values, track.times, duration, "discrete") };
  const paths = faces.map(({ face: f, faceIndex, visibility: track, state, shades }) => {
    const ds = selectedPositions.map(points => path(points, f.vertices, optimize ? 2 : 5, true));
    const visibility = visibilitySVG(track, state);
    const id = `${prefix}-face-${faceIndex}`;
    // Color belongs to a solid's faces, so the same face keeps its color when
    // it becomes an original face in the next half of the cycle.
    const dual = (half === 0 && f.kind === "cut") || (half === 1 && f.kind === "original");
    // Inherited fill lets the base path use the theme color while its instance
    // supplies a black lighting layer. Both share the same animated geometry.
    const opacity = optimize && constantValue(shades) !== undefined ? "" : animation("opacity", indices.map(i => shades[i].toString()), selectedTimes, duration);
    return `<path d="${ds[0]}" id="${id}" class="polydual-${dual ? "dual" : "primary"}" visibility="${visibility.initial}">${animation("d", ds, selectedTimes, duration)}${visibility.animation}</path><use href="#${id}" fill="#000" stroke="none" opacity="${shades[0]}">${opacity}</use>`;
  });
  const hiddenPaths = edges.map(({ edge, edgeIndex, visibility: track, state }) => {
    const ds = selectedPositions.map(points => path(points, edge.vertices, optimize ? 2 : 5, false));
    const visibility = visibilitySVG(track, state);
    return `<path class="polydual-hidden-edge" id="${prefix}-edge-${edgeIndex}" d="${ds[0]}" fill="none" stroke-dasharray="${hidden.dash.join(" ")}" stroke-width="${hidden.width}" opacity="${hidden.opacity}" visibility="${visibility.initial}">${animation("d", ds, selectedTimes, duration)}${visibility.animation}</path>`;
  });
  // display:none suppresses descendants even if their own visibility is visible.
  return `<g display="${first ? "inline" : "none"}" class="polydual-mesh" fill="currentColor" stroke-width="${options.strokeWidth}" stroke-linejoin="round">${display(visibleStart, cutEnd, duration)}\n${paths.join("\n")}\n${hiddenPaths.join("\n")}\n</g>`;
}

// The unoptimized mode is retained for regression comparisons, not CLI playback.
export function renderSVG(item: ReturnType<typeof initialSolids>[number], options: Options, optimize = true): string {
  const forward = transition(item.solid);
  // Compute the return cut from new vertices, rather than reversing frames.
  const backward = transition(forward.target);
  const phases = [forward, backward].flatMap((tr, half) => tr.stages.map((stage, i) =>
    stageSVG(stage, half, half === 0 && i === 0, options, `${item.id}-${half}-${i}`, optimize)));
  const selector = `.polydual-${item.id} .polydual-mesh`;
  const rule = (theme: "light" | "dark") => `${selector}{color:${options.colors[theme].fill};stroke:${options.colors[theme].stroke}}.polydual-${item.id} .polydual-dual{color:${options.colors[theme].dualFill}}`;
  const styles = options.colors.mode === "auto"
    ? `${rule("light")}\n@media (prefers-color-scheme: dark){${rule("dark")}}`
    : rule(options.colors.mode);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" class="polydual-${item.id}" width="${options.size}" height="${options.size}" viewBox="0 0 640 640" role="img" aria-labelledby="title desc">
<title id="title">${xml(item.title)}</title>
<desc id="desc">所有顶点的切割平面同时等速向中心移动，到达对偶正多面体后重新切割。相机采用固定正交视角，${options.rotation.enabled ? `物体每周期绕轴 [${options.rotation.axis.join(", ")}] 旋转 ${options.rotation.turns} 圈，` : ""}外接球半径恒定。周期 ${fmt(2 * (options.seconds + options.hold))} 秒。</desc>
<style>${styles}</style>
${phases.join("\n")}
</svg>
`;
}
