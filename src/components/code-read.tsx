"use client";

import { useEffect, useMemo, useState } from "react";

/** 从读取接口返回的 chain 数据里挑“重点”，交给导读开头（基于真实函数/import，不凭空猜） */
function pickHighlights(content: string, chain: Record<string, unknown> | null): string[] {
  const lines = content.split("\n");
  const out: string[] = [];

  // 1. 文件顶层结构：顶层 import + 顶层 def / class / export
  const imports: string[] = [];
  const topDefs: string[] = [];
  const topExports: string[] = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("import ") || t.startsWith("from ")) { if (imports.length < 12) imports.push(`${i + 1}: ${t}`); }
    else if (t.startsWith("def ") || t.startsWith("class ") || t.startsWith("async def ")) {
      if (topDefs.length < 14) topDefs.push(`${i + 1}: ${t.slice(0, 70)}`);
    }
    else if (t.startsWith("export ")) { if (topExports.length < 8) topExports.push(`${i + 1}: ${t.slice(0, 70)}`); }
  });
  if (imports.length) out.push(`导入（${imports.length} 处）：\n${imports.join("\n")}`);
  if (topDefs.length) out.push(`顶层定义：\n${topDefs.join("\n")}`);

  // 2. 跨文件调用链（Python 才有）
  if (chain && typeof chain === "object") {
    const cc = chain as { callees_outside?: { name: string; defined_in: string; line: number }[]; callers?: { name: string; caller_files: string[] }[] };
    const callees = cc.callees_outside ?? [];
    if (callees.length) out.push(`本文件调用了外部定义的函数（${callees.length}）：\n${callees.slice(0, 10).map((c) => `${c.name}（来自 ${c.defined_in}:${c.line}）`).join("\n")}`);
    const callers = cc.callers ?? [];
    if (callers.length) out.push(`谁调用了本文件的函数（${callers.length}）：\n${callers.slice(0, 8).map((c) => `${c.name}（被 ${c.caller_files.join("、")} 调用）`).join("\n")}`);
  }
  return out;
}

/** 代码导读面板：选项目/文件 → 自动带出重点 + 可附进对话（画像是父层注入） */
export default function CodeRead({
  onAttach,
}: {
  onAttach: (payload: { name: string; content: string; highlights: string[]; chain: Record<string, unknown> | null; question: string; full: boolean }) => void;
}) {
  const [roots, setRoots] = useState<{ id: string; name: string; root: string }[]>([]);
  const [rootId, setRootId] = useState("project");
  const [available, setAvailable] = useState<null | boolean>(null);
  const [files, setFiles] = useState<{ name: string; path: string; lines: number }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [chain, setChain] = useState<Record<string, unknown> | null>(null);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"default" | "full">("default");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/code-read")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRoots(d.roots ?? []);
        setRootId(d.currentRoot?.id ?? "project");
        setAvailable(Boolean(d.available));
        setFiles(d.files ?? []);
      })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  async function loadFiles(id: string) {
    setRootId(id);
    try {
      const res = await fetch(`/api/code-read?root=${encodeURIComponent(id)}`);
      const d = await res.json();
      setAvailable(Boolean(d.available));
      setFiles(d.files ?? []);
      setSelected(null);
      setContent(null);
      setChain(null);
      setHighlights([]);
    } catch { /* */ }
  }

  async function open(path: string) {
    setSelected(path);
    setLoaded(false);
    setContent(null);
    setChain(null);
    setHighlights([]);
    try {
      const res = await fetch(`/api/code-read?root=${encodeURIComponent(rootId)}&file=${encodeURIComponent(path)}&chain=1`);
      const d = await res.json();
      if (d.content !== undefined) {
        setContent(d.content);
        setChain(d.chain ?? null);
        setHighlights(pickHighlights(d.content, d.chain ?? null));
      }
    } catch { /* */ } finally {
      setLoaded(true);
    }
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return files;
    return files.filter((f) => f.path.toLowerCase().includes(query));
  }, [files, q]);

  function attach() {
    if (!selected || !content) return;
    onAttach({
      name: selected,
      content,
      highlights,
      chain,
      question: question.trim(),
      full: mode === "full",
    });
  }

  const hint = [
    "项目代码已选。先看「重点」栏里的真实导入/定义/调用链，再选一个动作：",
    "· 自动挑重点导读（默认）——我按你的代码能力画像，先标出你会卡的写法，再给调用链+数据合同",
    "· 全部读——从导入到入口完整走一遍",
    "· 针对问题提问——只解决你问的那一个点",
  ].join("\n");

  if (available === null) return <p className="mono-label" style={{ padding: "0.6rem 0", opacity: 0.6 }}>读取项目代码…</p>;
  if (!available) return <p className="mono-label" style={{ padding: "0.6rem 0", opacity: 0.6 }}>当前环境读不到项目代码——需在本机运行（可配置代码根目录）。</p>;

  return (
    <div className="coderead">
      {/* 顶栏：项目切换 + 说明 */}
      <div className="coderead-top">
        <div className="coderead-rootrow">
          <label className="mono-label">项目根目录</label>
          <select className="field field--mini" value={rootId} onChange={(e) => void loadFiles(e.target.value)}>
            {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="mono-label" style={{ opacity: 0.5 }}>{files.length} 个代码文件</span>
        </div>
        <p className="coderead-hint">{hint}</p>
      </div>

      <div className="coderead-body">
        {/* 左：文件列表 */}
        <div className="coderead-list">
          <input className="field field--mini" placeholder="筛选文件名…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="筛选代码文件"
            style={{ marginBottom: "0.4rem" }} />
          {filtered.length === 0 && <p className="mono-label" style={{ padding: "0.4rem 0", opacity: 0.6 }}>无匹配文件。</p>}
          {filtered.map((f) => (
            <button key={f.path} className={`coderead-file${selected === f.path ? " is-active" : ""}`}
              onClick={() => void open(f.path)} title={f.path}>
              <span className="cr-fname">{f.path}</span>
              <span className="cr-flines">{f.lines}</span>
            </button>
          ))}
        </div>

        {/* 右：内容 + 重点 */}
        <div className="coderead-view">
          {!selected && <p className="mono-label" style={{ padding: "0.6rem 0", opacity: 0.6 }}>点左边一个文件查看。</p>}
          {selected && !loaded && <p className="mono-label" style={{ padding: "0.6rem 0", opacity: 0.6 }}>加载中…</p>}
          {selected && content !== null && (
            <>
              {highlights.length > 0 && (
                <div className="coderead-highlights">
                  <div className="mono-label" style={{ marginBottom: "0.4rem" }}>重点（真实导入/定义/调用链，非猜测）</div>
                  {highlights.map((h, i) => <pre key={i} className="coderead-hl">{h}</pre>)}
                </div>
              )}
              <div className="coderead-actions">
                <label className="coderead-radio">
                  <input type="radio" name="mode" checked={mode === "default"} onChange={() => setMode("default")} />
                  <span>自动挑重点导读</span>
                </label>
                <label className="coderead-radio">
                  <input type="radio" name="mode" checked={mode === "full"} onChange={() => setMode("full")} />
                  <span>全部读</span>
                </label>
              </div>
              <div className="coderead-ask">
                <input className="field" placeholder="针对某个小问题提问（可选），然后点「开始导读」…"
                  value={question} onChange={(e) => setQuestion(e.target.value)} />
              </div>
              <button className="btn btn--accent" style={{ marginTop: "0.6rem" }} onClick={attach}>
                开始导读 →
              </button>
              <pre className="coderead-pre">{content}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
