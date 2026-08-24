/**
 * 论文全文翻译（共享模块）：把「每页原文」按段落组织翻译成一篇中文 Markdown。
 * 供两处复用：
 *   - /api/paper（上传 PDF 导入时）自动生成 translation.md
 *   - src/lib/paper-tools.ts 的 downloadPaper（联网下载导入时）自动生成 translation.md
 * 与 scripts/translate-full.mjs 的提示词保持一致（改这里要同步改那边）。
 */
const TRANSLATE_SYSTEM =
  "你是学术论文翻译引擎。把用户发来的英文论文翻译成中文，并输出 Markdown。规则：\n" +
  "1. 保留原文的章节结构：论文标题用一级标题 #，各节标题用 ##，小节用 ###；原文没有标题的段落保持为普通段落；\n" +
  "2. 段落与原文一一对应：同一段落在原文中跨页的，请合并成一个完整段落；不要合并原文中不同的段落；\n" +
  "3. 公式、数字、变量名、引用编号 [x] 原样保留；图注/表注也要翻译；\n" +
  "4. 专业术语第一次出现时用「英文（中文）」格式（如 point cloud（点云）），之后直接用中文；\n" +
  "5. 不要输出任何前言、后语或说明，只输出译文正文；\n" +
  "6. 若输入注明是论文的某一部分（续段），直接续译，不要重复输出论文总标题。";

/* 疑似章节标题的行（用于分块时对齐边界）：ABSTRACT / I. INTRODUCTION / REFERENCES 之类 */
const HEADING_RE = /^(?:[ivxlcdm]+[.)]\s+)?[A-Z][A-Z\s&,'’-]{2,}$/i;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70 || /^\d{1,3}$/.test(t)) return false;
  return HEADING_RE.test(t);
}

/** 全文按「章节标题边界」分块：块内不切碎段落，块与块在标题处断开。
    块大小取 14k/18k（输出约 5-6k token，在 8k 输出上限内），块数尽量少。 */
function chunkDocument(full: string): string[] {
  const TARGET = 14000, HARD = 18000;
  const chunks: string[] = [];
  const lines = full.split("\n");
  let acc = "";
  for (const line of lines) {
    if (acc.length >= TARGET && isHeadingLine(line)) {
      chunks.push(acc.replace(/\n+$/, ""));
      acc = "";
    } else if (acc.length >= HARD) {
      chunks.push(acc.replace(/\n+$/, ""));
      acc = "";
    }
    acc += line + "\n";
  }
  if (acc.trim()) chunks.push(acc.replace(/\n+$/, ""));
  return chunks;
}

const CONTINUE_NOTE =
  "这是同一篇论文的一部分（已按章节切分。请直接输出这一部分的译文，不要输出论文总标题，" +
  "也不要重复前面已翻译的内容；若开头是章节标题，用相应层级的 ## 标题）。";

/** 全文按段落组织翻译成一篇 Markdown（文本层方案；扫描版无文本层会返回失败标记） */
export async function translateDocument(pages: string[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return "（未配置 DEEPSEEK_API_KEY，无法翻译）";

  // 带页码标记的全文；按章节边界分块，保证跨页段落有上下文可合并
  const full = pages.map((t, i) => `【第 ${i + 1} 页】\n${t}`).join("\n\n");
  const chunks = chunkDocument(full);

  // 并行请求全部块：总耗时 ≈ 单块耗时（块间无依赖，译文按块序拼接）。
  // DeepSeek 直连在部分网络下不稳定，对每个块做重试，避免一次抖动导致整段失败。
  const out = await Promise.all(chunks.map(async (chunk, i) => {
    let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
      try {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: TRANSLATE_SYSTEM },
              { role: "user", content: i === 0 ? chunk : `${CONTINUE_NOTE}\n\n${chunk}` },
            ],
            stream: false,
            max_tokens: 8000,
          }),
          signal: AbortSignal.timeout(120000),
        });
        data = await res.json();
        if (res.ok) break;
        if (res.status < 500 && res.status !== 429) break; // 业务错误，重试无意义
      } catch { /* 网络层错误，重试 */ }
    }
    return data?.choices?.[0]?.message?.content ?? "（翻译失败：网络不稳定，请稍后重试）";
  }));
  return out.join("\n\n");
}
