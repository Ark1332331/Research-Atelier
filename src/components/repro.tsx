"use client";

import { useEffect, useMemo, useState } from "react";
import ChatPanel from "@/components/chat-panel";
import Markdown from "@/components/markdown";
import PageHead from "@/components/page-head";

/** 复现六层（来源：AGENTS.md「分层推进」；每条注记与验收规则均来自项目真实记录 project_state.md R5–R7） */
interface Layer {
  id: string; name: string; note: string;
  goal: string;      // 这一层要推进到什么
  success: string;   // 完成标准（可验证）
  checks: string[];  // 具体可勾的验收规则：这一层要验证什么，逐条对表
  declared: "done" | "active" | "partial" | "pending";
  label: string;
}

const LAYERS: Layer[] = [
  { id: "L1", name: "概念复现", note: "讲清问题、方法、数据表示——这一层已完成（术语卡都建起来了）。", goal: "用你自己的话讲清「这篇论文要解决什么、输入输出是什么、为什么需要这一步」。", success: "能把整个链路讲给别人听。", declared: "done", label: "完成",
    checks: [
      "能用自己的话讲清链路：点云 → 位姿对齐 → 体素化 → c_i / f_i / k → 4D U-Net → pruning → height array → controller",
      "能指出这篇论文解决的是场景补全（把残缺地形点云补完整），不是直接教机器人迈腿",
      "能给术语卡里的每个术语一句直觉解释（点云 / 体素 / 占用 / 剪枝 / U-Net / baseline）",
      "能说出为什么需要把局部观测补成可靠场景再交给 controller，而不是直接让 controller 用残缺观测",
    ] },
  { id: "L2", name: "数据复现", note: "构造与论文一致的输入：点云 → 64³ 体素网格 + toy 数据集。下一步：对齐官方 IsaacGym 数据分布。", goal: "让数据集分布与论文一致（官方 IsaacGym 数据分布对齐）。", success: "数据分布对齐说明写进复现状态上下文。", declared: "active", label: "对齐中",
    checks: [
      "数据生成器能产出论文 5 类结构化地形（stairs / boxes / walls / poles / corridors），且参数落在论文给定范围（未给的如实标注为实现假设）",
      "current / previous 观测来自同一完整点云的局部可见子集，不是直接喂完整图",
      "position noise、随机 tilt、随机删点、outlier 增强只改观测，不改 complete ground-truth",
      "论文分辨率 0.05m / 64 grid 下 dropped_count = 0；3.2m 局部地图边界显式裁剪",
      "训练 / 验证样本用独立 seed 严格分离",
    ] },
  { id: "L3", name: "模型复现", note: "结构与论文对齐：4D 稀疏 U-Net + 逐层剪枝 + 自回归 rollout——已实现，但没超过 merge baseline。", goal: "把完整模型在真实数据上跑起来，结构逐项与论文对表。", success: "配置证据链齐全（每项超参标注来源）。", declared: "partial", label: "已实现",
    checks: [
      "骨干是 MinkowskiEngine 的空间 + 时间 4D 稀疏 encoder-decoder，不是普通 3D 稀疏库",
      "四次空间下采样 stride=[2,2,2,1]、时间 k 不下采样；四次生成式上采样",
      "四条 skip connection 对齐契约：decoder 生成候选继承同坐标 encoder 特征、新位置显式零特征、与候选共享 coordinate_map_key",
      "逐层 pruning 已接入 decoder 每层 forward（不是只做最终层）",
      "每个超参数标注了来源：论文给定 / 工程约束 / toy 暂定",
    ] },
  { id: "L4", name: "训练复现", note: "训练闭环可复现：toy 数据上跑通（学习模型补回 15/15）。", goal: "训练闭环在目标数据上稳定收敛，可复现。", success: "训练/评估脚本一条命令可重跑。", declared: "partial", label: "部分",
    checks: [
      "训练脚本一条命令可重跑，含固定 seed、Adam 0.01→0.0001 指数衰减、checkpoint 记录",
      "detached autoregressive rollout：上一帧模型估计按 pose delta 变换后作为 k=1，预测在 Tensor→点云边界 detach，不跨时间反传",
      "training 与论文 12-step rollout 的训练结论一致",
      "训练不会因解码层剪枝为空导致全部帧被 EmptyPruningError 跳过而永久退化（不能把退化当收敛）",
    ] },
  { id: "L5", name: "指标复现", note: "必须超过明确 baseline 才算成功——不能把 loss 下降当成功；当前没达成。", goal: "拿到超过 merge baseline 的确定性结论。", success: "结论伴随可追溯证据（命令/文件/行号）。", declared: "pending", label: "未达成",
    checks: [
      "在同一数据、同一 alpha 上同时给出 voxel precision / recall / F1 与 surface height MAE",
      "结果与明确 baseline（直接合并 current/history 观测）对比，且给出 baseline 的具体数值",
      "empty prediction（某层剪空）按 F1=0 记录，不用 top-1 fallback 掩盖",
      "模型指标必须超过 baseline 才算这一层通过；不超过就如实记负面结果，不调 alpha / channels / 训练步数掩盖",
      "每个结论附带可追溯证据（命令 / 文件 / 行号）",
    ] },
  { id: "L6", name: "论文级对齐", note: "全链路与论文数字对齐后，才能说「复现完成」。", goal: "全链路数字与论文对表，对齐或记录差异原因。", success: "能独立解释实验证明了什么、没证明什么。", declared: "pending", label: "待办",
    checks: [
      "全链路数字（P / R / F1 / height MAE / 成功率）与论文对表；不一致记录差异原因",
      "controller height-array 接口与真实消费该输入的 policy 对齐（187 维合同），并验证策略确实接受该输入产出动作",
      "能独立解释：实验证明了什么、没证明什么、还差什么才能下结论",
      "负面结果（当前未超 baseline）已如实记录进复现状态上下文，不删除、不粉饰",
    ] },
];

function parseEnvCards(md: string) {
  const cards: { title: string; body: string }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      if (cur) cards.push({ title: cur.title, body: cur.body.join("\n").trim() });
      cur = { title: h[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) cards.push({ title: cur.title, body: cur.body.join("\n").trim() });
  return cards.filter((c) => c.title);
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function RailIconD({ d, size = 13 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const TOOL_KEYS: { key: string; label: string; icon: string; contextKind?: string; saveLabel?: string; saveKind?: string }[] = [
  { key: "env", label: "环境管理", icon: "M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M4 4l1.4 1.4M10.6 10.6 12 12M4 12l1.4-1.4M10.6 5.4 12 4M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", contextKind: "environment" },
  { key: "checklist", label: "放行检查", icon: "M3 8.5 6.2 12 13 4.5" },
  { key: "handoff", label: "交接提示词", icon: "M13 6a5 5 0 1 0 .3 5M13 2.5V6h-3.5", saveLabel: "保存交接词", saveKind: "handoff" },
];

const TOOL_HINTS: Record<string, { title: string; note: string; hint: string }> = {
  env: { title: "环境管理", note: "环境诊断：三层定位（驱动/环境/项目）；每次会话先读环境卡，不重复问你。", hint: "描述你的环境问题或报错（或让它先读环境卡）。" },
  checklist: { title: "放行检查", note: "长训练 / 大安装前过一遍：运行时核验、资源预算、依赖风险、放行结论。", hint: "描述你的训练/部署计划，让它执行放行检查。" },
  handoff: { title: "交接提示词", note: "换会话/换模型前生成自包含交接词；完成后存进记忆。", hint: "描述当前任务/阶段，让它生成自包含交接提示词。" },
};

export default function Repro({ initialTool, onCloseTool }: {
  initialTool?: string | null;
  onCloseTool?: () => void;
}) {
  const [active, setActive] = useState<string | null>(initialTool ?? null);
  const [envMd, setEnvMd] = useState("");
  const [reproMd, setReproMd] = useState("");
  const [ctxOpen, setCtxOpen] = useState(false);
  const [q, setQ] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [promptCopied, setPromptCopied] = useState(false);
  const [advanceTip, setAdvanceTip] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/memory?kind=environment")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setEnvMd(d.content ?? ""); })
      .catch(() => {});
    fetch("/api/context?kind=repro")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setReproMd(d.content ?? ""); })
      .catch(() => {});
    if (initialTool) setTimeout(() => setActive(initialTool), 0);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /* 手动验收（localStorage）：推进后覆盖层的声明状态 */
  const manual = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("atelier-layer-manual") ?? "{}") as Record<string, string>;
    } catch { return {}; }
  }, []);

  const layers = LAYERS.map((l) => manual[l.id] ? { ...l, declared: "done" as const, label: `验收 ✓ ${manual[l.id]}` } : l);
  const doneCount = layers.filter((l) => l.declared === "done").length;
  const cur = layers.find((l) => l.declared === "active") ?? layers.find((l) => l.declared === "partial") ?? layers[layers.length - 1];
  const curIdx = layers.findIndex((l) => l.id === cur.id);
  const next = layers[curIdx + 1];
  /** 当前层验收是否全部勾选（含“已写回 context”一项） */
  const allCurChecks = cur.checks.every((_, i) => checks[cur.id + ":" + i]) && checks[cur.id + ":evidence"];

  /** 给 Codex / 外部编码代理的指挥话术（自包含：带本层「该检查什么」，让外部 agent 也知道怎么算对） */
  const codexPrompt = `【Research Atelier · 复现任务 · 阶段 ${cur.name}】\n\n当前状态：${cur.note}\n\n要推进的目标：\n${cur.goal}\n\n本层验收规则（请逐条给出证据，而不是只报「完成了」）：\n${cur.checks.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n完成标准：\n${cur.success}\n\n请在代码工作区推进本阶段，完成后回报：\n1. 每条验收规则到底做到没有（对应上面编号，给出证据）\n2. 结论（做到什么程度、证据在哪）\n3. 与完成标准的对照\n4. 阻塞项（如有，写清卡在哪）\n\n把结论写回 data/repro-context.md 的「当前状态」，我在这里验收。`;

  async function advance() {
    const passed = cur.checks.filter((_, i) => checks[cur.id + ":" + i]).length;
    const total = cur.checks.length + 1; // +1 = 已写回 context
    try {
      const res = await fetch("/api/memory?kind=profile");
      const data = await res.json();
      const existing = data.content ?? "";
      const stamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      const block = `\n\n## 复现推进（${stamp}）\n\n- 通过「${cur.name}」验收（${passed}/${total} 项检查全过）\n`;
      await fetch("/api/memory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "profile", content: existing + block }),
      });
      const m = JSON.parse(localStorage.getItem("atelier-layer-manual") ?? "{}");
      m[cur.id] = stamp;
      localStorage.setItem("atelier-layer-manual", JSON.stringify(m));
      setAdvanceTip(`✓ 已验收并推进：${cur.name} → ${next?.name ?? "完成"}`);
      // 推进后清空当前层勾选，避免留在下一层上
      const remaining: Record<string, boolean> = {};
      Object.keys(checks).forEach((k) => { if (!k.startsWith(cur.id + ":")) remaining[k] = checks[k]; });
      setChecks(remaining);
      setTimeout(() => { setAdvanceTip(""); window.dispatchEvent(new Event("atelier-stage-manual")); }, 2500);
    } catch { /* 保留状态 */ }
  }

  const envCards = useMemo(() => parseEnvCards(envMd), [envMd]);
  const query = q.trim().toLowerCase();
  const filteredCards = envCards.filter((c) => !query || c.title.toLowerCase().includes(query) || c.body.toLowerCase().includes(query));

  /* 工具详情（侧栏入口进入；代码导读已拆到独立页） */
  if (active) {
    const meta = TOOL_KEYS.find((t) => t.key === active)!;
    const hint = TOOL_HINTS[meta.key];
    return (
      <section>
        <PageHead num="05" name="实验复现" title={hint.title} desc={hint.note} meta="点开即用 · 提示词可查" />
        <ChatPanel toolKey={meta.key} hint={hint.hint} contextKind={meta.contextKind}
          saveLabel={meta.saveLabel} saveKind={meta.saveKind} />
        <button className="btn btn--ghost btn--quiet" style={{ marginTop: "2rem" }} onClick={() => { setActive(null); onCloseTool?.(); }}>
          ← 返回复现枢纽
        </button>
      </section>
    );
  }

  return (
    <section>
      <PageHead
        num="05" name="实验复现"
        title="实验复现"
        desc="复现枢纽：看清进度 + 给外部编码代理（Codex）一句指挥话术 + 回来验收推进；环境卡可搜索可复制。"
        meta="阶段 · 指挥 · 验收 · 坑点档案"
      />

      {/* 复现工具：上方四个小环节，点开即进入对应工具（每个都跟复现项目挂钩） */}
      <div className="reprotools">
        <div className="reprotools-title">
          <span className="mono-label">复现工具</span>
          <span className="mono-label" style={{ opacity: 0.5 }}>点开一个直接用（代码导读在左侧栏）</span>
        </div>
        <div className="reprotools-grid">
          {TOOL_KEYS.map((t) => (
            <button key={t.key} className="reprotool" onClick={() => { setActive(t.key); }}>
              <RailIconD d={t.icon} />
              <span className="reprotool-label">{t.label}</span>
              <span className="reprotool-note">
                {t.key === "env" ? "三层定位" : t.key === "checklist" ? "长跑前" : "换会话/模型"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 阶段仪表 */}
      <div className="repro-gauge">
        <div className="codex-card-head">
          <span className="mod-num">01</span>
          <h2 className="mod-title">复现进度</h2>
          <span className="mono-label" style={{ marginLeft: "auto" }}>{doneCount} / {layers.length} 完成</span>
        </div>
        <div className="gauge-bar" aria-hidden="true">
          {layers.map((l) => (
            <i key={l.id} className={l.declared === "done" ? "is-done" : l.declared === "active" || l.declared === "partial" ? "is-active" : ""} />
          ))}
        </div>
        <div className="gauge-labels">
          <span>概念 → 数据 → 模型 → 训练 → 指标 → 对齐</span>
          <span>当前：{cur.name}（{cur.label}）</span>
        </div>
        <div className="codex-prompt" style={{ background: "var(--panel-dark)", color: "var(--panel-dark-text)", borderColor: "var(--panel-dark)" }}>
          <b style={{ color: "var(--accent)" }}>给 Codex 的指挥：</b>{cur.goal}
          <br />
          <span style={{ color: "var(--panel-dark-muted)" }}>完成标准：{cur.success}</span>
        </div>
      </div>

      {/* Codex 接口：话术复制 + 验收清单 */}
      <div className="codex-card">
        <div className="codex-card-head">
          <span className="mod-num">02</span>
          <h2 className="mod-title">Codex 接口 · {cur.name}</h2>
          <span style={{ marginLeft: "auto" }}>
            <button
              className={`copy-btn${promptCopied ? " is-copied" : ""}`}
              onClick={async () => {
                if (await copyText(codexPrompt)) {
                  setPromptCopied(true);
                  setTimeout(() => setPromptCopied(false), 1500);
                }
              }}
            >
              {promptCopied ? "已复制 ✓" : "复制指挥话术"}
            </button>
          </span>
        </div>
        <div className="codex-prompt">{codexPrompt}</div>
        <div style={{ marginTop: "0.9rem" }}>
          <p className="mono-label" style={{ marginBottom: "0.3rem" }}>本层验收清单（逐条确认，满足后点「验收通过」）</p>
          {cur.checks.map((c, i) => (
            <label key={i} className="checklist-item">
              <input
                type="checkbox"
                checked={!!checks[cur.id + ":" + i]}
                onChange={(e) => setChecks((st) => ({ ...st, [cur.id + ":" + i]: e.target.checked }))}
              />
              <span>{c}</span>
            </label>
          ))}
          <label className="checklist-item">
            <input
              type="checkbox"
              checked={!!checks[cur.id + ":evidence"]}
              onChange={(e) => setChecks((st) => ({ ...st, [cur.id + ":evidence"]: e.target.checked }))}
            />
            <span>结论 + 证据路径已写回 data/repro-context.md</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginTop: "0.6rem" }}>
            <button className="btn btn--accent" disabled={!allCurChecks} onClick={() => void advance()}>验收通过 → 推进到下一层</button>
            {!allCurChecks && <span className="mono-label" style={{ opacity: 0.6 }}>勾完全部验收项后才能推进</span>}
            {advanceTip && <span className="obs-done">{advanceTip}</span>}
          </div>
        </div>
      </div>

      {/* 六层明细（点开看） */}
      <div className="mod" style={{ marginBottom: "1.6rem" }}>
        <header className="mod-head" style={{ cursor: "default" }}>
          <span className="mod-num">03</span>
          <h2 className="mod-title">复现路线</h2>
          <span className="mod-count">6 层 · 每一层的目标与完成标准</span>
        </header>
        <div className="mod-body">
          <div className="ladder">
            {layers.map((r) => (
              <div key={r.id} className={`ladder-item is-${r.declared}`}>
                <span className="ladder-num" aria-hidden="true" />
                <div>
                  <p className="ladder-name">{r.name}</p>
                  <p className="ladder-note">{r.note}</p>
                </div>
                <span className="ladder-state">{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 搜索 → 环境卡片库 */}
      <div className="search-input-wrap">
        <input className="search-input" placeholder="搜索环境卡 / 坑点…" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="搜索坑点档案" />
      </div>
      <h2 className="mod-title" id="env-cards" style={{ margin: "0 0 0.9rem" }}>环境卡 · 坑点档案</h2>
      {envCards.length === 0 ? (
        <p className="mono-label" style={{ padding: "1rem 0", lineHeight: 1.8 }}>
          还没有环境卡。把踩过的环境问题写进 data/environment.md，这里会自动变成可复制的卡片（侧栏「环境管理」可让 AI 帮你整理）。
        </p>
      ) : filteredCards.length === 0 ? (
        <p className="mono-label" style={{ padding: "1rem 0" }}>没有匹配「{q}」的环境卡。</p>
      ) : (
        filteredCards.map((c, i) => {
          const key = `${c.title}-${i}`;
          return (
            <div key={key} className="env-card">
              <div className="env-card-head">
                <h3 className="env-card-title">{c.title}</h3>
                <button className={`copy-btn${copiedKey === key ? " is-copied" : ""}`}
                  onClick={async () => {
                    if (await copyText(`# ${c.title}\n\n${c.body}`)) {
                      setCopiedKey(key);
                      setTimeout(() => setCopiedKey(null), 1500);
                    }
                  }}>
                  {copiedKey === key ? "已复制 ✓" : "复制"}
                </button>
              </div>
              <p className="env-card-body">{c.body}</p>
            </div>
          );
        })
      )}

      {/* 复现状态上下文 */}
      {reproMd && (
        <div className="mod" style={{ marginTop: "1.6rem" }}>
          <button className="mod-head" onClick={() => setCtxOpen((v) => !v)}>
            <span className="mod-num">04</span>
            <h2 className="mod-title">复现状态上下文</h2>
            <span className="mod-count">data/repro-context.md · 对话自动附带</span>
            <span className="mod-caret" aria-hidden="true">{ctxOpen ? "▾" : "▸"}</span>
          </button>
          {ctxOpen && (
            <div className="mod-body" style={{ maxHeight: "18rem", overflowY: "auto" }}>
              <div className="md-body"><Markdown>{reproMd}</Markdown></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
