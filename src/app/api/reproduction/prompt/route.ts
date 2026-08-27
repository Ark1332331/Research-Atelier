/**
 * 生成「可直接复制给 GPT / Codex」的复现提示词（模板拼接，不依赖网络）。
 * POST { slug, stepId? } → { prompt }
 * 整篇：打包论文+源码+你的知识水平+复现纪律+当前路径+坑点。
 * 指定 stepId：改为聚焦这一步。
 */
import { getReproduction } from "@/lib/reproduction";
import { readStore } from "@/lib/store";

const STAT = { todo: "待办", doing: "进行中", done: "已完成" } as const;

async function profileSummary(): Promise<string> {
  const md = await readStore("profile.md");
  if (!md) return "（暂无画像，按新手友好、数据合同讲解）";
  const lines = md.split("\n").filter((l) => /^[-*]\s|^\d+\.|编程与工具|PyTorch|Python|终端|论文理解|学习方法/.test(l.trim())).slice(0, 30).join("\n");
  return lines.slice(0, 1200) || "（暂无画像，按新手友好、数据合同讲解）";
}

export async function POST(request: Request) {
  let body: { slug?: string; stepId?: string; focus?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const r = await getReproduction(slug);
  if (!r) return Response.json({ error: "记录不存在" }, { status: 404 });

  const profile = await profileSummary();
  const pathText = r.path.length
    ? r.path.map((s) => `- [${STAT[s.status]}] ${s.title}${s.note ? `（${s.note}）` : ""}`).join("\n")
    : "- （尚未明确路径，请先帮我拆出可验证的复现步骤）";
  const pitText = r.pitfalls.length
    ? r.pitfalls.map((p) => `- ${p.text}${p.env ? "【环境】" : ""}`).join("\n")
    : "- （暂无，遇到问题随时记录下来）";

  const base =
    `【论文复现任务】你是我的复现伙伴，请一起推进《${r.title}》的复现。\n` +
    `论文来源：${r.sourceUrl || "(待补充)"}\n` +
    `代码/仓库：${r.repoUrl || "(待补充；若缺，请帮我找)"}\n\n` +
    `我的知识水平（据此讲解）：\n${profile}\n\n` +
    `复现纪律（务必遵守）：\n` +
    `① 分层推进（概念→数据→模型→训练→指标→对齐），每层给出可验证的最小成功标准；\n` +
    `② 不能把 loss 下降当成功，必须超过明确 baseline；正面/负面结论都如实记录；\n` +
    `③ 超参/结构选择标注来源（论文给定 / 工程约束 / toy 暂定）；\n` +
    `④ 环境问题用三层定位法（驱动层 / 环境层 / 项目层），不临场瞎试；\n` +
    `⑤ 代码讲解走"真实调用链 → 函数数据合同 → 执行前后变化"，重视掌握感。\n\n` +
    `当前复现路径：\n${pathText}\n\n` +
    `已记录的坑点：\n${pitText}\n\n`;

  if (body.stepId) {
    const st = r.path.find((s) => s.id === body.stepId);
    if (st) {
      return Response.json({ prompt: `${base}【请帮我完成这一步】${st.title}${st.note ? `\n说明：${st.note}` : ""}\n给出：最小成功标准、关键实现、验证方法。` });
    }
  }
  return Response.json({ prompt: `${base}【下一步】请先帮我明确复现路径（分层、可验证），或继续推进当前步骤；每完成一步给一句可验证结论，不要把‘跑通’当‘复现成功’。` });
}
