"use client";

import type { Term } from "@/app/api/terms/route";

/** 术语卡抽屉：从任意位置点开查看术语详情（右上滑出） */
export default function TermDrawer({ term, onClose, onGoTerms }: {
  term: Term | null;
  onClose: () => void;
  onGoTerms?: () => void;
}) {
  if (!term) return null;
  return (
    <>
      <div className="drawer-mask" onClick={onClose} aria-hidden="true" />
      <aside className="term-drawer" role="dialog" aria-label={`术语 ${term.name}`}>
        <div className="drawer-head">
          <h3 className="drawer-title">{term.name}</h3>
          <button className="drawer-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="drawer-body">
          <div className="drawer-line">
            <span className="dl-key">角色归类</span>
            <p className="dl-val"><strong>{term.role}</strong> · {term.reuse}</p>
          </div>
          <div className="drawer-line">
            <span className="dl-key">当前理解</span>
            <p className="dl-val">{term.note ? <em>{term.note}</em> : "还没有写理解笔记。"}</p>
          </div>
          <div className="drawer-line">
            <span className="dl-key">历史出处</span>
            <p className="dl-val">{term.source || "—"}</p>
          </div>
          <div className="drawer-line">
            <span className="dl-key">关联术语</span>
            <p className="dl-val">{term.links ? term.links.split(/[；;]/).filter(Boolean).join(" · ") : "—"}</p>
          </div>
          <div className="drawer-line">
            <span className="dl-key">当前状态</span>
            <p className="dl-val">● {term.status}</p>
          </div>
          <div style={{ marginTop: "1.1rem", display: "flex", gap: "0.5rem" }}>
            <button className="btn btn--quiet" onClick={onGoTerms}>去术语卡管理 →</button>
          </div>
        </div>
      </aside>
    </>
  );
}
