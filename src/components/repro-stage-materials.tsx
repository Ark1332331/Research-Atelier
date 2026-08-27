"use client";

import { useEffect, useState } from "react";

interface PaperArtifact { paperId: string; parsedPages: number; paperRevision?: string }
interface RepoArtifact { repoRootId: string; repoPath: string; commit?: string; dirty?: boolean }
interface LibPaper { id: string; title: string; slug?: string | null }

import path from "node:path";

export default function ReproStageMaterials({
  paperArtifact, repoArtifact, onBind,
}: {
  paperArtifact?: PaperArtifact;
  repoArtifact?: RepoArtifact;
  onBind: (paperId: string, repoRootId: string, repoPath: string) => Promise<void>;
}) {
  const [libPapers, setLibPapers] = useState<LibPaper[]>([]);
  const [roots, setRoots] = useState<{ id: string; root: string; name?: string }[]>([]);
  const [discovered, setDiscovered] = useState<{ id: string; root: string; name: string; git: boolean }[]>([]);
  const [paperPick, setPaperPick] = useState(paperArtifact?.paperId ?? "");
  const [repoPick, setRepoPick] = useState(repoArtifact?.repoRootId ?? "");
  const [manualRepo, setManualRepo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch("/api/library")).json();
        setLibPapers((d.papers ?? []).filter((p: LibPaper) => p.title && p.slug));
        const r = await (await fetch("/api/code-read?discover=1")).json();
        setRoots((r.registered ?? []).map((x: { id: string; root: string; name?: string }) => ({ id: x.id, root: x.root, name: x.name })));
        setDiscovered((r.discovered ?? []).map((x: { id: string; root: string; name: string; git: boolean }) => ({ id: x.id, root: x.root, name: x.name, git: x.git })));
      } catch { /* */ }
    })();
  }, []);

  const paperBound = Boolean(paperArtifact && paperArtifact.parsedPages > 0);
  const repoBound = Boolean(repoArtifact && repoArtifact.repoRootId);
  const ready = paperBound && repoBound;
  const pa = paperArtifact; // 非空局部（渲染用，避免 narrowing 丢失）
  const ra = repoArtifact;

  async function bind() {
    if (!paperPick) return;
    // 优先手动路径（任意绝对路径，含非 git / 任意位置）
    if (manualRepo.trim()) {
      const rp = manualRepo.trim();
      setBusy(true);
      try {
        const rr = await (await fetch("/api/code-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "registerRoot", root: rp, name: path.basename(rp) }) })).json();
        if (!rr.ok) { alert(rr.error ?? "路径无效"); return; }
        const reg = (rr.roots ?? []).find((x: { root: string }) => x.root === rp);
        if (reg) { setRoots((rr.roots ?? []).map((x: { id: string; root: string; name?: string }) => ({ id: x.id, root: x.root, name: x.name }))); await onBind(paperPick, reg.id, reg.root); }
      } finally { setBusy(false); }
      return;
    }
    const root = roots.find((r) => r.id === repoPick) ?? discovered.find((r) => r.id === repoPick);
    if (!root) return;
    setBusy(true);
    try {
      let rootId = repoPick;
      // 若选的是自动发现的仓库（未在 code-roots.json）→ 先登记成持久 root
      if (repoPick.startsWith("discover-")) {
        const rr = await (await fetch("/api/code-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "registerRoot", root: root.root, name: root.name }) })).json();
        if (rr.ok && rr.roots?.length) {
          const reg = rr.roots.find((x: { root: string }) => x.root === root.root);
          rootId = reg?.id ?? repoPick;
          setRoots((rr.roots ?? []).map((x: { id: string; root: string; name?: string }) => ({ id: x.id, root: x.root, name: x.name })));
        }
      }
      await onBind(paperPick, rootId, root.root);
    } finally { setBusy(false); }
  }

  /** 弹系统原生目录选择对话框（zenity，服务器同屏）→ 回填手动路径 */
  async function pickDir() {
    setBusy(true);
    try {
      const r = await fetch("/api/fs/pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (d.path) { setManualRepo(d.path); setRepoPick(""); }
    } catch { /* */ }
    setBusy(false);
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
            <optgroup label="已登记">
              {roots.map((r) => (
                <option key={r.id} value={r.id}>{r.name ?? r.id} · {r.root}</option>
              ))}
            </optgroup>
            {discovered.length > 0 && (
              <optgroup label="本机发现（选择后将登记）">
                {discovered.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.git ? " · git" : ""} · {r.root}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", width: "100%", marginTop: "0.2rem" }}>
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void pickDir()}>选择文件夹…</button>
          <span className="mono-label" style={{ opacity: 0.6 }}>（弹系统对话框，点选目标代码库文件夹）</span>
        </div>
        <div className="mono-label" style={{ opacity: 0.7 }}>或手动输入本地目录路径（任意位置 / 非 git 均可）：</div>
        <input className="field field--mini" placeholder="/home/ark/projects/IsaacLab（绝对路径）" value={manualRepo} onChange={(e) => setManualRepo(e.target.value)} />
        <button className="btn btn--primary" disabled={busy || !paperPick || (!repoPick && !manualRepo.trim())} onClick={() => void bind()}>
          {busy ? "绑定中…" : ready ? "更新绑定" : "绑定论文与仓库"}
        </button>
      </div>
    </div>
  );
}
