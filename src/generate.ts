import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initialSolids } from "./geometry.ts";
import { defaults, renderSVG } from "./svg.ts";

const args = process.argv.slice(2);
const options = { ...defaults };
let out = "output";
const usage = `用法：npm run generate -- [选项]
  --out DIR       输出目录（默认 output）
  --seconds N     每次切割的秒数（默认 5）
  --hold N        每个端点停留秒数（默认 0.8，可为 0）
  --samples N     每秒几何采样数（默认 60）
  --size N        SVG 宽高像素（默认 640）
  --help          显示帮助
`;
try {
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") { console.log(usage); process.exit(0); }
    if (flag === "--out") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--out 需要目录参数");
      out = value;
    } else {
      const key = flag.slice(2) as keyof typeof options;
      if (!flag.startsWith("--") || !Object.hasOwn(options, key)) throw new Error(`未知选项：${flag}`);
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || (key === "hold" ? value < 0 : value <= 0)) throw new Error(`${flag} 参数无效`);
      if ((key === "samples" || key === "size") && !Number.isInteger(value)) throw new Error(`${flag} 需要正整数`);
      options[key] = value;
    }
  }
  const directory = resolve(out);
  await mkdir(directory, { recursive: true });
  for (const item of initialSolids()) {
    const file = resolve(directory, `${item.id}.svg`);
    await writeFile(file, renderSVG(item, options));
    console.log(`已生成 ${file}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
