"use client";

import { useState } from "react";

interface DirItem { name: string; path: string; git: boolean }
interface BrowseData { path: string; parent: string | null; name: string; dirs: DirItem[]; git: boolean }

/** 本机目录选择器弹窗：逐层点进子目录，选到目标文件夹返回绝对路径。 */
export default function DirPicker({
  onPick, onClose,
}: {
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<{ path: string; dirs: DirItem[]; parent: string | null; git: boolean } | null>(null);
  const [crumbs, setCrumbs] = useState<{ name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(path?: string, crumbStack?: { name: string; path: string }[]) {
    setLoading(true);
    try {
      const r = await fetch(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);
      const d = await r.json();
      if (d.error) { if (!path) setView(null); }
      else {
        setView({ path: d.path, dirs: d.dirs, parent: d.parent, git: d.git });
        setCrumbs(crumbStack ?? []);
      }
    } catch { /* */ }
    setLoading(false);
  }

  function enter(d: DirItem) {
    setCrumbs((c) => [...c, { name: d.name, path: d.path }]);
    void load(d.path);
  }
  function up() {
    if (!view?.parent) return;
    const c = viewedCrumbs(view);
    void load(view.parent, c.slice(0, -1));
  }
  function viewedCrumbs(v: { path: string }) {
    // 面包屑 = 从根到当前；用于回退时截断
    return crumbs;
  }

  return (
    <div className="dirpicker-backdrop" onClick={onClose}>
      <div className="dirpicker" onClick={(e) => e.stopPropagation()}>
        <div className="dirpicker-head">
          <span className="mono-label">选择本地代码目录</span>
          <button className="btn btn--ghost btn--quiet" onClick={onClose}>×</button>
        </div>

        {/* 面包屑 */}
        <div className="dirpicker-crumbs">
          <button className="btn btn--ghost btn--quiet" onClick={() => { setCrumbs([]); void load(); }}>根</button>
          {crumbs.map((c) => (
            <button key={c.path} className="btn btn--ghost btn--quiet" onClick={() => { const idx = crumbs.findIndex((x) => x.path === c.path); void load(c.path, crumbs.slice(0, idx + 1)); }}>/{c.name}</button>
          ))}
          {view && <span className="mono-label">当前：{view.path}</span>}
        </div>

        <div className="dirpicker-list">
          {loading && <span className="mono-label" style={{ opacity: 0.6 }}>加载中…</span>}
          {!loading && view && (
            <>
              {view.parent && (
                <div className="dirpicker-item dirpicker-up" onClick={up}>← 上一级</div>
              )}
              {view.dirs.length === 0 && <p className="mono-label" style={{ opacity: 0.6 }}>（无子目录）</p>}
              {view.dirs.map((d) => (
                <div key={d.path} className={`dirpicker-item${d.git ? " is-git" : ""}`} onClick={() => enter(d)}>
                  <span>{d.name}</span>
                  {d.git && <span className="chip chip--dark" style={{ marginLeft: "auto" }}>git</span>}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="dirpicker-foot">
          {view && <span className="mono-label" style={{ opacity: 0.7 }}>{view.path}</span>}
          <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto" }}>
            <button className="btn btn--ghost btn--quiet" onClick={onClose}>取消</button>
            <button className="btn btn--primary" disabled={!view} onClick={() => view && onPick(view.path)}>选择此目录</button>
          </div>
        </div>
      </div>
    </div>
  );
}
