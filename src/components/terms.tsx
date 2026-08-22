"use client";

import { useEffect, useState } from "react";
import type { Term } from "@/app/api/terms/route";
import PageHead from "@/components/page-head";

const ROLE_OPTIONS = [
  "感知/传感器", "状态估计/对齐", "场景表示/建图", "补全/学习机制",
  "控制/决策", "训练机制", "评估指标", "工程/部署", "领域背景",
];
const STATUS_OPTIONS = ["未接触", "有直觉", "能解释", "能对应论文", "能实现"];
const REUSE_OPTIONS = ["通用", "论文特有", "论文内特殊含义"];
export const STATUS_COLOR: Record<string, string> = {
  "未接触": "var(--muted-foreground)", "有直觉": "var(--accent)", "能解释": "var(--sage-ink)",
  "能对应论文": "var(--ok)", "能实现": "var(--ok)",
};

/** ISO → MM/DD 短日期（术语卡"更新于"痕迹） */
function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

const EMPTY = { name: "", role: "领域背景", reuse: "通用", note: "", source: "", links: "" };

export default function Terms() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Term>>({});
  const [newTerm, setNewTerm] = useState(EMPTY);
  const [tip, setTip] = useState("");

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

  async function saveNew() {
    if (!newTerm.name.trim()) return;
    const ok = await post({ term: newTerm });
    if (ok) {
      setNewTerm(EMPTY);
      setTip("✓ 已建档 · 首次出现即建档，历史出处随每次出现累积");
      setTimeout(() => setTip(""), 3000);
    }
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
        desc="每张卡记录你对一个术语的理解演化（8 字段），跨论文累积；首次出现即建档，已见术语带标记。"
        meta={terms.length > 0 ? `${terms.length} 张卡 · 最近更新 ${fmtDate(latestUpdate)}` : "词汇表还是空的 — 从第一张卡开始"}
      />

      {/* 建档台：带标签的记录表 */}
      <div className="ledger">
        <div className="ledger-head">
          <span className="ledger-title">新术语建档</span>
          <span className="mono-label">data/glossary.json · 纯文件可随时打开看</span>
        </div>
        <div className="ledger-grid">
          <label className="field-label">
            <span className="mono-label">名称（英文主名 / 中文旁注）</span>
            <input className="field" value={newTerm.name}
              onChange={(e) => setNewTerm({ ...newTerm, name: e.target.value })}
              placeholder="如：voxel grid / 体素网格" />
          </label>
          <label className="field-label">
            <span className="mono-label">来源（论文短名 + 节）</span>
            <input className="field" value={newTerm.source}
              onChange={(e) => setNewTerm({ ...newTerm, source: e.target.value })}
              placeholder="如：NSR / Method" />
          </label>
          <label className="field-label">
            <span className="mono-label">角色归类</span>
            <select className="field" value={newTerm.role}
              onChange={(e) => setNewTerm({ ...newTerm, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span className="mono-label">复用标记</span>
            <select className="field" value={newTerm.reuse}
              onChange={(e) => setNewTerm({ ...newTerm, reuse: e.target.value })}>
              {REUSE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="field-label ledger-grid-full">
            <span className="mono-label">当前先理解为（一句话直觉解释）</span>
            <textarea className="field" rows={2} value={newTerm.note}
              onChange={(e) => setNewTerm({ ...newTerm, note: e.target.value })}
              placeholder="内部可写：已有直觉 + 最小例子；跨论文时这里累积为 archive" />
          </label>
          <label className="field-label ledger-grid-full">
            <span className="mono-label">关联术语（分号分隔，只连必须一起理解的）</span>
            <input className="field" value={newTerm.links}
              onChange={(e) => setNewTerm({ ...newTerm, links: e.target.value })}
              placeholder="如：point cloud；occupancy" />
          </label>
        </div>
        <div className="composer-row">
          <span className="composer-hint">首次出现即建档</span>
          <div className="composer-actions">
            {tip && <span className="chat-saved">{tip}</span>}
            <button className="btn btn--primary" onClick={() => void saveNew()} disabled={!newTerm.name.trim()}>
              建档
            </button>
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
            <article key={t.id} className="term-item">
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
                <span style={{ opacity: 0.6 }}>出处 {t.source ? t.source.slice(0, 10) : "—"}</span>
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
