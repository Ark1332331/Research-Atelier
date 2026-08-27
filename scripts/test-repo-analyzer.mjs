/**
 * Step 3 验收测试：code-reader.ts 共享层 + Repo Analyzer v1。
 * 运行：node scripts/test-repo-analyzer.mjs   （Node ≥ 22.6 直接跑 TS）
 * 覆盖：允许规则三类、安全边界（>1MB/secret/目录跳过 + 原因记录）、repo revision、
 *       Repository Snapshot 结构、两个真实 repo（Research Atelier + IsaacLab）。
 */
import { isAllowedFile, MAX_ANALYZABLE_FILE_BYTES, scanTree, getRepoRevision, classifyFile, buildRepositorySnapshot, contentEvidence } from "../src/lib/code-reader.ts";
import { promises as fs } from "node:fs";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. 允许规则：扩展名 / basename / 模式 三类 ==");
ok(isAllowedFile("train.py"), "扩展名 .py");
ok(isAllowedFile("config.yaml") && isAllowedFile("README.md") && isAllowedFile("notes.txt"), "扩展名 yaml/md/txt");
ok(isAllowedFile("Dockerfile"), "basename 无扩展名 Dockerfile");
ok(isAllowedFile("Makefile") && isAllowedFile("README"), "basename Makefile/README");
ok(isAllowedFile("requirements-dev.txt"), "模式 requirements*.txt");
ok(isAllowedFile("environment.yaml") && isAllowedFile("environment-prod.yml"), "模式 environment*.yml");
ok(isAllowedFile("Dockerfile.gpu"), "模式 Dockerfile*");
ok(!isAllowedFile("random.bin"), "未知二进制不允许");
ok(!isAllowedFile(".env"), "无扩展名 .env 不满足允许规则（secret 读取层另行拦截）");

console.log("== 2. 分类（candidate 语义，非文件名直接认定） ==");
const t = classifyFile("src/train.py");
ok(t.category === "training" && t.candidate === true, "train.py → training candidate");
const c = classifyFile("configs/base.yaml");
ok(c.category === "configs", "configs/base.yaml → configs");
const e = classifyFile("eval/metrics.py");
ok(e.category === "evaluation", "eval/metrics.py → evaluation");
ok(contentEvidence("import torch\nif __name__ == '__main__':\n  trainer.fit(model)").includes("训练调用"), "内容证据：训练调用");
ok(contentEvidence("import torch").includes("训练库"), "内容证据：训练库 import");

console.log("== 3. repo revision（workflow-app 是 git 仓库） ==");
const rev = getRepoRevision("/media/ark/Data/devpy/projects/allinone/workflow-app");
ok(rev.isGit === true, "isGit=true");
ok(typeof rev.commit === "string" && rev.commit.length >= 7, `commit=${rev.commit?.slice(0, 8)}`);
ok(rev.branch === "main" || typeof rev.branch === "string", `branch=${rev.branch}`);
ok(rev.repoUrl && rev.repoUrl.includes("github.com"), `repoUrl=${rev.repoUrl}`);
ok(typeof rev.dirty === "boolean", "dirty boolean");

console.log("== 4. 安全边界：omitted 记录原因 ==");
const tmp = await mkdtemp(path.join(os.tmpdir(), "ra-analyzer-"));
await mkdir(path.join(tmp, "node_modules/pkg"), { recursive: true });
await mkdir(path.join(tmp, "checkpoints"), { recursive: true });
await writeFile(path.join(tmp, ".env"), "SECRET=leak", "utf-8");
await writeFile(path.join(tmp, "big.json"), "x".repeat(MAX_ANALYZABLE_FILE_BYTES + 10), "utf-8");
await writeFile(path.join(tmp, "node_modules/pkg/index.js"), "console.log(1)", "utf-8");
await writeFile(path.join(tmp, "checkpoints/model.pt"), "binary", "utf-8");
await writeFile(path.join(tmp, "train.py"), "import torch\ndef main(): pass", "utf-8");
await writeFile(path.join(tmp, "credentials.yml"), "aws: secret", "utf-8");
await writeFile(path.join(tmp, "README.md"), "# t", "utf-8");
await writeFile(path.join(tmp, "package-lock.json"), "{}", "utf-8");
// hardening：data/datasets 下的代码必须可扫；大数据资产子目录跳过；symlink 不跟随
await mkdir(path.join(tmp, "datasets"), { recursive: true });
await mkdir(path.join(tmp, "datasets/raw"), { recursive: true });
await writeFile(path.join(tmp, "datasets/kitti.py"), "import torch\nclass Dataset:\n  def __init__(self): pass", "utf-8");
await writeFile(path.join(tmp, "datasets/raw/samples.bin"), "binarydata", "utf-8");
await writeFile(path.join(tmp, "link.txt"), "", "utf-8");
try { await fs.unlink(path.join(tmp, "link.txt")); } catch { /* */ }
try { await fs.symlink("/etc/hostname", path.join(tmp, "link.txt")); } catch { /* */ }

const { files, omitted } = await scanTree(tmp);
const oPaths = omitted.map((o) => o.path);
ok(oPaths.some((p) => p.startsWith("node_modules")), "node_modules 目录跳过且记录");
ok(oPaths.some((p) => p.startsWith("checkpoints")), "checkpoints 目录跳过且记录");
ok(oPaths.includes(".env"), ".env 跳过且记录");
ok(oPaths.includes("big.json"), ">1MB 跳过且记录");
ok(oPaths.includes("credentials.yml"), "credentials* 跳过（读取层拦截）");
ok(oPaths.includes("package-lock.json"), "package-lock.json 跳过（generated）");
ok(oPaths.includes("datasets/raw"), "datasets/raw 大数据资产子目录跳过（data_asset）");
ok(oPaths.includes("link.txt") || !files.some((f) => f.path === "link.txt"), "symlink 不跟随（omitted 或未进入 files）");
ok(files.some((f) => f.path === "train.py"), "train.py 保留");
ok(files.some((f) => f.path === "README.md"), "README.md 保留");
ok(files.some((f) => f.path === "datasets/kitti.py"), "datasets/ 下的代码文件照常扫描（不整目录砍）");
ok(!files.some((f) => f.path.includes("datasets/raw/")), "datasets/raw 下的大数据本体未进入 files");
ok(omitted.every((o) => o.path !== "datasets/kitti.py"), "datasets 代码未被误记为 omitted");
const reasons = new Set(omitted.map((o) => o.reason));
ok(reasons.has("secret") && reasons.has("too_large") && reasons.has("skipped_dir") && reasons.has("generated") && reasons.has("data_asset"), "跳过原因分类齐全（secret/too_large/skipped_dir/generated/data_asset）");
await fs.rm(tmp, { recursive: true, force: true });

console.log("== 5. 真实 repo 验收 ==");
// 5a. Research Atelier 自己（Next.js + TS）
console.log("  — Research Atelier (workflow-app) —");
const ra = await buildRepositorySnapshot("/media/ark/Data/devpy/projects/allinone/workflow-app");
ok(ra.repoRevision.isGit === true, "isGit");
ok(ra.repoRevision.commit, "commit 落地");
ok(Array.isArray(ra.configs) && ra.configs.length >= 5, `configs=${ra.configs.length}`);
ok(Array.isArray(ra.dependencies) && ra.dependencies.length >= 1, `dependencies=${ra.dependencies.length}（package.json 等清单）`);
ok(Array.isArray(ra.omitted) && ra.omitted.some((o) => o.reason === "generated"), "package-lock.json 等生成文件被跳过（generated）");
ok(Array.isArray(ra.entrypoints) && ra.entrypoints.length >= 1, `entrypoints=${ra.entrypoints.length}`);
ok(Array.isArray(ra.omitted) && ra.omitted.some((o) => o.reason === "skipped_dir"), "omitted 含 node_modules 等跳过目录");
const raConfigCommits = ra.configs.filter((f) => f.commit).length;
ok(raConfigCommits > 0, `configs 绑定 commit（${raConfigCommits}/${ra.configs.length}）`);

// 5b. 真实论文 Python repo（IsaacLab v2.3.2）
console.log("  — IsaacLab（真实论文 Python repo）—");
const il = await buildRepositorySnapshot("/home/ark/projects/IsaacLab");
ok(il.repoRevision.isGit === true && il.repoRevision.commit, `IsaacLab git commit=${String(il.repoRevision.commit).slice(0, 8)}`);
ok(Array.isArray(il.dependencies) && il.dependencies.some((f) => f.path.includes("environment.yml")), "environment.yml 识别为 dependencies");
ok(Array.isArray(il.dependencies) && il.dependencies.some((f) => f.path.includes("pyproject.toml")), "pyproject.toml 识别为 dependencies");
ok(Array.isArray(il.training) && il.training.length >= 3, `training candidates=${il.training.length}（train*.py 等）`);
ok(Array.isArray(il.evaluation) && il.evaluation.length >= 1, `evaluation=${il.evaluation.length}`);
ok(Array.isArray(il.datasets) && il.datasets.length >= 1, `datasets=${il.datasets.length}`);
ok(Array.isArray(il.scripts) && il.scripts.length >= 1, `scripts=${il.scripts.length}`);
ok(typeof il.totalFiles === "number" && il.totalFiles > 50, `totalFiles=${il.totalFiles}（真实大仓）`);
ok(Array.isArray(il.omitted) && il.omitted.length > 0, `omitted=${il.omitted.length}（跳过目录/大文件被记录）`);

console.log("== 6. 截断透明 + 证据排序 + dirty 标记 ==");
ok(il.categoryStats && typeof il.categoryStats.training === "object", "categoryStats.training 存在");
ok(typeof il.categoryStats.training.total === "number" && typeof il.categoryStats.training.returned === "number", "categoryStats total/returned");
ok(typeof il.categoryStats.training.truncated === "boolean", "categoryStats truncated boolean");
ok(il.categoryStats.training.total >= il.training.length, `training total=${il.categoryStats.training.total} >= returned=${il.training.length}`);
// 证据排序：训练 candidates 里，有训练调用证据的应该排在纯文件名匹配的前面
const ilTraining = il.training;
if (ilTraining.length >= 2) {
  const scores = ilTraining.map((f) => (f.evidence || []).length);
  ok(scores[0] >= scores[scores.length - 1], "training 按证据强度排序（首个证据数 ≥ 末个）");
}
ok(typeof il.training[0]?.workingTreeDirty === "boolean", "SnapshotFile.workingTreeDirty 标记存在");
// RA repo：dirty=true（有未提交修改），configs 文件应带 workingTreeDirty=true
const raDirtyCount = ra.configs.filter((f) => f.workingTreeDirty === true).length;
ok(raDirtyCount > 0, `RA configs 带 workingTreeDirty=true（dirty 仓库如实标记，${raDirtyCount}/${ra.configs.length}）`);

console.log("== 7. 共享层 revision 一致性（一次 snapshot 一个 revision） ==");
const revConsistency = await scanTree("/media/ark/Data/devpy/projects/allinone/workflow-app", ra.repoRevision);
ok(revConsistency.files.every((f) => f.commit === ra.repoRevision.commit), "scanTree 传入固定 revision：所有文件 commit 与顶层一致");
ok(revConsistency.files.every((f) => f.workingTreeDirty === Boolean(ra.repoRevision.dirty)), "workingTreeDirty 与顶层 dirty 一致");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
