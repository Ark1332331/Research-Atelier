#!/usr/bin/env node
/**
 * 死代码检查：从框架入口 BFS import 图，列出不可达源文件。
 * 根 = src/app 约定文件 + instrumentation + tests + package.json scripts 引用的脚本
 * 白名单 = 被 spawn 的工具与手动维护脚本（不在 import 图里）
 * 用法：node scripts/check-dead-code.cjs   （发现死文件时 exit 1）
 */
const fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src", "scripts"];
const WHITELIST = new Set([
  "scripts/check-dead-code.cjs",
  "scripts/extract-pdf.mjs",
  "scripts/flatten-next-junctions.mjs",
  "scripts/gen-runtime-config.mjs",
  "scripts/migrate-v1.mjs",
  "scripts/py_chain.py",
  "scripts/translate-full.mjs",
]);

const files = [];
function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const name of fs.readdirSync(abs)) {
    const p = path.join(abs, name);
    const rel = path.relative(ROOT, p).split(path.sep).join("/");
    if (fs.statSync(p).isDirectory()) {
      if (name === "frozen") continue; // 归档目录不参与分析
      walk(rel);
    } else if (/\.(tsx|ts|mjs|cjs)$/.test(name)) files.push(rel);
  }
}
SCAN_DIRS.forEach(walk);

const norm = (p) => p.split(path.sep).join("/");
function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".") && !spec.startsWith("./pnpm")) base = path.join(ROOT, path.dirname(from), spec);
  else return null;
  const candidates = [
    base, base + ".ts", base + ".tsx", base + ".mjs", base + ".cjs", base + ".js",
    path.join(base, "index.ts"), path.join(base, "index.tsx"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return norm(path.relative(ROOT, c));
  return null;
}

const isAppEntry = (f) =>
  f.startsWith("src/app/") && /(page|route|layout|error|loading|template|not-found|default)\.(ts|tsx)$/.test(f);
const roots = files.filter((f) =>
  isAppEntry(f) || f === "src/instrumentation.ts" || f.startsWith("tests/")
);

// package.json scripts 中引用的本仓库脚本也是根
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
for (const cmd of Object.values(pkg.scripts ?? {})) {
  for (const m of cmd.matchAll(/(?:^|[\s&;])(?:node\s+)?(?:\.\/)?(scripts\/[\w./-]+\.(?:mjs|cjs|ts|py))/g)) {
    const rel = norm(m[1]);
    if (files.includes(rel) && !roots.includes(rel)) roots.push(rel);
  }
}

const IMPORT_RE = /(?:from\s+|import\s*\(?\s*|require\s*\(?\s*)['"]([^'"]+)['"]/g;
const reachable = new Set(roots);
const queue = [...roots];
while (queue.length) {
  const f = queue.pop();
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
  let m;
  const re = new RegExp(IMPORT_RE.source, "g");
  while ((m = re.exec(src))) {
    const r = resolveSpec(f, m[1]);
    if (r && !reachable.has(r)) { reachable.add(r); queue.push(r); }
  }
}

const dead = files.filter((f) => !reachable.has(f) && !WHITELIST.has(f));
if (dead.length) {
  console.error("DEAD FILES (" + dead.length + "):");
  dead.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("OK: no dead files (checked " + files.length + ")");
