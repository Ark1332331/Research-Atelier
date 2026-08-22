#!/usr/bin/env node
/**
 * 生成 electron/runtime-config.json（打包时执行，机器相关路径不写死进 main.js）：
 *   defaultCodeRoot = 本机项目根（workflow-app 的上级，即 allinone/，内含 reproduction/）
 * Electron 主进程首次启动时按此重算「代码导读」默认根并写入 data/code-roots.json。
 * 用法：node scripts/gen-runtime-config.mjs （在 workflow-app 目录下运行）
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // <project>/scripts
const projectDir = path.resolve(here, "..");
const defaultCodeRoot = path.resolve(projectDir, "..");

const out = path.join(projectDir, "electron", "runtime-config.json");
writeFileSync(out, JSON.stringify({
  defaultCodeRoot,
  generatedAt: new Date().toISOString(),
}, null, 2));
console.log(`[runtime-config] defaultCodeRoot=${defaultCodeRoot}\n[runtime-config] 写入 ${out}`);
