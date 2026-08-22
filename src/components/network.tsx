"use client";

import { useEffect, useState } from "react";
import type { Term } from "@/app/api/terms/route";
import PageHead from "@/components/page-head";
import { KnowledgeGraph } from "@/components/dashboard";
import { STATUS_COLOR } from "@/components/terms";

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export default function Network({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setTerms(d.terms ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const latest = terms.reduce((max, t) => (t.updatedAt > max ? t.updatedAt : max), "");

  return (
    <section>
      <PageHead
        num="04" name="知识网络"
        title="知识网络"
        desc="术语与论文的关系图——连线来自术语卡的「关联」字段，知识正在增长。点击节点跳转到术语卡。"
        meta={`${terms.length} 术语 · 最近更新 ${latest ? fmtDate(latest) : "—"}`}
      />

      <div className="mod">
        <header className="mod-head">
          <span className="mod-num">04</span>
          <h2 className="mod-title">关联图</h2>
          <span className="mod-count">中心 = 当前论文 · 外圈 = 术语</span>
        </header>
        <div className="mod-body">
          {loading ? (
            <p className="mono-label" style={{ padding: "2rem 0" }}>读取术语卡中…</p>
          ) : (
            <>
              <div className="net-scroll"><KnowledgeGraph terms={terms} onNavigate={onNavigate} height={340} /></div>
              <div className="net-legend">
                <span><i style={{ background: "var(--ok)" }} />已掌握</span>
                <span><i style={{ background: "var(--accent)" }} />进行中</span>
                <span><i style={{ background: "var(--amber)" }} />有直觉</span>
                <span><i style={{ background: "var(--muted-foreground)" }} />未接触</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 术语明细表 */}
      <div className="term-index" style={{ marginTop: "1.6rem" }}>
        <div className="term-head-row" aria-hidden="true">
          <span>编号</span>
          <span>术语</span>
          <span>角色</span>
          <span>状态</span>
          <span>更新</span>
          <span style={{ textAlign: "right" }}>操作</span>
        </div>
        {terms.map((t, i) => (
          <article key={t.id} className="term-item">
            <span className="term-no">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3 className="term-name">{t.name}</h3>
              {t.note && <p className="term-note">{t.note}</p>}
              {t.links && <p className="term-links">关联 → {t.links}</p>}
            </div>
            <div className="term-cell"><strong>{t.role}</strong></div>
            <div className="term-cell" style={{ color: STATUS_COLOR[t.status] ?? undefined }}>● {t.status}</div>
            <div className="term-cell">{t.updatedAt ? fmtDate(t.updatedAt) : "—"}</div>
            <div className="term-actions">
              <button className="btn btn--ghost btn--quiet" onClick={() => onNavigate?.("terms")}>管理</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
