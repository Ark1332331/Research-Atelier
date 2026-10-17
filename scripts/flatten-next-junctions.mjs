/**
 * Windows 打包前置处理：把 next build 在 .next/node_modules 里创建的
 * junction/symlink 替换为真实目录拷贝。
 *
 * 原因：electron-builder 在 Windows 上复制 symlink/junction 会因权限不足
 * （非管理员/未开开发者模式）报 EPERM。应用随包携带完整 node_modules，
 * 把别名目录做成真实拷贝对运行时行为无影响，只是体积略增。
 */
import { readdirSync, lstatSync, readlinkSync, rmdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), ".next", "node_modules");
if (!existsSync(dir)) {
  console.log("[flatten-next-junctions] .next/node_modules 不存在，跳过");
  process.exit(0);
}

let replaced = 0;
for (const name of readdirSync(dir)) {
  const p = path.join(dir, name);
  const st = lstatSync(p);
  if (st.isSymbolicLink()) {
    const target = readlinkSync(p);
    rmdirSync(p); // junction：只删链接本身，不动目标内容
    cpSync(path.resolve(dir, target), p, { recursive: true });
    replaced++;
    console.log(`[flatten-next-junctions] ${name} -> 真实目录拷贝`);
  }
}
console.log(`[flatten-next-junctions] 完成，替换 ${replaced} 个链接`);
