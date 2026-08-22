"use client";

import { useEffect, useState } from "react";
import { TOOLS } from "@/lib/data";
import Markdown from "@/components/markdown";
import type { Term } from "@/app/api/terms/route";

type ToolId = "p0" | "p3" | "env" | "code" | "handoff" | "checklist" | "terms" | "profile";

const TOOL_ORDER: ToolId[] = ["p0", "p3", "terms", "profile", "env", "code", "handoff", "checklist"];

const TOOL_LABELS: Record<ToolId, string> = {
  p0: "论文筛选",
  p3: "精读讲解",
  terms: "术语卡",
  profile: "研究档案",
  env: "环境管理",
  code: "代码导读",
  handoff: "交接提示词",
  checklist: "放行检查",
};

const MEMORY_KINDS: { id: string; label: string; hint: string }[] = [
  { id: "profile", label: "知识水平记录", hint: "从 0 累积，不由你自评；每次学习会话后更新。" },
  { id: "environment", label: "环境卡", hint: "三层地图 + 已知坑点 + 分级验收；AI 每次会话先读它，不重复问你。" },
  { id: "handoff", label: "交接词", hint: "换会话/换模型时的自包含交接提示词（追加式）。" },
];

const HINTS: Record<string, string> = {
  p0: "第一条消息直接给领域 + 目标 + 子问题 + 时间预算，例如：\u201c我想了解 world model 最近为什么火；预算 60 分钟\u201d。",
  p3: "贴一段论文的方法/实现文字（或你的问题），它会按 8 步讲解流程带你读懂。",
  env: "描述你的环境问题或报错（或让它先读你的环境卡）。",
  code: "给出代码文件路径 + 你的问题（或让它按导读协议带你读）。",
  handoff: "描述当前任务/阶段，让它生成自包含交接提示词。",
  checklist: "描述你的训练/部署计划，让它执行放行检查。",
};

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STATUS_OPTIONS = ["未接触", "有直觉", "能解释", "能对应论文", "能实现"];
const REUSE_OPTIONS = ["通用", "论文特有", "论文内特殊含义"];
const ROLE_OPTIONS = [
  "感知/传感器", "状态估计/对齐", "场景表示/建图", "补全/学习机制",
  "控制/决策", "训练机制", "评估指标", "工程/部署", "领域背景",
];
const STATUS_COLOR: Record<string, string> = {
  "未接触": "#6B6560", "有直觉": "#8B2635", "能解释": "#1C3A5E",
  "能对应论文": "#2D6A4F", "能实现": "#2D6A4F",
};

export default function Workspace({ onBack }: { onBack: () => void }) {
  const [active, setActive] = useState<ToolId>("p0");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  // 术语卡状态
  const [terms, setTerms] = useState<Term[]>([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [newTerm, setNewTerm] = useState({ name: "", role: "领域背景", note: "" });
  const [savedTip, setSavedTip] = useState("");

  // 记忆文件状态（知识水平/环境卡/交接词）
  const [memKind, setMemKind] = useState("profile");
  const [memContent, setMemContent] = useState("");
  const [memLoading, setMemLoading] = useState(false);
  const [memSaved, setMemSaved] = useState(false);
  const [saveTip, setSaveTip] = useState("");

  const tool = TOOLS[active as Exclude<ToolId, "terms" | "profile">];

  useEffect(() => {
    if (active !== "profile") return;
    let cancelled = false;
    fetch(`/api/memory?kind=${memKind}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setMemContent(data.content ?? ""); })
      .catch(() => { if (!cancelled) setMemContent(""); })
      .finally(() => { if (!cancelled) setMemLoading(false); });
    return () => { cancelled = true; };
  }, [active, memKind]);

  useEffect(() => {
    if (active !== "terms") return;
    let cancelled = false;
    fetch("/api/terms")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setTerms(data.terms ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTermsLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  async function sendMsg() {
    const text = input.trim();
    if (!text || loading || !tool) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: tool.prompt }, ...next],
        }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setMsgs([
        ...next,
        { role: "assistant", content: content ?? (data?.error ? `错误：${data.error}` : "无响应") },
      ]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `请求失败：${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function saveNewTerm() {
    if (!newTerm.name.trim()) return;
    const res = await fetch("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: newTerm }),
    });
    if (res.ok) {
      setNewTerm({ name: "", role: "领域背景", note: "" });
      setSavedTip("✓ 已建档（首次出现即建档，历史出处随每次出现累积）");
      setTimeout(() => setSavedTip(""), 2500);
      const refreshed = await res.json();
      setTerms(refreshed.terms ?? []);
    }
  }

  async function updateStatus(t: Term, status: string) {
    const res = await fetch("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: { ...t, status } }),
    });
    if (res.ok) {
      const data = await res.json();
      setTerms(data.terms ?? []);
    }
  }

  // 术语编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Term>>({});

  function startEdit(t: Term) {
    setEditingId(t.id);
    setEditForm({ name: t.name, role: t.role, reuse: t.reuse, note: t.note, links: t.links, source: t.source });
  }

  async function saveEdit() {
    if (!editingId || !editForm.name?.trim()) return;
    const res = await fetch("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: { id: editingId, ...editForm } }),
    });
    if (res.ok) {
      const data = await res.json();
      setTerms(data.terms ?? []);
      setEditingId(null);
    }
  }

  async function deleteTerm(id: string) {
    const res = await fetch("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteId: id }),
    });
    if (res.ok) {
      const data = await res.json();
      setTerms(data.terms ?? []);
    }
  }

  async function saveMem() {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: memKind, content: memContent }),
    });
    if (res.ok) {
      setMemSaved(true);
      setTimeout(() => setMemSaved(false), 1500);
    }
  }

  /** 把对话执行结果存进记忆文件（p0 → 筛选笔记；handoff → 交接词） */
  async function saveResult() {
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant") return;
    const kind = active === "p0" ? "screening" : "handoff";
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, content: last.content }),
    });
    if (res.ok) {
      setSaveTip(kind === "screening" ? "✓ 已存入 data/notes/screening.md（可随时打开看）" : "✓ 已存入 data/handoffs.md");
      setTimeout(() => setSaveTip(""), 3000);
    }
  }

  const switchTool = (id: ToolId) => {
    setActive(id);
    setMsgs([]);
    setShowPrompt(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)",
      display: "grid", gridTemplateColumns: "210px 1fr", gridTemplateRows: "auto 1fr" }}>

      {/* Header */}
      <header style={{ gridColumn: "1 / -1", borderBottom: "1px solid var(--border)",
        padding: "0.9rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <button onClick={onBack} style={{ background: "transparent", border: "1px solid var(--border)",
            borderRadius: 2, padding: "0.3rem 0.8rem", cursor: "pointer",
            fontFamily: "var(--font-dm-mono)", fontSize: "0.62rem", letterSpacing: "0.06em",
            color: "var(--muted-foreground)" }}>← 档案</button>
          <span style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: "0.92rem", letterSpacing: "0.02em" }}>
            Research Atelier</span>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem",
            color: "var(--muted-foreground)", borderLeft: "1px solid var(--border)",
            paddingLeft: "1.2rem", letterSpacing: "0.05em" }}>工作区</span>
        </div>
        <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
          color: "var(--muted-foreground)", letterSpacing: "0.08em" }}>
          AI 是研究伴侣，不是聊天机器人
        </div>
      </header>

      {/* Side nav */}
      <nav style={{ borderRight: "1px solid var(--border)", padding: "1.5rem 0", overflowY: "auto" }}>
        {TOOL_ORDER.map((id) => (
          <button key={id} onClick={() => switchTool(id)} style={{
            display: "block", width: "100%", textAlign: "left",
            padding: "0.55rem 1.8rem", cursor: "pointer", background: "transparent",
            border: "none", borderLeft: active === id ? "2px solid #8B2635" : "2px solid transparent",
            fontFamily: "var(--font-inter)", fontSize: "0.78rem",
            fontWeight: active === id ? 500 : 400,
            color: active === id ? "var(--foreground)" : "var(--muted-foreground)",
          }}>
            {TOOL_LABELS[id]}
          </button>
        ))}
      </nav>

      {/* Main area */}
      <main style={{ padding: "2rem 2.5rem", overflowY: "auto", minWidth: 0 }}>
        {active === "terms" ? (
          /* ============ 术语卡管理 ============ */
          <section>
            <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", letterSpacing: "0.16em",
              textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "0.8rem" }}>
              术语卡 · 词汇表
            </p>
            <h1 style={{ fontFamily: "var(--font-lora)", fontSize: "1.5rem", fontWeight: 600,
              marginBottom: "0.4rem" }}>跨论文词汇表</h1>
            <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.8rem",
              color: "var(--muted-foreground)", marginBottom: "1.8rem" }}>
              首次出现即建档；已见术语带“已入词汇表”标记；通用技术术语可查 vibe-hub.org。
            </p>

            {/* 新增表单 */}
            <div style={{ border: "1px solid var(--border)", borderRadius: 2,
              padding: "1.2rem", marginBottom: "2rem", background: "var(--card)" }}>
              <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem", letterSpacing: "0.12em",
                textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "0.8rem" }}>
                新术语建档</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 1fr", gap: "0.8rem", marginBottom: "0.8rem" }}>
                <input value={newTerm.name} onChange={(e) => setNewTerm({ ...newTerm, name: e.target.value })}
                  placeholder="英文主名 / 中文旁注（如：voxel grid / 体素网格）"
                  style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                    padding: "0.5rem 0.7rem", fontFamily: "var(--font-inter)", fontSize: "0.8rem", color: "var(--foreground)" }} />
                <select value={newTerm.role} onChange={(e) => setNewTerm({ ...newTerm, role: e.target.value })}
                  style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                    padding: "0.5rem 0.7rem", fontFamily: "var(--font-inter)", fontSize: "0.8rem", color: "var(--foreground)" }}>
                  {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                <input value={newTerm.note} onChange={(e) => setNewTerm({ ...newTerm, note: e.target.value })}
                  placeholder="当前先理解为…（一句话直觉解释）"
                  style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                    padding: "0.5rem 0.7rem", fontFamily: "var(--font-inter)", fontSize: "0.8rem", color: "var(--foreground)" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <button onClick={saveNewTerm} disabled={!newTerm.name.trim()}
                  style={{ border: "1px solid #8B2635", borderRadius: 2, background: "#8B2635",
                    color: "#F7F4EF", padding: "0.45rem 1.2rem", cursor: "pointer",
                    fontFamily: "var(--font-inter)", fontSize: "0.78rem" }}>建档</button>
                {savedTip && <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "#2D6A4F" }}>{savedTip}</span>}
              </div>
            </div>

            {/* 列表 */}
            {termsLoading ? (
              <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "var(--muted-foreground)" }}>读取中…</p>
            ) : terms.length === 0 ? (
              <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                词汇表还是空的——从第一张卡开始。
              </p>
            ) : (
              <div>
                {terms.map((t) => (
                  <div key={t.id} style={{ borderBottom: "1px solid var(--border)", padding: "1.1rem 0" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "1rem" }}>
                      <span style={{ fontFamily: "var(--font-lora)", fontSize: "0.95rem", fontWeight: 500 }}>
                        {t.name}</span>
                      <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
                        color: "var(--muted-foreground)" }}>{t.role}</span>
                      <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
                        color: "var(--muted-foreground)", opacity: 0.7 }}>{t.reuse}</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
                        color: STATUS_COLOR[t.status] ?? "var(--muted-foreground)" }}>● {t.status}</span>
                    </div>
                    {t.note && (
                      <p style={{ fontFamily: "var(--font-lora)", fontStyle: "italic", fontSize: "0.78rem",
                        color: "var(--muted-foreground)", marginTop: "0.3rem", lineHeight: 1.6 }}>{t.note}</p>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.5rem" }}>
                      <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
                        color: "var(--muted-foreground)" }}>状态升级（AI 当场验收后升）</span>
                      <select value={t.status}
                        onChange={(e) => updateStatus(t, e.target.value)}
                        style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                          padding: "0.2rem 0.4rem", fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "var(--foreground)" }}>
                        {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                      </select>
                      <span style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                        <button onClick={() => startEdit(t)}
                          style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 2,
                            padding: "0.2rem 0.6rem", cursor: "pointer", fontFamily: "var(--font-dm-mono)",
                            fontSize: "0.55rem", color: "var(--muted-foreground)" }}>编辑</button>
                        <button onClick={() => deleteTerm(t.id)}
                          style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 2,
                            padding: "0.2rem 0.6rem", cursor: "pointer", fontFamily: "var(--font-dm-mono)",
                            fontSize: "0.55rem", color: "#8B2635" }}>删除</button>
                      </span>
                    </div>

                    {/* 编辑展开区 */}
                    {editingId === t.id && (
                      <div style={{ border: "1px solid var(--border)", borderRadius: 2, padding: "1rem",
                        marginTop: "0.8rem", background: "var(--card)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", gap: "0.6rem", marginBottom: "0.6rem" }}>
                          <input value={editForm.name ?? ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            placeholder="名称（英文主名 / 中文旁注）"
                            style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                              padding: "0.4rem 0.6rem", fontFamily: "var(--font-inter)", fontSize: "0.78rem" }} />
                          <select value={editForm.role ?? ""} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                            style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                              padding: "0.4rem 0.6rem", fontFamily: "var(--font-inter)", fontSize: "0.78rem" }}>
                            {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                          </select>
                          <select value={editForm.reuse ?? ""} onChange={(e) => setEditForm({ ...editForm, reuse: e.target.value })}
                            style={{ border: "1px solid var(--border)", borderRadius: 2, background: "var(--background)",
                              padding: "0.4rem 0.6rem", fontFamily: "var(--font-inter)", fontSize: "0.78rem" }}>
                            {REUSE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                        <textarea value={editForm.note ?? ""} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                          placeholder="当前先理解为…"
                          rows={2}
                          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 2,
                            background: "var(--background)", padding: "0.4rem 0.6rem",
                            fontFamily: "var(--font-inter)", fontSize: "0.78rem", resize: "vertical", marginBottom: "0.6rem" }} />
                        <input value={editForm.links ?? ""} onChange={(e) => setEditForm({ ...editForm, links: e.target.value })}
                          placeholder="关联术语（分号分隔）"
                          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 2,
                            background: "var(--background)", padding: "0.4rem 0.6rem",
                            fontFamily: "var(--font-inter)", fontSize: "0.78rem", marginBottom: "0.6rem" }} />
                        <div style={{ display: "flex", gap: "0.6rem" }}>
                          <button onClick={() => void saveEdit()}
                            style={{ border: "1px solid #8B2635", borderRadius: 2, background: "#8B2635",
                              color: "#F7F4EF", padding: "0.35rem 1rem", cursor: "pointer",
                              fontFamily: "var(--font-inter)", fontSize: "0.72rem" }}>保存修改</button>
                          <button onClick={() => setEditingId(null)}
                            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 2,
                              padding: "0.35rem 1rem", cursor: "pointer", fontFamily: "var(--font-inter)",
                              fontSize: "0.72rem", color: "var(--muted-foreground)" }}>取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : active === "profile" ? (
          /* ============ 研究档案（记忆文件） ============ */
          <section>
            <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", letterSpacing: "0.16em",
              textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "0.8rem" }}>
              研究档案 · 记忆层
            </p>
            <h1 style={{ fontFamily: "var(--font-lora)", fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.4rem" }}>
              我的记忆</h1>
            <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.8rem",
              color: "var(--muted-foreground)", marginBottom: "1.5rem" }}>
              纯 Markdown 文件（data/ 目录），可随时打开看和改——这是你的控制感来源。
            </p>

            <div style={{ display: "flex", gap: 0, marginBottom: "1.2rem" }}>
              {MEMORY_KINDS.map((k) => (
                <button key={k.id} onClick={() => { setMemKind(k.id); setMemSaved(false); }}
                  style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem", letterSpacing: "0.06em",
                    padding: "0.4rem 0.9rem", cursor: "pointer", background: memKind === k.id ? "var(--secondary)" : "transparent",
                    border: "1px solid var(--border)", borderRight: "none", marginLeft: -1,
                    color: memKind === k.id ? "var(--foreground)" : "var(--muted-foreground)" }}>
                  {k.label}
                </button>
              ))}
            </div>

            {MEMORY_KINDS.filter((k) => k.id === memKind).map((k) => (
              <p key={k.id} style={{ fontFamily: "var(--font-inter)", fontSize: "0.78rem",
                fontStyle: "italic", color: "var(--muted-foreground)", marginBottom: "0.8rem" }}>{k.hint}</p>
            ))}

            {memLoading ? (
              <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "var(--muted-foreground)" }}>读取中…</p>
            ) : (
              <>
                <textarea value={memContent} onChange={(e) => setMemContent(e.target.value)}
                  rows={18}
                  style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 2,
                    background: "var(--card)", padding: "0.9rem", fontFamily: "'DM Mono', monospace",
                    fontSize: "0.72rem", lineHeight: 1.6, color: "var(--foreground)", resize: "vertical" }} />
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.8rem" }}>
                  <button onClick={() => void saveMem()}
                    style={{ border: "1px solid #8B2635", borderRadius: 2, background: "#8B2635",
                      color: "#F7F4EF", padding: "0.45rem 1.4rem", cursor: "pointer",
                      fontFamily: "var(--font-inter)", fontSize: "0.78rem" }}>保存</button>
                  {memSaved && <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "#2D6A4F" }}>✓ 已保存到文件</span>}
                </div>
              </>
            )}
          </section>
        ) : tool ? (
          /* ============ 对话式执行 ============ */
          <section style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
            <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", letterSpacing: "0.16em",
              textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "0.4rem" }}>
              {tool.title}</p>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
              <h1 style={{ fontFamily: "var(--font-lora)", fontSize: "1.5rem", fontWeight: 600 }}>执行</h1>
              <button onClick={() => setShowPrompt((v) => !v)}
                style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 2,
                  padding: "0.25rem 0.7rem", cursor: "pointer", fontFamily: "var(--font-dm-mono)",
                  fontSize: "0.58rem", color: "var(--muted-foreground)" }}>
                {showPrompt ? "收起提示词" : "查看底层提示词"}</button>
            </div>

            {showPrompt && (
              <div style={{ border: "1px solid #D4CEC6", background: "#EFECE6", borderRadius: 2,
                padding: "1rem", marginBottom: "1.5rem", maxHeight: "12rem", overflowY: "auto" }}>
                <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem", letterSpacing: "0.1em",
                  color: "#8B2635", marginBottom: "0.5rem" }}>底层系统提示词（可见可查）</p>
                <pre style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", whiteSpace: "pre-wrap",
                  color: "var(--muted-foreground)", lineHeight: 1.6 }}>{tool.prompt}</pre>
              </div>
            )}

            {/* 消息区（无气泡：研究助理注记风格） */}
            <div style={{ flex: 1, borderTop: "1px solid var(--border)", paddingTop: "1.5rem",
              display: "flex", flexDirection: "column", gap: "1.4rem", maxHeight: "52vh", overflowY: "auto" }}>
              {msgs.length === 0 && (
                <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.8rem",
                  color: "var(--muted-foreground)", fontStyle: "italic", lineHeight: 1.7,
                  borderLeft: "1px solid var(--border)", paddingLeft: "1rem" }}>{HINTS[active]}</p>
              )}
              {msgs.map((m, i) => (
                <div key={i}>
                  <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem", letterSpacing: "0.08em",
                    textTransform: "uppercase", color: m.role === "user" ? "#8B2635" : "var(--muted-foreground)",
                    marginBottom: "0.3rem" }}>{m.role === "user" ? "我的记录" : "研究伴侣 · AI 观察"}</p>
                  {m.role === "user" ? (
                    <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.82rem", lineHeight: 1.7,
                      color: "var(--foreground)" }}>{m.content}</p>
                  ) : (
                    <div style={{ fontFamily: "var(--font-inter)", fontSize: "0.82rem", color: "var(--foreground)" }}>
                      <Markdown>{m.content}</Markdown>
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "var(--muted-foreground)" }}>
                  思考中…
                </p>
              )}
            </div>

            {/* 输入区 */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.2rem", marginTop: "1.2rem" }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMsg(); } }}
                placeholder="回复它的问题，或直接开始…（Enter 发送）"
                rows={2}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 2,
                  background: "var(--card)", padding: "0.7rem", fontFamily: "var(--font-inter)",
                  fontSize: "0.82rem", color: "var(--foreground)", resize: "vertical" }} />
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "1rem", marginTop: "0.6rem" }}>
                {saveTip && <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", color: "#2D6A4F" }}>{saveTip}</span>}
                {(active === "p0" || active === "handoff") && msgs.length > 0 && (
                  <button onClick={() => void saveResult()}
                    style={{ border: "1px solid var(--border)", borderRadius: 2, background: "transparent",
                      padding: "0.45rem 1rem", cursor: "pointer", fontFamily: "var(--font-dm-mono)",
                      fontSize: "0.6rem", color: "var(--muted-foreground)" }}>
                    {active === "p0" ? "保存为筛选笔记" : "保存交接词"}
                  </button>
                )}
                <button onClick={() => void sendMsg()} disabled={loading || !input.trim()}
                  style={{ border: "1px solid #8B2635", borderRadius: 2, background: "#8B2635",
                    color: "#F7F4EF", padding: "0.45rem 1.4rem", cursor: "pointer",
                    fontFamily: "var(--font-inter)", fontSize: "0.78rem" }}>发送</button>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
