/**
 * Analyze orchestrator 接口（阶段②，P0 Analysis Binding Gate）
 * POST /api/reproduction/analyze { slug }
 *  - **不再接受 rootId**：repo root 必须来自 record.repoArtifact.repoRootId（code-roots 登记）；
 *    缺 repoArtifact → 400 repo_not_bound；缺 paperArtifact / 读不到全文 → 400 paper_not_bound。
 *  - 绝不允许 fallback roots[0]——不同 record 必须各自显式绑定，避免跨记录 repo facts 串扰。
 *  - 服务端一次性运行：paper extraction → repo analyzer → facts → mapping → gaps（固定本轮 revision）。
 */
import { readStore } from "@/lib/store";
import { getReproduction, upsertReproduction } from "@/lib/reproduction";
import { runAnalysis, type AnalyzeResult } from "@/lib/analyze";

interface RootConfig { id: string; name: string; root: string }
async function readRoots(): Promise<RootConfig[]> {
  const raw = await readStore("code-roots.json");
  if (raw) {
    try { const d = JSON.parse(raw); return Array.isArray(d.roots) ? d.roots : []; } catch { /* */ }
  }
  return [];
}

export async function POST(request: Request) {
  let body: { slug?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  // —— Binding Gate：论文必须绑定且全文可读 ——
  const paperId = rec.paperArtifact?.paperId;
  if (!paperId) {
    return Response.json({ error: "paper_not_bound", hint: "还没有关联论文全文（PDF/页面）。请先关联论文，我目前只有标题，无法做论文↔代码核对。" }, { status: 400 });
  }
  // —— Binding Gate：仓库必须显式绑定（绝不 fallback roots[0]） ——
  const repoRootId = rec.repoArtifact?.repoRootId;
  if (!repoRootId) {
    return Response.json({ error: "repo_not_bound", hint: "还没有关联代码仓库。请选择本地仓库或添加官方 GitHub 仓库。" }, { status: 400 });
  }
  const roots = await readRoots();
  const cfg = roots.find((r) => r.id === repoRootId);
  if (!cfg) {
    return Response.json({ error: "repo_not_bound", hint: `repoRootId「${repoRootId}」未在 code-roots.json 登记。` }, { status: 400 });
  }

  const result: AnalyzeResult = await runAnalysis(rec, { paperId, repoRoot: cfg.root });
  if (result.ok) {
    await upsertReproduction(rec);
    return Response.json({ root: cfg.id, ...result });
  }
  // 失败也持久化 analysis state（status=failed）
  rec.analysis = result.analysis;
  await upsertReproduction(rec);
  return Response.json({ root: cfg.id, ...result }, { status: 500 });
}
