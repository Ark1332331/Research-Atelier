"use client";

import { useEffect, useState } from "react";
import type { ProjectAIMessage } from "@/lib/project-ai";
import Markdown from "@/components/markdown";
import LearningResponse, { type ResponseLearning } from "./learning-response";
import {readAnswer} from '@/lib/answer-stream';
import {useAnswerScroll} from './use-answer-scroll';

type AskMode = "chat" | "audit";

const AUDIT_PROMPT = [
  "请基于本项目证据做一次客观复现审计。",
  "不要只总结聊天记录；请读取并交叉检查论文、绑定执行会话、本地代码、Git 分支/提交/未提交差异、项目历史和笔记。",
  "判断当前复现阶段、哪些完成声明有证据、哪些只是说过但没有验证、当前方向是否应该继续，以及下一步最小可验收门槛。",
].join("\n");

export default function ProjectAI({ projectId,slug }: { projectId: string;slug?:string }) {
  const [messages, setMessages] = useState<(ProjectAIMessage & {learning?:ResponseLearning})[]>([]);
  const [question, setQuestion] = useState("");
  const [busyMode, setBusyMode] = useState<AskMode | null>(null);
  const [error, setError] = useState("");
  const busy = busyMode !== null;
  const [partial,setPartial]=useState<string|null>(null);
  const {bind:bindScroll,begin:beginScroll,onScroll,onWheel,onPointerDown,onKeyDown}=useAnswerScroll(`${messages.length}:${partial??''}`,busy);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/project-ai?projectId=" + encodeURIComponent(projectId), { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "项目 AI 历史读取失败");
      if (!cancelled) setMessages(Array.isArray(data.messages) ? data.messages : []);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "项目 AI 历史读取失败"); });
    return () => { cancelled = true; };
  }, [projectId]);
  const ask = async (mode: AskMode = "chat") => {
    const content = mode === "audit" ? (question.trim() || AUDIT_PROMPT) : question.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next); setQuestion(""); setError(""); setBusyMode(mode);
    setPartial('');beginScroll();
    try {
      const response = await fetch("/api/project-ai", { method: "POST", headers: { "Content-Type": "application/json",Accept:'application/x-ndjson' }, body: JSON.stringify({ projectId, question: content, mode }) });
      const data = await readAnswer<{messages?:(ProjectAIMessage & {learning?:ResponseLearning})[];answer?:string;error?:string}>(response,setPartial);
      if (!response.ok) throw new Error(data.error ?? "项目 AI 请求失败");
      setMessages(Array.isArray(data.messages) ? data.messages : [...next, { role: "assistant", content: data.answer ?? "（AI 没有返回文字）" }]);
      setPartial(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "项目 AI 请求失败"); setMessages(messages);setQuestion(content); }
    finally { setBusyMode(null); }
  };
  return <div className="v1-context v1-project-ai">
    <p className="mono-label">项目 AI 会读取本项目的论文、代码目录、Git 状态/未提交差异、绑定会话、复现历史和笔记。</p>
    <div className="v1-ai-messages" ref={bindScroll} onScroll={onScroll} onWheel={onWheel} onPointerDown={onPointerDown} onKeyDown={onKeyDown} style={{overflowAnchor:'none'}}>{messages.length ? messages.map((message, index) => <div className={"v1-ai-message v1-ai-message--" + message.role} key={index}><span className="mono-label">{message.role === "user" ? "你" : "项目 AI"}</span><Markdown slug={slug} sourceKey={`project:${projectId}:${index}`} interactive={message.role==="assistant"} context={messages.slice(Math.max(0,index-4),index).map(m=>m.content).join("\n").slice(-10000)}>{message.content}</Markdown>{message.learning && <LearningResponse learning={message.learning}/>}</div>) : <p className="v1-empty">例如：当前复现链卡在哪里？代码里的训练入口和论文方法是否对应？</p>}{partial!==null&&<div data-answer-start><span className="mono-label">{busy?'项目 AI · 正在生成':'回答未完成，请重试'}</span><Markdown interactive={false}>{partial}</Markdown></div>}</div>
    {error && <p className="v1-error">{error}</p>}
    <div className="v1-ai-compose"><textarea className="field" value={question} placeholder="询问复现进度、方向、代码证据…" rows={3} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void ask("chat"); }} /><div className="v1-ai-actions"><button className="btn" disabled={busy} onClick={() => void ask("audit")}>{busyMode === "audit" ? "审计中…" : "客观审计"}</button><button className="btn btn--primary" disabled={busy || !question.trim()} onClick={() => void ask("chat")}>{busyMode === "chat" ? "思考中…" : "提问"}</button></div></div>
    <p className="mono-label">Ctrl/⌘ + Enter 提问</p>
  </div>;
}
