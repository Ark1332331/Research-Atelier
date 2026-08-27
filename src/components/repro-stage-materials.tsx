"use client";

import { useEffect, useState } from "react";

interface PaperArtifact { paperId: string; parsedPages: number; paperRevision?: string }
interface RepoArtifact { repoRootId: string; repoPath: string; commit?: string; dirty?: boolean }
interface LibPaper { id: string; title: string; slug?: string | null }

export default function ReproStageMaterials({
  paperArtifact, repoArtifact, onBind,
}: {
  paperArtifact?: PaperArtifact;
  repoArtifact?: RepoArtifact;
  onBind: (paperId: string, repoRootId: string, repoPath: string) => Promise<void>;
}) {
  const [libPapers, setLibPapers] = useState<LibPaper[]>([]);
  const [roots, setRoots] = useState<{ id: string; root: string; name?: string }[]>([]);
  const [paperPick, setPaperPick] = useState(paperArtifact?.paperId ?? "");
  const [repoPick, setRepoPick] = useState(repoArtifact?.repoRootId ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch("/api/library")).json();
        setLibPapers((d.papers ?? []).filter((p: LibPaper) => p.title && p.slug));
        const r = await (await fetch("/api/code-read")).json();
        setRoots((r.roots ?? []).map((x: { id: string; root: string; name?: string }) => ({ id: x.id, root: x.root, name: x.name })));
      } catch { /* */ }
    })();
  }, []);

  const paperBound = Boolean(paperArtifact && paperArtifact.parsedPages > 0);
  const repoBound = Boolean(repoArtifact && repoArtifact.repoRootId);
  const ready = paperBound && repoBound;
  const pa = paperArtifact; // 非空局部（渲染用，避免 narrowing 丢失）
  const ra = repoArtifact;

  async function bind() {
    if (!paperPick || !repoPick) return;
    const root = roots.find((r) => r.id === repoPick);
    if (!root) return;
    setBusy(true);
    try { await onBind(paperPick, repoPick, root.root); } finally { setBusy(false); }
  }

  return (
    <div className="repro-stage">
      <div className="repro-stage-title">{ready ? "材料已绑定" : "还不能开始分析"}</div>
      <p className="mono-label" style={{ opacity: 0.7 }}>
        {ready
          ? "论文与代码仓库都已绑定，可以开始系统分析。"
          : "当前只有论文标题。做论文↔代码核对还需要：论文全文 / PDF + 对应代码仓库。"}
      </p>

      <div className="repro-binding">
        <div className="repro-binding-row">
          <span className="mono-label">论文全文</span>
          {paperBound ? (
            <span className="chip chip--dark">✓ {pa!.paperId} · {pa!.parsedPages} 页 · rev {pa!.paperRevision?.slice(0, 6)}</span>
          ) : (
            <span className="chip">未绑定</span>
          )}
        </div>
        <div className="repro-binding-row">
          <span className="mono-label">代码仓库</span>
          {repoBound ? (
            <span className="chip chip--dark">✓ {ra!.repoRootId}{ra!.commit ? ` · ${ra!.commit.slice(0, 8)}` : ""}{ra!.dirty ? " · dirty" : ""}</span>
          ) : (
            <span className="chip">未绑定</span>
          )}
        </div>
      </div>

      <div className="repro-binding-form">
        <label className="mono-label">
          论文（需已导入全文）
          <select className="field field--mini" value={paperPick} onChange={(e) => setPaperPick(e.target.value)}>
            <option value="">选择论文…</option>
            {libPapers.map((p) => (
              <option key={p.id} value={p.slug ?? p.id}>{p.title.slice(0, 40)}{p.slug ? "" : "（无全文）"}</option>
            ))}
          </select>
        </label>
        <label className="mono-label">
          本地代码仓库
          <select className="field field--mini" value={repoPick} onChange={(e) => setRepoPick(e.target.value)}>
            <option value="">选择仓库…</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>{r.name ?? r.id} · {r.root}</option>
            ))}
          </select>
        </label>
        <button className="btn btn--primary" disabled={busy || !paperPick || !repoPick} onClick={() => void bind()}>
          {busy ? "绑定中…" : ready ? "更新绑定" : "绑定论文与仓库"}
        </button>
      </div>
    </div>
  );
}
