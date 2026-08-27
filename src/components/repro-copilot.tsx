"use client";

import { useEffect, useRef, useState } from "react";

interface ProposedStep { id: string; title: string; note?: string; done?: boolean }
interface Msg { role: "user" | "assistant"; content: string }

export default function ReproCopilot({
  slug,
  writeSteps,
}: {
  slug: string;
  writeSteps: (steps: { title: string; note?: string; status: "todo" | "done" | "doing" }[]) => Promise<void>;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [proposed, setProposed] = useState<ProposedStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [writing, setWriting] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 切换论文时清空对话框
  useEffect(() => { setMsgs([]); setProposed([]); setChecked({}); setDoneMsg(""); }, [slug]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, proposed]);

  function toggleCheck(id: string) { setChecked((c) => ({ ...c, [id]: !c[id] })); }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setDoneMsg("");
    const newMsgs: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(newMsgs);
    setBusy(true);
    setProposed([]); // 新消息后清掉上一轮待确认步骤，避免误写重复
    setChecked({});
    try {
      const r = await fetch("/api/reproduction/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, messages: newMsgs.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const d = await r.json();
      if (r.ok) {
        if (d.reply) setMsgs((prev) => [...prev, { role: "assistant", content: d.reply }]);
        if (Array.isArray(d.proposed) && d.proposed.length) {
          setProposed(d.proposed);
          const init: Record<string, boolean> = {};
          d.proposed.forEach((p: ProposedStep) => { init[p.id] = true; });
          setChecked(init);
        }
      } else {
        setMsgs((prev) => [...prev, { role: "assistant", content: `（${d.error ?? "失败"}${d.hint ? " · " + d.hint : ""}）` }]);
      }
    } catch {
      setMsgs((prev) => [...prev, { role: "assistant", content: "（网络/服务错误，稍后重试）" }]);
    }
    setBusy(false);
  }

  async function writeSelected() {
    const sel = proposed.filter((p) => checked[p.id]);
    if (!sel.length) return;
    setWriting(true);
    setDoneMsg("");
    try {
      await writeSteps(sel.map((p) => ({ title: p.title, note: p.note, status: p.done ? "done" : "todo" })));
      setDoneMsg(`已写入 ${sel.length} 步到复现路径。`);
      setProposed([]);
      setChecked({});
    } catch {
      setDoneMsg("写入失败，请重试。");
    }
    setWriting(false);
  }

  return (
    <div className="repro-copilot">
      <div className="repro-sec-head"><span className="mono-label">复现商定（和 AI 一起敲定路径 · 达成共识后一键写入）</span></div>

      <div className="copilot-scroll" ref={scrollRef}>
        {msgs.length === 0 && (
          <p className="mono-label" style={{ opacity: 0.6 }}>跟 AI 讨论下一步，例如「第一层输入预处理怎么拆成可验证步骤」。AI 会把已商定的步骤作为「建议步骤」列出来。</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`copilot-msg copilot-msg--${m.role}`}>
            <span className="copilot-role">{m.role === "user" ? "你" : "AI"}</span>
            <div className="copilot-text">{m.content}</div>
          </div>
        ))}
      </div>

      {proposed.length > 0 && (
        <div className="copilot-proposed">
          <div className="copilot-proposed-head">
            <span className="mono-label">建议步骤（勾选要写入的，可点标题修改）</span>
            <button className="btn btn--primary btn--sm" disabled={writing} onClick={() => void writeSelected()}>
              {writing ? "写入中…" : `写入路径（${proposed.filter((p) => checked[p.id]).length}）`}
            </button>
          </div>
          {doneMsg && <div className="copilot-done">{doneMsg}</div>}
          <ul>
            {proposed.map((p) => (
              <li key={p.id}>
                <input type="checkbox" checked={!!checked[p.id]} onChange={() => toggleCheck(p.id)} />
                <div className="copilot-proposed-body">
                  <input className="field field--mini" defaultValue={p.title} onChange={(e) => setProposed((arr) => arr.map((x) => x.id === p.id ? { ...x, title: e.target.value } : x))} />
                  <input className="field field--mini" defaultValue={p.note ?? ""} placeholder="说明（可选）" onChange={(e) => setProposed((arr) => arr.map((x) => x.id === p.id ? { ...x, note: e.target.value } : x))} />
                  {p.done && <span className="chip chip--dark">已达成</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="copilot-input">
        <textarea className="field" rows={2} placeholder="和 AI 讨论下一步…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void send()}>{busy ? "思考中…" : "发送"}</button>
      </div>
    </div>
  );
}
