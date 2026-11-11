import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig, parseArgs } from "../src/config.ts";
import { initialSolids } from "../src/geometry.ts";
import { renderSVG } from "../src/svg.ts";
import { referenceConfig, referenceOptions } from "./fixtures.ts";

async function temporary(t: TestContext) {
  const dir = await mkdtemp(resolve(tmpdir(), "polydual-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("config: common settings, animation overrides, CLI precedence and path bases", async t => {
  const dir = await temporary(t), file = resolve(dir, "settings.json");
  const config = referenceConfig();
  config.defaults.seconds = 6;
  Object.assign(config.animations.tetrahedron, { seconds: 8, view: [3, 2, 4], rotation: { enabled: true }, hiddenEdges: { opacity: 0.3 }, colors: { dark: { fill: "#ffcc00" } } });
  config.animations["dodecahedron-icosahedron"].enabled = false;
  await writeFile(file, JSON.stringify(config));
  const loaded = await loadConfig(file);
  assert.equal(loaded.directory, resolve(dir, "output"));
  assert.deepEqual(loaded.jobs.map(j => j.item.id), ["tetrahedron", "cube-octahedron"]);
  assert.equal(loaded.jobs[0].options.seconds, 8);
  assert.equal(loaded.jobs[1].options.seconds, 6);
  assert.deepEqual(loaded.jobs[0].options.view, [3, 2, 4]);
  assert.deepEqual(loaded.jobs[1].options.view, config.defaults.view);
  assert.deepEqual(loaded.jobs[0].options.rotation, { enabled: true, axis: [0, 1, 0], turns: 1 });
  assert.deepEqual(loaded.jobs[0].options.hiddenEdges, { ...config.defaults.hiddenEdges, opacity: 0.3 });
  assert.equal(loaded.jobs[0].options.colors.dark.fill, "#ffcc00");
  assert.equal(loaded.jobs[0].options.colors.dark.stroke, config.defaults.colors.dark.stroke);
  assert.equal(loaded.jobs[0].options.colors.dark.dualFill, config.defaults.colors.dark.dualFill);
  assert.deepEqual(loaded.jobs[0].options.colors.light, config.defaults.colors.light);
  const cli = await loadConfig(file, { seconds: 9, size: 800 }, "relative-cli-output");
  assert.equal(cli.directory, resolve("relative-cli-output"));
  assert.ok(cli.jobs.every(j => j.options.seconds === 9 && j.options.size === 800));
});

test("config: missing, malformed and invalid settings fail clearly", async t => {
  const dir = await temporary(t), file = resolve(dir, "settings.json");
  await assert.rejects(loadConfig(file), /无法读取配置/);
  await writeFile(file, "{");
  await assert.rejects(loadConfig(file), /无法读取配置/);
  const invalid: [string, (c: any) => void, RegExp][] = [
    ["required field", c => delete c.defaults.seconds, /defaults.seconds 未配置/],
    ["unknown default", c => c.defaults.secods = 5, /secods 是未知配置项/],
    ["unknown animation", c => c.animations.cube = { enabled: true }, /animations.cube 是未知配置项/],
    ["enabled type", c => c.animations.tetrahedron.enabled = "yes", /enabled 必须是布尔值/],
    ["no enabled jobs", c => Object.values(c.animations).forEach((v: any) => v.enabled = false), /至少需要启用/],
    ["negative time", c => c.defaults.seconds = -1, /seconds 必须大于 0/],
    ["fractional samples", c => c.defaults.samples = 2.5, /samples 必须是正整数/],
    ["zero view", c => c.defaults.view = [0, 0, 0], /非零向量/],
    ["parallel view", c => c.defaults.view = [0, 2, 0], /不能与竖直方向/],
    ["zero light", c => c.defaults.light = [0, 0, 0], /非零向量/],
    ["bad color", c => c.defaults.colors.light.fill = "url(remote.svg)", /十六进制颜色/],
    ["missing dual color", c => delete c.defaults.colors.dark.dualFill, /colors.dark.dualFill/],
    ["bad dual color", c => c.defaults.colors.light.dualFill = "invalid", /十六进制颜色/],
    ["bad disabled entry", c => Object.assign(c.animations.tetrahedron, { enabled: false, colors: { dark: { fill: "invalid" } } }), /十六进制颜色/],
    ["bad theme mode", c => c.defaults.colors.mode = "automatic", /mode 必须是/],
    ["missing dark palette", c => delete c.defaults.colors.dark, /colors.dark 必须是对象/],
    ["unknown palette key", c => c.defaults.colors.light.fil = "#fff", /fil 是未知配置项/],
    ["invalid default masked by override", c => c.defaults.seconds = "5", /seconds 必须是有限数值/],
    ["zero rotation axis", c => c.defaults.rotation.axis = [0, 0, 0], /rotation.axis.*非零向量/],
    ["nonclosing rotation", c => c.defaults.rotation.turns = 0.5, /turns 必须是非零整数/],
    ["unknown rotation field", c => c.defaults.rotation.speed = 1, /speed 是未知配置项/],
    ["rotation flag type", c => c.defaults.rotation.enabled = "yes", /rotation.enabled 必须是布尔值/],
    ["invalid dash length", c => c.defaults.hiddenEdges.dash = [0, 4], /hiddenEdges.dash/],
    ["invalid edge opacity", c => c.defaults.hiddenEdges.opacity = 1.1, /hiddenEdges.opacity/],
    ["invalid edge width", c => c.defaults.hiddenEdges.width = -1, /hiddenEdges.width/],
    ["invalid edge flag", c => c.defaults.hiddenEdges.enabled = "yes", /hiddenEdges.enabled/],
    ["unknown edge field", c => c.defaults.hiddenEdges.typo = 1, /typo 是未知配置项/],
  ];
  for (const [name, mutate, pattern] of invalid) {
    const c = referenceConfig(); mutate(c);
    await writeFile(file, JSON.stringify(c));
    await assert.rejects(loadConfig(file, { seconds: 10 }), pattern, name);
  }
});

test("CLI: argument values and unknown options are checked", () => {
  assert.deepEqual(parseArgs(["--config", "other.json", "--hold", "0", "--size", "800"]), {
    config: "other.json", overrides: { hold: 0, size: 800 }, help: false,
  });
  assert.throws(() => parseArgs(["--config"]), /需要参数/);
  assert.throws(() => parseArgs(["--size", "NaN"]), /有限数值/);
  assert.throws(() => parseArgs(["--typo", "5"]), /未知选项/);
});

test("config: custom view, lighting and styling reach the generated SVG", () => {
  const item = initialSolids()[0];
  const baseline = renderSVG(item, referenceOptions);
  const styled = renderSVG(item, {
    ...referenceOptions, size: 800, view: [3, 2, 4], light: [3, -5, -6],
    colors: { ...referenceOptions.colors, mode: "dark", dark: { fill: "#e07be0", dualFill: "#ffcc00", stroke: "#abc" } }, strokeWidth: 2,
  });
  assert.match(styled, /width="800" height="800"/);
  assert.doesNotMatch(styled, /<rect\b|<text\b|<foreignObject\b/);
  assert.match(styled, /color:#e07be0;stroke:#abc/);
  assert.match(styled, /polydual-dual\{color:#ffcc00\}/);
  assert.match(styled, /stroke-width="2"/);
  assert.doesNotMatch(styled, /prefers-color-scheme/);
  assert.notEqual(styled.match(/<path d="([^"]*)"/)![1], baseline.match(/<path d="([^"]*)"/)![1]);
  const relit = renderSVG(item, { ...referenceOptions, light: [3, -5, -6] });
  const shading = (svg: string) => [...svg.matchAll(/attributeName="opacity" values="([^"]*)"/g)].map(m => m[1]);
  assert.notDeepEqual(shading(relit), shading(baseline));
});

test("SVG: auto colors follow media preference, forced themes use their configured palettes", () => {
  const item = initialSolids()[0];
  const auto = renderSVG(item, referenceOptions);
  assert.match(auto, /@media \(prefers-color-scheme: dark\)/);
  assert.match(auto, /color:#7db8e0;stroke:#243746/);
  assert.match(auto, /color:#91cbf2;stroke:#d6e8f5/);
  assert.match(auto, /fill="currentColor"/);
  for (const mode of ["light", "dark"] as const) {
    const svg = renderSVG(item, { ...referenceOptions, colors: { ...referenceOptions.colors, mode } });
    assert.doesNotMatch(svg, /@media/);
    assert.ok(svg.includes(`color:${referenceOptions.colors[mode].fill};stroke:${referenceOptions.colors[mode].stroke}`));
    assert.ok(svg.includes(`.polydual-dual{color:${referenceOptions.colors[mode].dualFill}}`));
  }
});

test("CLI: custom config generates only enabled files and rejects invalid config before output", async t => {
  const dir = await temporary(t), file = resolve(dir, "settings.json");
  const c = referenceConfig();
  c.defaults.samples = 2;
  c.animations["cube-octahedron"].enabled = false;
  c.animations["dodecahedron-icosahedron"].enabled = false;
  await writeFile(file, JSON.stringify(c));
  const entry = fileURLToPath(new URL("../src/generate.ts", import.meta.url));
  const result = spawnSync(process.execPath, [entry, "--config", file, "--seconds", "2", "--size", "800"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(resolve(dir, "output")), ["tetrahedron.svg"]);
  const svg = await readFile(resolve(dir, "output/tetrahedron.svg"), "utf8");
  assert.match(svg, /width="800"/);
  assert.match(svg, /dur="5.6s"/);
  c.defaults.view = [0, 0, 0]; c.out = "must-not-exist";
  await writeFile(file, JSON.stringify(c));
  const bad = spawnSync(process.execPath, [entry, "--config", file], { cwd: dir, encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /defaults.view/);
  await assert.rejects(readdir(resolve(dir, "must-not-exist")), { code: "ENOENT" });
});
