"use client";

import { useEffect, useState } from "react";

/** 全局环境（系统/内核/GPU/驱动/Python）独立卡片 —— 与 conda 环境卡分开。 */
export default function SystemPanel() {
  const [system, setSystem] = useState<Record<string, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/environments?system=1");
      const d = await r.json();
      setSystem(d.system ?? {});
    } catch { /* */ }
  }
  useEffect(() => { void load(); }, []);

  if (Object.keys(system).length === 0) return null;

  return (
    <div className="env-panel sys-panel">
      <div className="env-panel-head">
        <span className="mono-label">全局环境</span>
        <button className="btn btn--ghost btn--quiet" onClick={() => void load()}>刷新</button>
      </div>
      <div className="env-system-grid">
        {system.os && <span>系统 <b>{system.os}</b></span>}
        {system.kernel && <span>内核 <b>{system.kernel}</b></span>}
        {system.arch && <span>架构 <b>{system.arch}</b></span>}
        {system.gpu && <span>GPU <b>{system.gpu}</b></span>}
        {system.driver && <span>驱动 <b>{system.driver}</b></span>}
        {system.python && <span>系统 Python <b>{system.python}</b></span>}
      </div>
    </div>
  );
}
