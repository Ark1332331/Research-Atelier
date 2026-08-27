"use client";

import { useEffect, useMemo, useState } from "react";

interface Env { name: string; python: string; torch: string; pkgCount: number; purpose: string; stage: string }
interface Pkg { name: string; version: string; build: string }

/** 这个环境"独特/关键"的特征包：核心版本 + 明显指示用途的库（不列 conda 共有基础包） */
const KEY_RE = /^(python|torch|torchvision|torchaudio|pytorch|cudatoolkit|cuda|nvidia-|numpy|numba|scipy|minkowski|isaac|omni|pxr|stable-worldmodel|gymnasium|mujoco|rsl_rl|rsl-rl|rl_games|robosuite|unitree|legged)/i;

export default function EnvironmentsPanel() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [purpose, setPurpose] = useState("");
  const [stage, setStage] = useState("");
  const [loadPkgs, setLoadPkgs] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [system, setSystem] = useState<Record<string, string>>({});

  async function load() {
    try {
      const r = await fetch("/api/environments");
      const d = await r.json();
      setEnvs(d.envs ?? []);
      setSystem(d.system ?? {});
    } catch { /* */ }
  }
  useEffect(() => { void load(); }, []);

  async function openEnv(name: string) {
    setOpen(name);
    setPkgs([]);
    setShowAll(false);
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

  const keyPkgs = useMemo(() => pkgs.filter((p) => KEY_RE.test(p.name)).slice(0, 40), [pkgs]);
  const shown = showAll ? pkgs : keyPkgs;

  return (
    <div className="env-panel">
      <div className="env-panel-head">
        <span className="mono-label">conda 环境卡</span>
        <button className="btn btn--ghost btn--quiet" onClick={() => void load()}>刷新</button>
      </div>
      {Object.keys(system).length > 0 && (
        <div className="env-system">
          <div className="env-system-title"><span className="mono-label">全局环境</span></div>
          <div className="env-system-grid">
            {system.os && <span>系统 <b>{system.os}</b></span>}
            {system.kernel && <span>内核 <b>{system.kernel}</b></span>}
            {system.arch && <span>架构 <b>{system.arch}</b></span>}
            {system.gpu && <span>GPU <b>{system.gpu}</b></span>}
            {system.driver && <span>驱动 <b>{system.driver}</b></span>}
            {system.python && <span>系统 Python <b>{system.python}</b></span>}
          </div>
        </div>
      )}
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
                  <span className="mono-label">
                    {showAll ? `全部包 ${pkgs.length}` : `特征包 ${keyPkgs.length}`}
                    {showAll && keyPkgs.length ? <button className="btn btn--ghost btn--quiet" style={{ marginLeft: "0.4rem" }} onClick={() => setShowAll(false)}>只看特征</button> : null}
                    {!showAll && pkgs.length > keyPkgs.length ? <button className="btn btn--ghost btn--quiet" style={{ marginLeft: "0.4rem" }} onClick={() => setShowAll(true)}>展开全部 {pkgs.length}</button> : null}
                  </span>
                  {loadPkgs && <span className="mono-label">采样中…</span>}
                  <ul>
                    {shown.slice(0, showAll ? 400 : 40).map((p, i) => (
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
