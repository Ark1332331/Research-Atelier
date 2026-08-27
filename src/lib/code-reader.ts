/**
 * code-reader.ts —— 共享代码读取层（Step 3）
 * /api/code-read、Repo Analyzer、以后 Context Router 都调用它；禁止 route 间互相 HTTP 调自己。
 *
 * 职责：
 *  1. 文件允许规则：扩展名 / 无扩展名 basename / 模式 三种分开（Dockerfile、README、requirements*.txt 都能识别）。
 *  2. 安全边界：>1MB 跳过、secret denylist 绝不读正文、node_modules/.git/… 默认跳过；跳过原因记录（不静默消失）。
 *  3. repo revision：git commit/branch/url/dirty 落地（Facts/Mapping/Evidence 的版本锚点）。
 *  4. 确定性结构扫描 → Repository Snapshot 分类（candidate 语义，凭证据非文件名猜测）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/* ================= 1. 允许规则（三类分开） ================= */

export const ALLOWED_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".yaml", ".yml", ".toml", ".json", ".md", ".txt", ".sh", ".cfg", ".ini", ".csv",
]);

/** 无扩展名的可读文件（不是扩展名，不能塞进 extname 判断） */
export const ALLOWED_BASENAMES = new Set([
  "Dockerfile", "Makefile", "README", "LICENSE", "requirements", "environment",
]);

/** 通配模式（requirements-dev.txt、environment-prod.yaml、README.zh.md、Dockerfile.gpu 等） */
export const ALLOWED_PATTERNS: RegExp[] = [
  /^requirements.*\.(txt|in)$/i,
  /^environment.*\.ya?ml$/i,
  /^README.*$/i,
  /^Dockerfile.*$/i,
  /^LICENSE.*$/i,
  /^pyproject\.toml$/i,
  /^setup\.(py|cfg)$/i,
  /^package\.json$/i,
];

export function isAllowedFile(name: string): boolean {
  const base = path.basename(name);
  if (ALLOWED_EXTENSIONS.has(path.extname(base).toLowerCase())) return true;
  if (ALLOWED_BASENAMES.has(base)) return true;
  return ALLOWED_PATTERNS.some((re) => re.test(base));
}

/* ================= 2. 安全边界 ================= */

export const MAX_ANALYZABLE_FILE_BYTES = 1_000_000; // 1MB

/** 默认跳过目录（node_modules/.git/checkpoints/…） */
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "__pycache__", "dist", ".vercel",
  ".build-cache", ".cache", "release", "out", "checkpoints", "weights",
  "outputs", "wandb", "data", "datasets", "logs", "tmp", "build", "target",
]);

/** 敏感文件：绝不读取正文（无论是否允许类型） */
export const SECRET_DENYLIST: RegExp[] = [
  /^\.env$/i, /^\.env\..+$/i,
  /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /^credentials.*/i, /^id_rsa.*/i, /^id_ed25519.*/i,
  /^\.aws.*/i, /^\.ssh.*/i, /^\.npmrc$/i, /^\.netrc$/i,
];

export interface SkipReason { path: string; reason: "secret" | "too_large" | "skipped_dir" | "not_allowed" | "generated" }

/** 生成的锁文件/产物：即使扩展名允许也不分析（package-lock.json、yarn.lock、poetry.lock 等） */
const GENERATED_LOCK_RE = /^(package-lock\.json|yarn\.lock|poetry\.lock|uv\.lock|cargo\.lock|pipfile\.lock|pnpm-lock\.yaml)$/i;

/** 判断一个相对文件该不该读正文；返回 { read: true, abs } 或 { read: false, reason } */
export async function checkReadable(absPath: string, rel: string): Promise<{ read: true } | { read: false; reason: SkipReason["reason"] }> {
  const base = path.basename(absPath);
  if (SECRET_DENYLIST.some((re) => re.test(base))) return { read: false, reason: "secret" };
  if (GENERATED_LOCK_RE.test(base)) return { read: false, reason: "generated" };
  if (!isAllowedFile(base)) return { read: false, reason: "not_allowed" };
  try {
    const st = await fs.stat(absPath);
    if (st.size > MAX_ANALYZABLE_FILE_BYTES) return { read: false, reason: "too_large" };
  } catch {
    return { read: false, reason: "not_allowed" };
  }
  return { read: true };
}

/* ================= 3. repo revision ================= */

export interface RepoRevisionInfo {
  root: string;
  isGit: boolean;
  repoUrl?: string;
  commit?: string;
  branch?: string;
  dirty?: boolean;
}

export function getRepoRevision(root: string): RepoRevisionInfo {
  const info: RepoRevisionInfo = { root: path.resolve(root), isGit: false };
  const run = (args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
    } catch { return ""; }
  };
  if (!run(["rev-parse", "--is-inside-work-tree"])) return info;
  info.isGit = true;
  info.commit = run(["rev-parse", "HEAD"]) || undefined;
  info.branch = run(["rev-parse", "--abbrev-ref", "HEAD"]) || undefined;
  info.repoUrl = run(["remote", "get-url", "origin"]) || undefined;
  info.dirty = Boolean(run(["status", "--porcelain"]));
  return info;
}

/* ================= 4. 确定性结构扫描 → Snapshot 分类 ================= */

export interface SnapshotFile {
  path: string;           // 相对 root，/ 分隔
  lines: number;
  bytes: number;
  category: SnapshotCategory;
  candidate: boolean;     // 凭文件名/模式的 candidate，需证据确认（不凭文件名直接认定语义）
  evidence: string[];     // 内容证据：main()/训练调用/import/config 引用等
  commit?: string;        // 绑定 repo revision
}

export type SnapshotCategory =
  | "entrypoint" | "training" | "evaluation" | "datasets"
  | "configs" | "dependencies" | "checkpoints" | "scripts" | "docs" | "other";

const CATEGORY_RULES: { cat: SnapshotCategory; nameRe: RegExp }[] = [
  { cat: "dependencies", nameRe: /^requirements.*\.(txt|in)$|^environment.*\.ya?ml$|^pyproject\.toml$|^setup\.(py|cfg)$|^Dockerfile.*$|^package\.json$/i },
  { cat: "configs", nameRe: /config|\.yaml$|\.yml$|\.toml$|\.ini$|\.cfg$/i },
  { cat: "training", nameRe: /train|fit|learning/i },
  { cat: "evaluation", nameRe: /eval|test_|benchmark|metric/i },
  { cat: "datasets", nameRe: /dataset|data_loader|loader|dataloader|preprocess/i },
  { cat: "checkpoints", nameRe: /checkpoint|\.pt$|\.pth$|\.ckpt$|\.onnx$/i },
  { cat: "scripts", nameRe: /^scripts\/|\.sh$|\.mjs$/i },
  { cat: "entrypoint", nameRe: /^main\.|__main__|cli\.py$|app\.py$|launch/i },
  { cat: "docs", nameRe: /README|\.md$|\.txt$/i },
];

export function classifyFile(rel: string): { category: SnapshotCategory; candidate: boolean } {
  const base = path.basename(rel);
  for (const { cat, nameRe } of CATEGORY_RULES) {
    if (nameRe.test(base) || nameRe.test(rel)) return { category: cat, candidate: true };
  }
  return { category: "other", candidate: false };
}

/** 内容证据：确认 candidate 的语义（main()/训练函数调用/import 常见训练库） */
const EVIDENCE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "main()", re: /(?:if __name__\s*==\s*['"]__main__['"]|def main\s*\()/ },
  { label: "训练库", re: /(import torch|from torch|import tensorflow|from tensorflow|import pytorch_lightning|from pytorch_lightning|import lightning)/ },
  { label: "训练调用", re: /\.(fit|train)\(|trainer\.fit|model\.fit|optimizer\.step\(|loss\.backward\(/ },
  { label: "评估调用", re: /(eval\(|evaluate\(|accuracy|precision|recall|f1|confusion_matrix)/i },
  { label: "数据加载", re: /(DataLoader|Dataset|load_dataset|torchvision\.datasets|read_csv|np\.load|h5py)/ },
  { label: "config 引用", re: /(config|cfg|yaml|toml|argparse)/i },
];

export function contentEvidence(content: string): string[] {
  const found: string[] = [];
  for (const { label, re } of EVIDENCE_PATTERNS) {
    if (re.test(content.slice(0, 20000))) found.push(label);
  }
  return found;
}

/** 列出目录树（允许规则 + 跳过规则 + 大小），记录跳过原因 */
export async function scanTree(root: string): Promise<{ files: SnapshotFile[]; omitted: SkipReason[] }> {
  const files: SnapshotFile[] = [];
  const omitted: SkipReason[] = [];
  const commit = getRepoRevision(root).commit;

  async function walk(dir: string, base: string) {
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e);
      const rel = path.join(base, e).replace(/\\/g, "/");
      let st;
      try { st = await fs.stat(full); } catch { continue; }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e)) { omitted.push({ path: rel, reason: "skipped_dir" }); continue; }
        await walk(full, rel);
      } else if (st.isFile()) {
        const ck = await checkReadable(full, rel);
        if (!ck.read) { omitted.push({ path: rel, reason: ck.reason }); continue; }
        let content = "";
        try { content = await fs.readFile(full, "utf-8"); } catch { continue; }
        const { category, candidate } = classifyFile(rel);
        files.push({
          path: rel, lines: content.split("\n").length, bytes: st.size,
          category, candidate, evidence: contentEvidence(content), commit,
        });
      }
    }
  }
  await walk(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, omitted };
}

/** 组装 Repository Snapshot（只做结构事实，不做科学事实抽取——那是 Step 4） */
export async function buildRepositorySnapshot(root: string): Promise<Record<string, unknown>> {
  const revision = getRepoRevision(root);
  const { files, omitted } = await scanTree(root);

  const byCat = (c: SnapshotCategory) => files.filter((f) => f.category === c);
  const pick = (c: SnapshotCategory, n: number) => byCat(c).slice(0, n).map((f) => ({
    path: f.path, lines: f.lines, candidate: f.candidate, evidence: f.evidence, commit: f.commit,
  }));

  return {
    repoRevision: revision,
    entrypoints: pick("entrypoint", 20),
    training: pick("training", 30),
    evaluation: pick("evaluation", 30),
    datasets: pick("datasets", 30),
    configs: pick("configs", 40),
    dependencies: pick("dependencies", 20),
    checkpoints: pick("checkpoints", 20),
    scripts: pick("scripts", 30),
    docs: pick("docs", 20),
    otherCount: byCat("other").length,
    totalFiles: files.length,
    omitted,
  };
}
