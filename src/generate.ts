import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig, parseArgs } from "./config.ts";
import { renderSVG } from "./svg.ts";

const usage = `用法：npm run generate -- [选项]
  --config FILE   配置文件（默认当前目录的 polydual.config.json）
  --out DIR       覆盖输出目录，相对于当前工作目录
  --seconds N     覆盖每次切割的秒数
  --hold N        覆盖每个端点停留秒数，可为 0
  --samples N     覆盖每秒几何采样数
  --size N        覆盖 SVG 宽高像素
  --help          显示帮助
`;
try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); process.exit(0); }
  const { directory, jobs } = await loadConfig(args.config, args.overrides, args.out);
  const outputs = jobs.map(({ item, options }) => ({ file: resolve(directory, `${item.id}.svg`), svg: renderSVG(item, options) }));
  await mkdir(directory, { recursive: true });
  for (const { file, svg } of outputs) {
    await writeFile(file, svg);
    console.log(`已生成 ${file}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
