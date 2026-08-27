/**
 * Fact 归一化 + 有来源抽取（Step 4）。
 *
 * 一、normalizeFact / normalizeFacts：确定性归一化
 *   - key 必须来自 fact-taxonomy（有限注册表），未知 key 拒绝（不进入正式 Facts）；
 *   - status=observed|inferred|missing、confidence=high|medium|low、importance 按注册表；
 *   - missing 必须带 missingReason；
 *   - value 按注册表 valueType 归一化为 normalizedValue（number/string/bool/enum/array）。
 *
 * 二、extractRepoFacts：沿 Step 3 snapshot 候选文件做确定性抽取（不调 LLM）
 *   - 只读 dependencies/configs 分类的候选文件（小文件，已过安全边界）；
 *   - 用正则/简单解析识别已知 key（batch_size/lr/optimizer/python/torch/cuda/…）；
 *   - 每条带 file + lineStart + commit + workingTreeDirty（provenance）。
 *
 * 三、extractPaperFacts：DeepSeek 按论文相关章节定向抽取（taxonomy 钉死 key）
 *   - 不解决冲突、不做 Gap——只把论文里能确认的写成 observed/inferred，找不到的写成 missing+原因。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { KNOWN_FACTS, factDef, isKnownFactKey, type FactCategory } from "./fact-taxonomy.ts";
import type { Fact, FactConfidence, FactImportance, FactStatus } from "@/lib/reproduction-spec";

/* ================= 1. 确定性归一化 ================= */

const STATUSES: FactStatus[] = ["observed", "inferred", "missing"];
const CONFIDENCES: FactConfidence[] = ["high", "medium", "low"];

/** 按 valueType 归一化；无法归一化返回 undefined（保留原文 value，normalizedValue 缺省） */
export function normalizeValue(raw: unknown, def: { valueType: string; enumValues?: string[] }): { value: unknown; normalizedValue?: unknown; unit?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  const s = String(raw).trim();
  switch (def.valueType) {
    case "number": {
      const n = Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { value: raw };
      return { value: raw, normalizedValue: n };
    }
    case "bool":
      return { value: raw, normalizedValue: /^(true|yes|1|是)$/i.test(s) };
    case "enum": {
      const low = s.toLowerCase();
      const hit = (def.enumValues ?? []).find((e) => low.includes(e) || e.includes(low));
      return hit ? { value: raw, normalizedValue: hit } : { value: raw };
    }
    case "array":
      return { value: raw, normalizedValue: s.split(/[,，\s]+/).filter(Boolean) };
    default:
      return { value: raw, normalizedValue: s };
  }
}

export interface NormalizeFactInput {
  key: string;
  side: "paper" | "repo";
  value?: unknown;
  status?: FactStatus;
  confidence?: FactConfidence;
  importance?: FactImportance;
  missingReason?: string;
  source?: Fact["source"];
  id?: string;
}

/** 归一化单个 fact：未知 key 返回 null（拒绝）；已知 key 严格三分 + 保留 missing 原因 */
export function normalizeFact(input: NormalizeFactInput): Fact | null {
  const def = factDef(input.key);
  if (!def) return null; // 未知 key → 拒绝
  if (input.side !== "paper" && input.side !== "repo") return null;
  const status: FactStatus = STATUSES.includes(input.status as FactStatus) ? (input.status as FactStatus) : "observed";
  const confidence: FactConfidence = CONFIDENCES.includes(input.confidence as FactConfidence) ? (input.confidence as FactConfidence) : "medium";
  const importance: FactImportance = def.importance; // 以注册表为准，不接收外部覆盖
  const { value, normalizedValue, unit } = normalizeValue(input.value, def);

  if (status === "missing") {
    return {
      id: input.id ?? `f-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
      key: def.key, side: input.side, status, confidence, importance,
      missingReason: input.missingReason ?? "未在来源中找到该事实",
      source: input.source,
    };
  }
  return {
    id: input.id ?? `f-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    key: def.key, side: input.side,
    value, normalizedValue, unit,
    status, confidence, importance,
    source: input.source,
  };
}

/** 批量归一化：过滤未知 key；同一 key+side 只留一条（后到覆盖，确定性） */
export function normalizeFacts(inputs: NormalizeFactInput[]): Fact[] {
  const out: Fact[] = [];
  const seen = new Set<string>();
  for (const inp of inputs) {
    const f = normalizeFact(inp);
    if (!f) continue;
    const dedupe = `${f.side}:${f.key}`;
    if (seen.has(dedupe)) {
      const i = out.findIndex((x) => `${x.side}:${x.key}` === dedupe);
      if (i >= 0) out[i] = f;
      continue;
    }
    seen.add(dedupe);
    out.push(f);
  }
  return out;
}

/* ================= 2. Repo 侧确定性抽取（沿 Step 3 snapshot 候选） ================= */

interface RepoFactHit { key: string; value: unknown; file: string; lineStart?: number; commit?: string; dirty?: boolean }

/** 在单行文本里找已知 key 的简单值（config 风格：key: value / key = value） */
const REPO_VALUE_RE = /([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/;

/** 从 snapshot 的 dependencies/configs 候选文件里确定性抽取 fact 命中。
 *  不调 LLM；只读小文件；文件内容与 commit/dirty 来自 snapshot（provenance）。 */
export async function extractRepoFacts(files: { path: string; commit?: string; workingTreeDirty?: boolean }[], baseRoot: string): Promise<Fact[]> {
  const hits: RepoFactHit[] = [];

  for (const f of files) {
    // 只处理依赖清单与配置文件（小文件，已过安全边界）；跳过生成的 egg-info 元数据
    const low = f.path.toLowerCase();
    if (low.includes(".egg-info") || low.includes("node_modules")) continue;
    const isManifest = /requirements|environment|pyproject|setup|dockerfile/i.test(low);
    const isConfig = /\.(ya?ml|toml|ini|cfg|json)$/.test(low) && /config|train|eval|default|base/.test(low);
    if (!isManifest && !isConfig) continue;

    let content = "";
    try {
      content = await readFile(path.join(baseRoot, f.path), "utf-8");
    } catch { continue; }

    const lines = content.split("\n");
    lines.forEach((line, i) => {
      // pip index-url / dependency_links：https://download.pytorch.org/whl/cu128 → cuda 变体
      const cudaUrl = line.match(/whl\/(cu\d+(?:\.\d+)?)/i);
      if (cudaUrl) {
        const v = cudaUrl[1].toLowerCase();
        hits.push({ key: "runtime.cuda_version", value: v, file: f.path, lineStart: i + 1, commit: f.commit, dirty: f.workingTreeDirty });
        return;
      }
      const m = line.match(REPO_VALUE_RE);
      if (!m) return;
      const rawKey = m[1].toLowerCase().replace(/-/g, "_");
      const rawVal = m[2].trim().replace(/^["']|["']$/g, "").replace(/#.*$/, "").trim();
      if (!rawVal) return;

      // key → taxonomy 映射（repo 侧常见写法）；必须精确匹配，避免 TORCH_CUDA_ARCH_LIST 这类复合名误判
      let key: string | undefined;
      if (/^(python|python_?version)$/.test(rawKey) && /version|python/.test(rawKey)) key = "runtime.python_version";
      else if (/^(torch|pytorch|torch_?version)$/.test(rawKey)) key = "runtime.pytorch_version";
      else if (/^(cuda|cuda_?version)$/.test(rawKey)) key = "runtime.cuda_version";
      else if (/^batch_?size$/.test(rawKey)) key = "training.batch_size";
      else if (/^(lr|learning_?rate)$/.test(rawKey)) key = "training.lr";
      else if (/^(optimizer|opt)$/.test(rawKey)) key = "training.optimizer";
      else if (/^(epochs?|max_?steps|num_?steps|max_?epochs)$/.test(rawKey)) key = "training.epochs";
      else if (/^seed$/.test(rawKey)) key = "training.seed";
      else if (/^(input_?size|image_?size|grid_?size|resolution)$/.test(rawKey)) key = "preprocessing.input_size";
      else if (/^(voxel_?size|cell_?size|voxel_?resolution)$/.test(rawKey)) key = "preprocessing.voxel_resolution";
      else if (/^(metric|metrics)$/.test(rawKey)) key = "evaluation.metric";
      else if (/^(alpha|pruning_?alpha|prun_?alpha)$/.test(rawKey)) key = "model.pruning_alpha";

      if (!key || !isKnownFactKey(key)) return;
      // requirements 里的版本行：torch==2.9.1 之类
      const verMatch = rawVal.match(/[0-9]+(?:\.[0-9]+){1,3}/);
      const value = key.startsWith("runtime.") && verMatch ? verMatch[0] : rawVal;
      hits.push({ key, value, file: f.path, lineStart: i + 1, commit: f.commit, dirty: f.workingTreeDirty });
    });
  }

  // 确定性归一化（provenance 从 hit 来）
  return normalizeFacts(hits.map((h) => ({
    key: h.key, side: "repo" as const, value: h.value, status: "observed" as const, confidence: "high" as const,
    source: { kind: "repo" as const, file: h.file, lineStart: h.lineStart, commit: h.commit },
  })));
}

/* ================= 3. Paper 侧抽取（DeepSeek，taxonomy 钉死 key，定向章节） ================= */

/** 把 taxonomy 渲染成给 LLM 的 JSON schema 提示 */
export function taxonomyPrompt(): string {
  return KNOWN_FACTS.map((f) => `"${f.key}": { category: "${f.category}", label: "${f.label}", importance: "${f.importance}", valueType: "${f.valueType}"${f.hint ? `, hint: "${f.hint}"` : ""} }`).join("\n");
}

const PAPER_EXTRACT_SYSTEM = (taxonomy: string) =>
  "你是论文复现事实抽取器。给定一篇论文的正文文本，按下面这份**封闭的 taxonomy** 抽取复现相关事实。\n" +
  "规则：\n" +
  "1. key 只能从 taxonomy 里取，**禁止发明新 key**；\n" +
  "2. 论文明确写了 → status=observed，confidence 按明确程度 high/medium，source.section 填论文章节（如 III-B / 4.1），source.page 填页号，source.quote 填原句（≤80 字）；\n" +
  "3. 论文暗示但未明说（如从图/上下文推断）→ status=inferred，confidence=low/medium；\n" +
  "4. 论文完全没提（required 级 key 尤其）→ status=missing，missingReason 写具体原因（如「论文未报告 batch size」）；\n" +
  "5. 只输出一个 JSON 数组：[{\"key\":\"...\",\"value\":...,\"status\":\"observed|inferred|missing\",\"confidence\":\"high|medium|low\",\"section\":\"...\",\"page\":n,\"quote\":\"...\",\"missingReason\":\"...\"}]。不要输出 JSON 以外内容。\n\n" +
  `Taxonomy：\n${taxonomy}`;

interface PaperExtractRaw {
  key?: string; value?: unknown; status?: string; confidence?: string;
  section?: string; page?: number; quote?: string; missingReason?: string;
  /** 兼容模型把 source 嵌套成对象的情况 */
  source?: { section?: string; page?: number; quote?: string };
}

/** DeepSeek 抽取论文事实（定向：把论文按页传入；返回归一化后的 Fact[]，仅 paper 侧） */
export async function extractPaperFacts(pageTexts: string[]): Promise<Fact[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];
  const text = pageTexts.map((p, i) => `【第 ${i + 1} 页】\n${p.slice(0, 4000)}`).join("\n\n").slice(0, 24000);

  let rawArr: PaperExtractRaw[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: PAPER_EXTRACT_SYSTEM(taxonomyPrompt()) },
            { role: "user", content: text },
          ],
          stream: false,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) {
        const d = await res.json();
        const c = d?.choices?.[0]?.message?.content ?? "";
        const start = c.indexOf("[");
        const end = c.lastIndexOf("]");
        if (start >= 0 && end > start) {
          try {
            const arr = JSON.parse(c.slice(start, end + 1));
            if (Array.isArray(arr)) { rawArr = arr; break; }
          } catch { /* 截取坏 JSON → 重试 */ }
        }
      }
    } catch { /* 重试 */ }
  }

  return normalizeFacts(rawArr.map((r) => ({
    key: r.key ?? "",
    side: "paper" as const,
    value: r.value,
    status: (r.status as FactStatus) ?? "observed",
    confidence: (r.confidence as FactConfidence) ?? "medium",
    missingReason: r.missingReason,
    // 兼容平铺与嵌套 source 两种模型输出
    source: { kind: "paper" as const, section: r.section ?? r.source?.section, page: r.page ?? r.source?.page, quote: r.quote ?? r.source?.quote },
  })));
}
