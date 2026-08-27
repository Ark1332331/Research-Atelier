"use client";

import { useEffect, useMemo, useState } from "react";

interface Env { name: string; python: string; torch: string; pkgCount: number; purpose: string; stage: string; keyPkgs?: { name: string; version: string }[] }
interface Pkg { name: string; version: string; build: string }

/** 无基线时本地"独特/关键"特征包：核心版本 + 明显指示用途的库（不列 conda 共有基础包） */
const KEY_RE = /^(python|torch|torchvision|torchaudio|pytorch|cudatoolkit|cuda|nvidia-|numpy|numba|scipy|minkowski|isaac|omni|pxr|stable-worldmodel|gymnasium|mujoco|rsl_rl|rsl-rl|rl_games|robosuite|unitree|legged)/i;

export default function EnvironmentsPanel() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [purpose, setPurpose] = useState("");
  const [stage, setStage] = useState("");
  const [loadPkgs, setLoadPkgs] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [baseline, setBaseline] = useState(""); // 基线环境名；空=不启用对比

  async function load() {
    try {
      const q = baseline ? `?baseline=${encodeURIComponent(baseline)}` : "";
      const r = await fetch(`/api/environments${q}`);
      const d = await r.json();
      setEnvs(d.envs ?? []);
    } catch { /* */ }
  }
  useEffect(() => { void load(); }, [baseline]);

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

  // 特征包来源：启用基线 → 用后端对比结果（相对基线的独有包/版本不同）；否则本地 KEY_RE。
  const keyPkgs = useMemo(() => {
    if (baseline) {
      const cur = envs.find((e) => e.name === open);
      return cur?.keyPkgs ?? [];
    }
    return pkgs.filter((p) => KEY_RE.test(p.name)).slice(0, 40);
  }, [baseline, envs, open, pkgs]);

  const shown = showAll ? pkgs : keyPkgs;

  return (
    <div className="env-panel">
      <div className="env-panel-head">
        <span className="mono-label">conda 环境卡</span>
        <button className="btn btn--ghost btn--quiet" onClick={() => void load()}>刷新</button>
      </div>

      {/* 基线环境选择（对比式特征包） */}
      <div className="env-baseline">
        <span className="mono-label">基线（对比）</span>
        <select className="field field--mini" value={baseline} onChange={(e) => { setBaseline(e.target.value); setOpen(null); }}>
          <option value="">不启用对比</option>
          {envs.map((e) => (
            <option key={e.name} value={e.name}>{e.name === "miniconda3" ? "base（miniconda 裸环境，推荐基线）" : e.name}</option>
          ))}
        </select>
        {baseline && <span className="mono-label">特征包 = 相对「{baseline === "miniconda3" ? "base" : baseline}」多装/版本不同</span>}
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
                  <span className="mono-label">
                    {showAll ? `全部包 ${pkgs.length}` : `特征包 ${keyPkgs.length}${baseline ? " · 对比基线" : ""}`}
                    {shown.length > 40 && <button className="btn btn--ghost btn--quiet" style={{ marginLeft: "0.4rem" }} onClick={() => setShowAll(!showAll)}>{showAll ? "只看特征" : `展开全部 ${pkgs.length}`}</button>}
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
