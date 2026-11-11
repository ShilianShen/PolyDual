import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cross, initialSolids, length, unit } from "./geometry.ts";
import type { Vec } from "./geometry.ts";

export type Options = {
  seconds: number; hold: number; samples: number; size: number;
  view: Vec; light: Vec; strokeWidth: number;
  colors: { mode: "auto" | "light" | "dark"; light: Palette; dark: Palette };
  rotation: { enabled: boolean; axis: Vec; turns: number };
};
type Palette = { fill: string; stroke: string };
const optionKeys = ["seconds", "hold", "samples", "size", "view", "light", "strokeWidth", "rotation", "colors"];

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} 是未知配置项`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} 必须是非空字符串`);
  return value;
}

function vector(value: unknown, path: string): Vec {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === "number" && Number.isFinite(n)) ||
      !Number.isFinite(Math.hypot(...value)) || Math.hypot(...value) < 1e-8) {
    throw new Error(`${path} 必须是包含三个有限数值的非零向量`);
  }
  return [...value] as Vec;
}

export function validateOptions(value: unknown, path: string): Options {
  const v = object(value, path);
  keys(v, optionKeys, path);
  for (const key of optionKeys) if (!Object.hasOwn(v, key)) throw new Error(`${path}.${key} 未配置`);
  for (const key of ["seconds", "hold", "samples", "size", "strokeWidth"]) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key])) throw new Error(`${path}.${key} 必须是有限数值`);
  }
  for (const key of ["seconds", "samples", "size"]) if ((v[key] as number) <= 0) throw new Error(`${path}.${key} 必须大于 0`);
  for (const key of ["hold", "strokeWidth"]) if ((v[key] as number) < 0) throw new Error(`${path}.${key} 不能小于 0`);
  for (const key of ["samples", "size"]) if (!Number.isSafeInteger(v[key])) throw new Error(`${path}.${key} 必须是正整数`);
  if (!Number.isFinite(2 * ((v.seconds as number) + (v.hold as number)))) throw new Error(`${path} 的动画周期过大`);
  const view = vector(v.view, `${path}.view`), light = vector(v.light, `${path}.light`);
  const rotation = object(v.rotation, `${path}.rotation`);
  keys(rotation, ["enabled", "axis", "turns"], `${path}.rotation`);
  if (typeof rotation.enabled !== "boolean") throw new Error(`${path}.rotation.enabled 必须是布尔值`);
  if (!Number.isSafeInteger(rotation.turns) || rotation.turns === 0) throw new Error(`${path}.rotation.turns 必须是非零整数，以保证循环衔接`);
  const axis = vector(rotation.axis, `${path}.rotation.axis`);
  if (length(cross([0, 1, 0], unit(view))) < 1e-8) throw new Error(`${path}.view 不能与竖直方向 [0, 1, 0] 平行`);
  const colors = object(v.colors, `${path}.colors`);
  keys(colors, ["mode", "light", "dark"], `${path}.colors`);
  if (!["auto", "light", "dark"].includes(colors.mode as string)) throw new Error(`${path}.colors.mode 必须是 auto、light 或 dark`);
  for (const theme of ["light", "dark"]) {
    const palette = object(colors[theme], `${path}.colors.${theme}`);
    keys(palette, ["fill", "stroke"], `${path}.colors.${theme}`);
    for (const key of ["fill", "stroke"]) {
      const color = string(palette[key], `${path}.colors.${theme}.${key}`);
      if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) throw new Error(`${path}.colors.${theme}.${key} 必须是 #RGB 或 #RRGGBB 十六进制颜色`);
    }
  }
  return { ...v, view, light, rotation: { enabled: rotation.enabled, axis, turns: rotation.turns as number } } as Options;
}

export function parseArgs(args: string[]) {
  const result: { config: string; out?: string; overrides: Partial<Options>; help: boolean } = {
    config: "polydual.config.json", overrides: {}, help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") { result.help = true; continue; }
    if (!["--config", "--out", "--seconds", "--hold", "--samples", "--size"].includes(flag)) throw new Error(`未知选项：${flag}`);
    const value = args[++i];
    if (!value?.trim() || value.startsWith("--")) throw new Error(`${flag} 需要参数`);
    if (flag === "--config") result.config = value;
    else if (flag === "--out") result.out = value;
    else {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${flag} 必须是有限数值`);
      result.overrides[flag.slice(2) as "seconds" | "hold" | "samples" | "size"] = n;
    }
  }
  return result;
}

function mergeOptions(base: Options, overrides: Record<string, unknown>, path: string): Record<string, unknown> {
  const colors = Object.hasOwn(overrides, "colors") ? object(overrides.colors, `${path}.colors`) : {};
  return {
    ...base, ...overrides,
    colors: {
      ...base.colors, ...colors,
      light: Object.hasOwn(colors, "light") ? { ...base.colors.light, ...object(colors.light, `${path}.colors.light`) } : base.colors.light,
      dark: Object.hasOwn(colors, "dark") ? { ...base.colors.dark, ...object(colors.dark, `${path}.colors.dark`) } : base.colors.dark,
    },
    rotation: Object.hasOwn(overrides, "rotation")
      ? { ...base.rotation, ...object(overrides.rotation, `${path}.rotation`) }
      : base.rotation,
  };
}

export async function loadConfig(file: string, overrides: Partial<Options> = {}, out?: string) {
  const absolute = resolve(file);
  let data: unknown;
  try { data = JSON.parse(await readFile(absolute, "utf8")); }
  catch (error) { throw new Error(`无法读取配置 ${absolute}：${error instanceof Error ? error.message : error}`); }
  const config = object(data, "config");
  keys(config, ["out", "defaults", "animations"], "config");
  const configuredOut = string(config.out, "config.out");
  const defaults = validateOptions(config.defaults, "defaults");
  const animations = object(config.animations, "animations");
  const solids = initialSolids();
  keys(animations, solids.map(s => s.id), "animations");
  const jobs = Object.entries(animations).flatMap(([id, raw]) => {
    const entry = object(raw, `animations.${id}`);
    keys(entry, ["enabled", ...optionKeys], `animations.${id}`);
    if (typeof entry.enabled !== "boolean") throw new Error(`animations.${id}.enabled 必须是布尔值`);
    const { enabled, ...local } = entry;
    // Validate file contents even when a CLI override or enabled=false would mask an error.
    const configured = validateOptions(mergeOptions(defaults, local, `animations.${id}`), `animations.${id}`);
    const options = validateOptions(mergeOptions(configured, overrides, `animations.${id}`), `animations.${id}`);
    return enabled ? [{ item: solids.find(s => s.id === id)!, options }] : [];
  });
  if (!jobs.length) throw new Error("animations 中至少需要启用一组动画");
  return { directory: out === undefined ? resolve(dirname(absolute), configuredOut) : resolve(out), jobs };
}
