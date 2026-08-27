"use client";

import { useEffect, useState } from "react";

interface Env { name: string; python: string; torch: string; pkgCount: number; purpose: string; stage: string }
interface Pkg { name: string; version: string; build: string }

/** 环境卡（复现工作台右侧内嵌）：列出所有 conda 环境 + 版本 + 用途编辑 + 点开看包 */
export default function EnvironmentsPanel() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [purpose, setPurpose] = useState("");
  const [stage, setStage] = useState("");
  const [loadPkgs, setLoadPkgs] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/environments");
      const d = await r.json();
      setEnvs(d.envs ?? []);
    } catch { /* */ }
  }
  useEffect(() => { void load(); }, []);

  async function openEnv(name: string) {
    setOpen(name);
    setPkgs([]);
    setLoadPkgs(true);
    try {
      const r = await fetch(`/api/environments?name=${encodeURIComponent(name)}`);
      const d = await r.json();
      setPkgs(d.packages ?? []);
      setPurpose(d.purpose ?? "");
    } catch { /* */ }
    setLoadPkgs(false);
  }

  async function save() {
    if (!open) return;
    try {
      await fetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: open, purpose, stage }),
      });
      void load();
    } catch { /* */ }
  }

  return (
    <div className="env-panel">
      <div className="env-panel-head">
        <span className="mono-label">conda 环境卡</span>
        <button className="btn btn--ghost btn--quiet" onClick={() => void load()}>刷新</button>
      </div>
      {envs.length === 0 && <p className="mono-label">未读到环境（非本机或需 ra_conda_bin）</p>}
      <ul className="env-list">
        {envs.map((e) => (
          <li key={e.name} className={`env-item${open === e.name ? " is-open" : ""}`}>
            <div className="env-row" onClick={() => void openEnv(e.name)}>
              <span className="env-name">{e.name}</span>
              <span className="env-ver">{e.python ? `py ${e.python}` : ""}{e.torch ? ` · ${e.torch}` : ""}{e.pkgCount ? ` · ${e.pkgCount}pkg` : ""}</span>
            </div>
            {e.purpose && <div className="env-purpose" style={{ opacity: 0.7 }}>{e.purpose}</div>}
            {open === e.name && (
              <div className="env-detail">
                <div className="env-edit">
                  <input className="field field--mini" value={purpose} onChange={(ev) => setPurpose(ev.target.value)} placeholder="这个环境用来做什么（如 R6 仿真）" />
                  <input className="field field--mini" value={stage} onChange={(ev) => setStage(ev.target.value)} placeholder="关联阶段（如 R6）" />
                  <button className="btn btn--ghost btn--quiet" onClick={() => void save()}>保存用途</button>
                </div>
                <div className="env-pkgs">
                  <span className="mono-label">包（{pkgs.length}）</span>
                  {loadPkgs && <span className="mono-label">采样中…</span>}
                  <ul>
                    {pkgs.slice(0, 120).map((p, i) => (
                      <li key={i}><span className="pkg-name">{p.name}</span><span className="pkg-ver">{p.version}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
