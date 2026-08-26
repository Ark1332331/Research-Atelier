"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LibraryGroup, LibraryPaper } from "@/app/api/library/route";
import PageHead from "@/components/page-head";

/* ---------- 本地工具 ---------- */

// 内置 NSR 论文对应的服务器 PDF slug（data/papers/nsr-mt454tqk）
const BUILTIN_SLUG = "nsr-mt454tqk";
function readSlug(p: LibraryPaper): string | null {
  if (p.source === "builtin") return BUILTIN_SLUG;
  return p.slug || null;
}

function git(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

function FuzzyStatus({ status, color }: { status?: string; color?: string }) {
  return (
    <span className="chip chip--dark" style={{ background: color ?? "var(--panel-dark)" }}>{status || "未读"}</span>
  );
}

/* ---------- 主组件：论文库（总览） ---------- */

export default function PaperLibrary({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const router = useRouter();
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [papers, setPapers] = useState<LibraryPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("all"); // all | g-<id> | unfiled
  const [showAdd, setShowAdd] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [addForm, setAddForm] = useState({ title: "", authors: "", venue: "", year: "", status: "未读" });
  const [addGroup, setAddGroup] = useState<string>("");
  // 从本地 PDF 导入（上传 → 提取原文 + 后台翻译 → 进论文库）
  const [importing, setImporting] = useState(false);
  const [importTip, setImportTip] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // 补抽已导入论文的术语
  const [backfilling, setBackfilling] = useState(false);
  const [backfillTip, setBackfillTip] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) { setGroups(data.groups ?? []); setPapers(data.papers ?? []); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function act(body: object) {
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups ?? []);
        setPapers(data.papers ?? []);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const byGroup = useMemo(() => {
    const map = new Map<string, LibraryPaper[]>();
    for (const p of papers) {
      const key = p.group ?? "unfiled";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [papers]);

  const current = papers.find((p) => p.current);

  const createGroup = async () => {
    if (!newGroup.trim()) return;
    if (await act({ action: "createGroup", name: newGroup.trim() })) setNewGroup("");
  };

  const addPaper = async () => {
    if (!addForm.title.trim()) return;
    const ok = await act({ action: "addPaper", paper: { ...addForm, title: addForm.title.trim() }, group: addGroup || null });
    if (ok) {
      setAddForm({ title: "", authors: "", venue: "", year: "", status: "未读" });
      setAddGroup("");
      setShowAdd(false);
    }
  };

  // 从本地 PDF 导入论文库（/api/paper POST multipart；翻译后台生成）
  const onImportFile = async (f: File) => {
    setImporting(true);
    setImportTip("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/paper", { method: "POST", body: fd });
      const d = await res.json();
      if (res.ok) {
        setImportTip(`✓ 已导入《${d?.meta?.title ?? f.name}》，中文翻译正在后台生成，稍后可在「精读讲解」阅读`);
        const r = await fetch("/api/library", { cache: "no-store" });
        const data = await r.json();
        setGroups(data.groups ?? []);
        setPapers(data.papers ?? []);
      } else {
        setImportTip(`导入失败：${d?.error ?? "未知错误"}`);
      }
    } catch (e) {
      setImportTip(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const backfillTerms = async () => {
    setBackfilling(true);
    setBackfillTip("");
    try {
      const res = await fetch("/api/paper-terms/backfill", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setBackfillTip(`补抽失败：${d?.error ?? ""}`); return; }
      setBackfillTip(`已开始为 ${d?.scanned ?? 0} 篇已导入论文补抽术语（后台进行，稍后到「术语卡」查看）`);
    } catch (e) {
      setBackfillTip(`补抽失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackfilling(false);
    }
  };

  function PaperCard({ p }: { p: LibraryPaper }) {
    const has = !!(isReadable(p) || p.venue || p.year);
    const isCur = p.current;
    const slug = readSlug(p);
    return (
      <article className={`lib-paper${isCur ? " is-current" : ""}`}>
        <div className="lib-paper-top">
          <button className="lib-paper-title" title={`打开《${p.title}》全屏阅读`}
            onClick={() => slug && router.push(`/read/${slug}`)}>{p.title}</button>
          <div className="lib-paper-tags">
            <FuzzyStatus status={p.status} color={p.statusColor} />
            {isCur && <span className="chip chip--active">当前在读</span>}
          </div>
        </div>
        <p className="lib-paper-meta">{git(p.authors, p.venue && `${p.venue}`, p.year && `${p.year}`) || "未填写作者 / 出处"}</p>
        {Array.isArray(p.tags) && p.tags.length > 0 && (
          <div className="lib-paper-tags">
            {p.tags.map((t) => <span key={t} className="chip">{t}</span>)}
          </div>
        )}
        {has && (
          <div className="lib-paper-foot">
            <button className="btn btn--ghost btn--quiet" onClick={() => slug && router.push(`/read/${slug}`)}>全屏阅读</button>
            <button className="btn btn--ghost btn--quiet" onClick={() => onNavigate?.("repro")}>实验复现</button>
          </div>
        )}
        <div className="lib-paper-actions">
          <button className="btn btn--ghost btn--quiet" onClick={() => isCur ? void act({ action: "setCurrent", id: null }) : void act({ action: "setCurrent", id: p.id })}>
            {isCur ? "取消当前" : "设为当前"}
          </button>
          <select
            className="field field--mini"
            value={p.group ?? "unfiled"}
            onChange={(e) => void act({ action: "updatePaper", id: p.id, patch: { group: e.target.value === "unfiled" ? null : e.target.value } })}
            aria-label={`移动《${p.title}》到分组`}
          >
            <option value="unfiled">未分组</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button className="btn btn--ghost btn--danger-ghost btn--quiet" onClick={() => void act({ action: "deletePaper", id: p.id })}>删除</button>
        </div>
      </article>
    );
  }

  return (
    <section>
      <PageHead
        num="01" name="论文库"
        title="我的论文库"
        desc="把论文按你自己的方式分进文件夹；挑一篇设为「当前在读」，它驱动下面的导读与复现。"
        meta={`${papers.length} 篇 · ${groups.length} 个分组`}
      />

      {/* 当前在读：焦点卡（只有一篇，由库里的 current 决定） */}
      {current && (
        <div className="task-card" style={{ marginBottom: "1.3rem" }}>
          <div className="task-inner">
            <div style={{ minWidth: 0 }}>
              <div className="task-top">
                <span className="mono-label">当前在读</span>
                <span className="chip chip--active" style={{ fontSize: "0.56rem" }}>{current.status || "—"}</span>
                <span className="chip chip--dark" style={{ fontSize: "0.56rem" }}>{current.year || ""}</span>
              </div>
              <h1 className="task-title" style={{ margin: "0.35rem 0" }}>{current.title}</h1>
              <div className="task-actions" style={{ marginTop: "0.7rem" }}>
                <button className="btn btn--accent" onClick={() => onNavigate?.("explain")}>带正文去精读</button>
                <button className="btn" onClick={() => onNavigate?.("repro")}>实验复现</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分组标签栏 */}
      <div className="lib-tabs">
        <button className={`lib-tab${tab === "all" ? " is-active" : ""}`} onClick={() => setTab("all")}>全部</button>
        {groups.map((g) => (
          <button key={g.id} className={`lib-tab${tab === g.id ? " is-active" : ""}`} onClick={() => setTab(g.id)}>
            {g.name}
          </button>
        ))}
        <button className={`lib-tab${tab === "unfiled" ? " is-active" : ""}`} onClick={() => setTab("unfiled")}>未分组</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn--ghost btn--quiet" onClick={() => setShowAdd((v) => !v)}>+ 添加论文</button>
      </div>

      {/* 添加论文面板 */}
      {showAdd && (
        <div className="mod" style={{ marginBottom: "1.6rem" }}>
          <div className="mod-body">
            <div className="ledger-grid" style={{ marginBottom: 0 }}>
              <label className="field-label">
                <span className="mono-label">标题（必填）</span>
                <input className="field" value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} />
              </label>
              <label className="field-label">
                <span className="mono-label">作者</span>
                <input className="field" value={addForm.authors} onChange={(e) => setAddForm({ ...addForm, authors: e.target.value })} />
              </label>
              <label className="field-label">
                <span className="mono-label">出处 / 期刊</span>
                <input className="field" value={addForm.venue} onChange={(e) => setAddForm({ ...addForm, venue: e.target.value })} />
              </label>
              <label className="field-label">
                <span className="mono-label">年份</span>
                <input className="field" value={addForm.year} onChange={(e) => setAddForm({ ...addForm, year: e.target.value })} />
              </label>
              <label className="field-label">
                <span className="mono-label">状态</span>
                <select className="field" value={addForm.status} onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}>
                  {["未读", "在读", "已读", "深度精读", "复现中"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field-label">
                <span className="mono-label">放入分组</span>
                <select className="field" value={addGroup} onChange={(e) => setAddGroup(e.target.value)}>
                  <option value="">未分组</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
              <button className="btn btn--primary" onClick={() => void addPaper()}>添加到库</button>
              <button className="btn btn--ghost" onClick={() => setShowAdd(false)}>取消</button>
            </div>
            <div className="field-label" style={{ marginTop: "0.9rem", marginBottom: "0.3rem" }}>
              <span className="mono-label">或从本地 PDF 导入（上传后自动提取原文 + 后台翻译，进论文库）</span>
            </div>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn--ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? "导入中…" : "选择 PDF 文件导入"}
              </button>
              <input ref={fileRef} type="file" accept=".pdf" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.target.value = ""; }} />
              {importTip && <span className="mono-label" style={{ color: "var(--muted-foreground)" }}>{importTip}</span>}
            </div>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.9rem" }}>
              <button className="btn btn--ghost btn--quiet" disabled={backfilling} onClick={() => void backfillTerms()}>
                {backfilling ? "补抽中…" : "为已导入论文补抽术语"}
              </button>
              {backfillTip && <span className="mono-label" style={{ color: "var(--muted-foreground)" }}>{backfillTip}</span>}
            </div>
          </div>
        </div>
      )}

      {/* 新建分组（内联） */}
      <div className="lib-newgroup">
        <input
          className="field field--mini" placeholder="新建分组名（如：阅读计划）"
          value={newGroup} onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void createGroup(); }}
          style={{ maxWidth: 220 }}
        />
        <button className="btn btn--ghost btn--quiet" onClick={() => void createGroup()}>+ 新建分组</button>
      </div>

      {/* 论文列表 */}
      {loading ? (
        <p className="mono-label" style={{ padding: "1.5rem 0.3rem" }}>读取中…</p>
      ) : papers.length === 0 ? (
        <p style={{ padding: "1.5rem 0.3rem", fontStyle: "italic", fontFamily: "var(--font-lora)", color: "var(--muted-foreground)" }}>
          库里还没有论文——添加一篇，或从「论文筛选/精读」导入。
        </p>
      ) : tab === "all" ? (
        <div className="lib-sections">
          {groups.map((g) => (
            <div key={g.id} className="lib-section">
              <div className="ledger-head" style={{ marginBottom: "0.6rem" }}>
                <span className="ledger-title">{g.name}</span>
                <span className="mono-label">{(byGroup.get(g.id) ?? []).length} 篇</span>
              </div>
              {(byGroup.get(g.id) ?? []).length === 0 ? (
                <p className="mono-label" style={{ padding: "0.4rem 0", opacity: 0.6 }}>空分组</p>
              ) : (
                <div className="lib-grid">{(byGroup.get(g.id) ?? []).map((p) => <PaperCard key={p.id} p={p} />)}</div>
              )}
            </div>
          ))}
          <div className="lib-section">
            <div className="ledger-head" style={{ marginBottom: "0.6rem" }}>
              <span className="ledger-title">未分组</span>
              <span className="mono-label">{(byGroup.get("unfiled") ?? []).length} 篇</span>
            </div>
            {(byGroup.get("unfiled") ?? []).length === 0 ? (
              <p className="mono-label" style={{ padding: "0.4rem 0", opacity: 0.6 }}>没有未分组的论文</p>
            ) : (
              <div className="lib-grid">{(byGroup.get("unfiled") ?? []).map((p) => <PaperCard key={p.id} p={p} />)}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="lib-grid">
          {(byGroup.get(tab === "unfiled" ? "unfiled" : tab) ?? []).map((p) => <PaperCard key={p.id} p={p} />)}
          {(byGroup.get(tab === "unfiled" ? "unfiled" : tab) ?? []).length === 0 && (
            <p className="mono-label" style={{ padding: "0.4rem 0", opacity: 0.6 }}>这个分组还没有论文。</p>
          )}
        </div>
      )}
    </section>
  );
}

/* 小工具：判断一个论文是否值得显示“读/复现”入口（内置论文已接，导入的看有没有 slug） */
function isReadable(p: LibraryPaper): boolean {
  return p.source === "builtin" || Boolean(p.slug);
}
