"use client";

import { useEffect, useRef, useState } from "react";
import { TOOLS } from "@/lib/data";
import Markdown from "@/components/markdown";

export interface CodeSessionEnd {
  explained: string[];
  blocked: string[];
  passed: boolean;
}

export interface ChatPanelProps {
  toolKey: string;          // TOOLS 中的键（p0/p3/env/code/handoff/checklist）
  hint: string;             // 开场提示（第一条消息发什么）
  saveLabel?: string;       // 保存按钮文案（如"保存为筛选笔记"）
  saveKind?: string;        // 保存到记忆文件的 kind（screening/handoff）
  onSaved?: (tip: string) => void;
  contextKind?: string;     // 自动附加的上下文（repro=复现状态 / environment=环境卡+指导者提醒）
  systemExtra?: string;     // 自动附加的正文/材料（如论文正文），对话自动带上
  attachedCode?: { name: string; content: string } | null; // 从项目代码面板附上的代码
  profile?: { background?: string; gaps?: string[]; preferences?: string[]; mastered?: string[] } | null; // 代码能力画像（仅 code 工具）
  onCodeSessionEnd?: (info: CodeSessionEnd) => void;        // 本次代码导读结束时回调（写画像）
  seed?: string;            // 预填输入（从 PDF 段落「就这一段提问」进来）
  historyKey?: string;      // 启用会话历史（按其隔离，如 "p0"）。传了才显示历史侧栏
  enableToolcall?: boolean; // 启用联网工具调用（论文筛选用：搜 arXiv / 下载导入）
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  time: string;
}

interface SessionSummary { id: string; title: string; createdAt: string; updatedAt: string; count: number }

/** 指导者规则：附在带上下文的工具对话里，让工具"活"起来 */
const GUIDE_RULES =
  "\n\n【指导者规则】你是用户的研究伴侣与指导者：\n" +
  "1. 若用户描述的环境/状态与上面提供的上下文不符，主动指出差异并建议如何更新（如：你的环境卡还写着 X，但你说 Y，建议更新环境卡）；\n" +
  "2. 若发现工作流可改进之处（提示词、流程、工具），主动提出建议；\n" +
  "3. 不要为了礼貌而附和错误描述——你的价值是指出问题。";

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 会话更新时间友好展示：今天显示 时:分，否则 月-日 */
function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export default function ChatPanel({ toolKey, hint, saveLabel, saveKind, onSaved, contextKind, systemExtra, attachedCode, profile, onCodeSessionEnd, seed, historyKey, enableToolcall }: ChatPanelProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [saved, setSaved] = useState("");
  const [ctxNote, setCtxNote] = useState("");
  // 会话历史：sessions=列表摘要；sessionId=当前会话 id（null=尚未落库）；showHistory=是否展开历史栏
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const historyErr = useRef(false);
  // 代码导读：本次会话是否已触发“写回画像”的回调（每个工具会话只写一次）
  const endLogged = useRef(false);

  // 首次进入时拉取该工具的历史会话列表
  useEffect(() => {
    if (!historyKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session-history?tool=${encodeURIComponent(historyKey)}`);
        const d = await res.json();
        if (!cancelled && Array.isArray(d?.sessions)) setSessions(d.sessions);
      } catch { historyErr.current = true; }
    })();
    return () => { cancelled = true; };
  }, [historyKey]);

  useEffect(() => {
    if (seed) {
      const v = seed;
      queueMicrotask(() => setInput(v));
    }
  }, [seed]);

  const tool = TOOLS[toolKey];
  if (!tool) return null;

  async function sendMsg() {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...msgs, { role: "user", content: text, time: nowTime() }];
    setMsgs(next);
    setInput("");
    setLoading(true);
    try {
      // 自动附加上下文（复现状态 / 环境卡 / 论文正文 + 指导者规则）
      let system = tool.prompt;
      const notes: string[] = [];
      if (contextKind) {
        const res = await fetch(`/api/context?kind=${contextKind}`);
        const data = await res.json();
        const ctx = data.content ?? "";
        if (ctx) {
          const label = contextKind === "repro" ? "当前复现状态" : "环境卡";
          system += `\n\n【自动附加 · ${label}】\n${ctx}`;
          notes.push(label);
        }
      }
      if (systemExtra && systemExtra.trim()) {
        const body = systemExtra.length > 14000 ? systemExtra.slice(0, 14000) + "\n…（正文过长已截断）" : systemExtra;
        system += `\n\n【论文正文 · 讲解时请引用原文位置并对照讲解】\n${body}`;
        notes.push("论文正文");
      }
      if (attachedCode && attachedCode.content && attachedCode.content.trim()) {
        system += `\n\n【项目代码 · ${attachedCode.name}】\n这是用户从项目复现代码库选定的文件。请按代码导读协议讲解：真实调用链 → 关键函数数据合同 → 执行前后变化；\n只在涉及本文件时引用它，并使用真实函数/变量名，不要泛泛总结。\n\`\`\`python\n${attachedCode.content}\n\`\`\``;
        notes.push(`项目代码（${attachedCode.name}）`);
      }
      if (toolKey === "code" && profile) {
        // 注入代码能力画像：让 AI 按用户当前水平讲，且已掌握的不再重讲
        const mastered = profile.mastered?.length ? profile.mastered.join("、") : "（暂无，会按您的现有水平讲）";
        system += `\n\n【用户代码能力画像 · 请据此讲解】\n背景：${profile.background ?? ""}\n当前会卡的写法：${(profile.gaps ?? []).join("；") || "（尚无记录，请主动标出会卡的语法）"}\n用户更偏好的讲解：${(profile.preferences ?? []).join("；")}\n已经掌握的（不要重讲，只在用到时点到）：${mastered}\n\n讲解要求：① 先做知识门槛扫描，标出上面列出的会卡写法（以及本文件里新出现的会卡写法）；② 给真实调用链 + 关键函数数据合同（输入/输出/形状/返回去向）；③ 分层标注：必须懂的深入、可黑盒的带过；④ 不要用白话故事代替数据合同。`;
        notes.push("代码能力画像");
      }
      if (notes.length) setCtxNote(`已附带：${notes.join("、")}（自动）`);
      system += GUIDE_RULES;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: system }, ...next], ...(enableToolcall ? { enableToolcall: true } : {}) }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      const errText = data?.error ? `错误：${data.error}` + (data?.hint ? `\n\n${data.hint}` : "") : null;
      const finalMsgs: Msg[] = [...next, { role: "assistant", content: content ?? (errText ?? "无响应"), time: nowTime() }];
      setMsgs(finalMsgs);
      void persistSession(finalMsgs); // 自动写入会话历史
      // 代码导读：读完后写回一次画像（会的不重讲、卡点提前解释）
      if (toolKey === "code" && onCodeSessionEnd && content && !endLogged.current) {
        endLogged.current = true;
        const explained: string[] = [];
        if (/已掌握|不再重讲|你已经理解|原本就会/.test(system)) explained.push("（本次讲解已按画像对齐，已掌握部分未重讲）");
        onCodeSessionEnd({
          explained,
          blocked: ((profile?.gaps ?? []) as string[]).slice(0, 3),
          passed: /复述|通过/.test(content),
        });
      }
    } catch (e) {
      const finalMsgs: Msg[] = [...next, { role: "assistant", content: `请求失败：${e instanceof Error ? e.message : String(e)}`, time: nowTime() }];
      setMsgs(finalMsgs);
      void persistSession(finalMsgs); // 失败也留档，方便回看
    } finally {
      setLoading(false);
    }
  }

  /* ---------- 会话历史 ---------- */
  async function persistSession(finalMsgs: Msg[]) {
    if (!historyKey || finalMsgs.length === 0) return;
    try {
      const res = await fetch("/api/session-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: historyKey, action: "upsert", id: sessionIdRef.current ?? undefined, msgs: finalMsgs }),
      });
      const d = await res.json();
      if (d?.id) {
        sessionIdRef.current = d.id;
        setSessionId(d.id);
      }
      if (Array.isArray(d?.sessions)) setSessions(d.sessions);
    } catch { /* 历史保存失败不影响主对话 */ }
  }

  async function openSession(id: string) {
    if (!historyKey) return;
    try {
      const res = await fetch(`/api/session-history?tool=${encodeURIComponent(historyKey)}&id=${encodeURIComponent(id)}`);
      const d = await res.json();
      if (d?.session) {
        sessionIdRef.current = d.session.id;
        setSessionId(d.session.id);
        setMsgs(Array.isArray(d.session.msgs) ? d.session.msgs : []);
        setShowHistory(false);
      }
    } catch { /* */ }
  }

  function newSession() {
    sessionIdRef.current = null;
    setSessionId(null);
    setMsgs([]);
    setShowHistory(false);
  }

  async function deleteSession(id: string) {
    if (!historyKey) return;
    try {
      const res = await fetch("/api/session-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: historyKey, action: "delete", id }),
      });
      const d = await res.json();
      if (Array.isArray(d?.sessions)) setSessions(d.sessions);
      if (sessionIdRef.current === id) newSession();
    } catch { /* */ }
  }

  async function saveResult() {
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant" || !saveKind) return;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: saveKind, content: last.content }),
    });
    if (res.ok) {
      const tip = saveKind === "screening" ? "✓ 已存入 data/notes/screening.md" : "✓ 已存入 data/handoffs.md";
      setSaved(tip);
      setTimeout(() => setSaved(""), 3000);
      onSaved?.(tip);
    }
  }

  return (
    <section>
      <div className="chat-toolbar">
        <button className="btn btn--ghost btn--quiet" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? "收起提示词" : "查看底层提示词"}
        </button>
        {historyKey && (
          <button className="btn btn--ghost btn--quiet" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "收起历史" : `历史记录${sessions.length ? `（${sessions.length}）` : ""}`}
          </button>
        )}
        {saved && <span className="chat-saved">{saved}</span>}
        {ctxNote && <span className="chat-ctx-note">{ctxNote}</span>}
      </div>

      {historyKey && showHistory && (
        <div className="history-panel">
          <div className="history-panel-head">
            <span>历史会话 · 点开可回看/继续</span>
            <button className="btn btn--primary btn--sm" onClick={newSession}>新建对话</button>
          </div>
          {sessions.length === 0 ? (
            <p className="history-empty">还没有历史记录——从第一条对话开始，消息会自动保存到这里。</p>
          ) : (
            <ul className="history-list">
              {sessions.map((s) => (
                <li key={s.id} className={`history-item${sessionId === s.id ? " is-current" : ""}`}>
                  <button className="history-item-main" onClick={() => void openSession(s.id)}>
                    <span className="history-title">{s.title}</span>
                    <span className="history-meta">{s.count} 条 · {fmtTime(s.updatedAt)}</span>
                  </button>
                  <button className="history-del" onClick={() => void deleteSession(s.id)} aria-label="删除这个会话">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showPrompt && (
        <div className="prompt-block">
          <p className="prompt-block-title">底层系统提示词（可见可查）</p>
          <pre>{tool.prompt}</pre>
        </div>
      )}

      {/* 消息区：注记式。AI 回复走 Markdown 渲染 */}
      <div className="msg-stream" aria-live="polite">
        {msgs.length === 0 && (
          <p className="chat-hint">{hint}</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className="msg">
            <div className="msg-meta">
              <span className={`msg-role ${m.role === "user" ? "is-user" : "is-ai"}`}>
                {m.role === "user" ? "我的记录" : "研究伴侣 · AI 观察"}
              </span>
              <span className="msg-time">{m.time}</span>
            </div>
            {m.role === "user" ? (
              <p className="msg-user-text">{m.content}</p>
            ) : (
              <div className="msg-body-ai">
                <Markdown>{m.content}</Markdown>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <p className="thinking"><span className="thinking-dot" aria-hidden="true" />思考中…</p>
        )}
      </div>

      {/* 输入区 */}
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMsg(); } }}
          placeholder="回复它的问题，或直接开始…"
          rows={2}
          className="field"
          aria-label="对话输入"
        />
        <div className="composer-row">
          <span className="composer-hint">↵ Enter 发送 · Shift+Enter 换行</span>
          <div className="composer-actions">
            {saveLabel && msgs.length > 0 && (
              <button className="btn btn--ghost btn--quiet" onClick={() => void saveResult()}>{saveLabel}</button>
            )}
            <button className="btn btn--primary" onClick={() => void sendMsg()} disabled={loading || !input.trim()}>
              发送
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
