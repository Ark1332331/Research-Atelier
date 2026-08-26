"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Term } from "@/app/api/terms/route";
import PageHead from "@/components/page-head";
import { KnowledgeGraph } from "@/components/dashboard";

const ROLE_OPTIONS = [
  "感知/传感器", "状态估计/对齐", "场景表示/建图", "补全/学习机制",
  "控制/决策", "训练机制", "评估指标", "工程/部署", "领域背景",
];
const STATUS_OPTIONS = ["未接触", "有直觉", "能解释", "能对应论文", "能实现"];
const REUSE_OPTIONS = ["通用", "论文特有", "论文内特殊含义"];
export const STATUS_COLOR: Record<string, string> = {
  "未接触": "var(--muted-foreground)", "有直觉": "var(--amber)", "能解释": "var(--foreground)",
  "能对应论文": "var(--foreground)", "能实现": "var(--foreground)",
};

/** ISO → MM/DD 短日期（术语卡"更新于"痕迹） */
function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}


export default function Terms() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Term>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setTerms(data.terms ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function post(body: object) {
    const res = await fetch("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setTerms(data.terms ?? []);
      return true;
    }
    return false;
  }

  function startEdit(t: Term) {
    setEditingId(t.id);
    setEditForm({ name: t.name, role: t.role, reuse: t.reuse, note: t.note, source: t.source, links: t.links });
  }

  async function saveEdit() {
    if (!editingId || !editForm.name?.trim()) return;
    if (await post({ term: { id: editingId, ...editForm } })) setEditingId(null);
  }

  async function changeStatus(t: Term, status: string) {
    await post({ term: { ...t, status } });
  }

  async function remove(id: string) {
    await post({ deleteId: id });
  }

  const latestUpdate = terms.reduce((max, t) => (t.updatedAt > max ? t.updatedAt : max), "");

  return (
    <section>
      <PageHead
        num="04" name="术语卡"
        title="跨论文词汇表"
        desc="术语由研究伴侣在读论文时自动建档（首次出现即建档）；这里查看与校准——状态升级由 AI 当场验收后帮你改。"
        meta={terms.length > 0 ? `${terms.length} 张卡 · 最近更新 ${fmtDate(latestUpdate)}` : "词汇表还是空的 — 读论文时会自动生成"}
      />

      {/* 知识网络（并入术语卡 · 关系图） */}
      <div className="mod" style={{ marginBottom: "2rem" }}>
        <header className="mod-head" style={{ cursor: "default" }}>
          <span className="mod-num">03</span>
          <h2 className="mod-title">知识网络</h2>
          <span className="mod-count">{terms.length} 术语 · 点击节点跳到下方词条</span>
        </header>
        <div className="mod-body">
          <div className="net-scroll">
            <KnowledgeGraph
              terms={terms}
              height={300}
              onNavigate={(id) => {
                if (id === "terms") {
                  document.getElementById(`term-row-0`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
            />
          </div>
          <div className="net-legend">
            <span><i style={{ background: "var(--ok)" }} />已掌握</span>
            <span><i style={{ background: "var(--amber)" }} />进行中</span>
            <span><i style={{ background: "var(--muted-foreground)" }} />未接触</span>
          </div>
        </div>
      </div>

      {/* 词汇表索引 */}
      <div className="term-index">
        <div className="term-head-row" aria-hidden="true">
          <span>编号</span>
          <span>术语</span>
          <span>角色 · 复用</span>
          <span>状态</span>
          <span>更新</span>
          <span style={{ textAlign: "right" }}>操作</span>
        </div>

        {loading ? (
          <p className="mono-label" style={{ padding: "1.5rem 0.3rem" }}>读取中…</p>
        ) : terms.length === 0 ? (
          <p style={{ padding: "1.5rem 0.3rem", fontStyle: "italic", fontFamily: "var(--font-lora)", color: "var(--muted-foreground)" }}>
            词汇表还是空的——从第一张卡开始。
          </p>
        ) : (
          terms.map((t, i) => (
            <article key={t.id} id={`term-row-${i}`} className="term-item">
              <span className="term-no">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="term-name">{t.name}</h3>
                {t.note && <p className="term-note">{t.note}</p>}
                {t.links && <p className="term-links">关联 → {t.links}</p>}
              </div>
              <div className="term-cell">
                <strong>{t.role}</strong>
                <br />
                {t.reuse}
              </div>
              <div>
                <select className="field field--mini" value={t.status}
                  onChange={(e) => void changeStatus(t, e.target.value)}
                  style={{ color: STATUS_COLOR[t.status] ?? undefined }}
                  aria-label={`${t.name} 的状态`}>
                  {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="term-cell">
                {t.updatedAt ? fmtDate(t.updatedAt) : "—"}
                <br />
                {Array.isArray(t.papers) && t.papers.length > 0 ? (
                  <span className="term-papers" style={{ opacity: 0.9 }}>
                    见于 {t.papers.length} 篇：
                    {t.papers.map((p, idx) => (
                      <span key={p.slug}>
                        {idx > 0 && "、"}
                        <Link href={`/read/${p.slug}`} style={{ textDecoration: "underline", cursor: "pointer" }}>{p.title.slice(0, 16)}</Link>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span style={{ opacity: 0.6 }}>出处 {t.source ? t.source.slice(0, 18) : "—"}</span>
                )}
              </div>
              <div className="term-actions">
                <button className="btn btn--ghost btn--quiet" onClick={() => startEdit(t)}>编辑</button>
                <button className="btn btn--ghost btn--danger-ghost btn--quiet" onClick={() => void remove(t.id)}>删除</button>
              </div>

              {editingId === t.id && (
                <div className="term-edit-panel">
                  <div className="ledger-grid" style={{ marginBottom: 0 }}>
                    <label className="field-label">
                      <span className="mono-label">名称</span>
                      <input className="field" value={editForm.name ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                    </label>
                    <label className="field-label">
                      <span className="mono-label">来源 / 历史出处</span>
                      <input className="field" value={editForm.source ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, source: e.target.value })} />
                    </label>
                    <label className="field-label">
                      <span className="mono-label">角色归类</span>
                      <select className="field" value={editForm.role ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                        {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="field-label">
                      <span className="mono-label">复用标记</span>
                      <select className="field" value={editForm.reuse ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, reuse: e.target.value })}>
                        {REUSE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </label>
                    <label className="field-label ledger-grid-full">
                      <span className="mono-label">当前先理解为</span>
                      <textarea className="field" rows={2} value={editForm.note ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
                    </label>
                    <label className="field-label ledger-grid-full">
                      <span className="mono-label">关联术语</span>
                      <input className="field" value={editForm.links ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, links: e.target.value })} />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.1rem" }}>
                    <button className="btn btn--primary" onClick={() => void saveEdit()}>保存修改</button>
                    <button className="btn btn--ghost" onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
