"use client";

import { useState } from "react";
import { TOOLS } from "@/lib/data";
import Markdown from "@/components/markdown";

export interface ChatPanelProps {
  toolKey: string;          // TOOLS 中的键（p0/p3/env/code/handoff/checklist）
  hint: string;             // 开场提示（第一条消息发什么）
  intro?: string[];         // 工具说明行（这是什么/什么时候用/怎么用/产出）
  saveLabel?: string;       // 保存按钮文案（如"保存为筛选笔记"）
  saveKind?: string;        // 保存到记忆文件的 kind（screening/handoff）
  onSaved?: (tip: string) => void;
  contextKind?: string;     // 自动附加的上下文（repro=复现状态 / environment=环境卡+指导者提醒）
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  time: string;             // 时间戳：个人工作空间"记录痕迹"
}

const INTRO_LABELS = ["是什么", "何时用", "怎么用", "产出"];

/** 指导者规则：附在带上下文的工具对话里，让工具"活"起来 */
const GUIDE_RULES =
  "\n\n【指导者规则】你是用户的研究伴侣与指导者：\n" +
  "1. 若用户描述的环境/状态与上面提供的上下文不符，主动指出差异并建议如何更新（如：你的环境卡还写着 X，但你说 Y，建议更新环境卡）；\n" +
  "2. 若发现工作流可改进之处（提示词、流程、工具），主动提出建议；\n" +
  "3. 不要为了礼貌而附和错误描述——你的价值是指出问题。";

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function ChatPanel({ toolKey, hint, intro, saveLabel, saveKind, onSaved, contextKind }: ChatPanelProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [saved, setSaved] = useState("");
  const [ctxNote, setCtxNote] = useState("");

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
      // 自动附加上下文（衔接复现/环境 + 指导者规则）
      let system = tool.prompt;
      if (contextKind) {
        const res = await fetch(`/api/context?kind=${contextKind}`);
        const data = await res.json();
        const ctx = data.content ?? "";
        if (ctx) {
          const label = contextKind === "repro" ? "当前复现状态" : "环境卡";
          system = `${tool.prompt}\n\n【自动附加 · ${label}】\n${ctx}${GUIDE_RULES}`;
          setCtxNote(`已附带${label}（自动）`);
        }
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: system }, ...next] }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setMsgs([...next, { role: "assistant", content: content ?? (data?.error ? `错误：${data.error}` : "无响应"), time: nowTime() }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `请求失败：${e instanceof Error ? e.message : String(e)}`, time: nowTime() }]);
    } finally {
      setLoading(false);
    }
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
      {/* 工具说明：非卡片，四行资料页（发丝线分隔的编辑感） */}
      {intro && intro.length > 0 && (
        <div className="tool-sheet">
          {intro.map((line, i) => (
            <div key={i} className="tool-sheet-cell">
              <span className="tool-sheet-label">{INTRO_LABELS[i] ?? "·"}</span>
              <p className="tool-sheet-text">{line}</p>
            </div>
          ))}
        </div>
      )}

      <div className="chat-toolbar">
        <button className="btn btn--ghost btn--quiet" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? "收起提示词" : "查看底层提示词"}
        </button>
        {saved && <span className="chat-saved">{saved}</span>}
        {ctxNote && <span className="chat-ctx-note">{ctxNote}</span>}
      </div>

      {showPrompt && (
        <div className="prompt-block">
          <p className="prompt-block-title">底层系统提示词（可见可查）</p>
          <pre>{tool.prompt}</pre>
        </div>
      )}

      {/* 消息区：注记式（无气泡）。AI 回复走 Markdown 渲染 */}
      <div className="msg-stream" aria-live="polite">
        {msgs.length === 0 && (
          <>
            <p className="chat-hint">{hint}</p>
            <p className="mono-label" style={{ opacity: 0.65 }}>—— 研究伴侣 · 开场注记</p>
          </>
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
          className="field field--paper"
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
