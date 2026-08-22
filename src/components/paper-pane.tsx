"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Term } from "@/app/api/terms/route";
import TermDrawer from "@/components/term-drawer";
import { deletePaper, listPapers, loadPaper, savePaper, type PaperMeta } from "@/lib/paper-library";

/** react-pdf 只在浏览器加载（pdfjs 在 SSR/Node 下会因 DOMMatrix 崩溃），故 ssr:false */
const PdfReader = dynamic(() => import("@/components/pdf-reader"), { ssr: false });

function engName(t: Term) {
  return t.name.split("/")[0].trim();
}

function titleFromText(text: string, fallback: string) {
  const m = text.match(/^#\s*(.+)$/m);
  const first = text.split("\n").map((s) => s.trim()).find((s) => s.length > 10);
  return (m?.[1] ?? first ?? fallback).slice(0, 90);
}

/**
 * 论文正文面板：默认内置 NSR PDF（小阅读器，术语点击悬浮小卡）；
 * 也可替换 PDF / 粘贴 md·txt（文本模式，术语高亮）。
 */
export default function PaperPane({
  terms, onGoTerms, onExtractText, onAsk, defaultText = "",
}: {
  terms: Term[];
  onGoTerms?: () => void;
  onExtractText?: (t: string) => void;
  onAsk?: (seg: string) => void;
  defaultText?: string;
}) {
  const [mode, setMode] = useState<"pdf" | "text">(defaultText ? "text" : "pdf");
  const [pdfSrc, setPdfSrc] = useState<string | ArrayBuffer>("/papers/nsr.pdf");
  const [isBundled, setIsBundled] = useState(true);
  const [textVal, setTextVal] = useState(defaultText);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");
  const [openTerm, setOpenTerm] = useState<Term | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [lib, setLib] = useState<PaperMeta[]>([]);
  const [curName, setCurName] = useState("NSR 论文（内置）");
  const fileRef = useRef<HTMLInputElement>(null);

  void listPapers().then(setLib);

  async function refreshLib() {
    setLib(await listPapers());
  }

  async function openFromLib(name: string) {
    const blob = await loadPaper(name);
    if (!blob) return;
    if (name.toLowerCase().endsWith(".pdf")) {
      setIsBundled(false);
      setPdfSrc(await blob.arrayBuffer());
      setMode("pdf");
      setCurName(name);
    } else {
      applyText(await blob.text());
      setCurName(name);
    }
    setLibOpen(false);
  }

  function applyText(t: string) {
    setTextVal(t);
    setMode("text");
    onExtractText?.(t);
  }

  async function onFile(f: File) {
    if (f.size > 40 * 1024 * 1024) return;
    await savePaper(f.name, f); // 存入论文库
    if (f.name.toLowerCase().endsWith(".pdf")) {
      setIsBundled(false);
      setPdfSrc(await f.arrayBuffer());
      setMode("pdf");
      setCurName(f.name);
    } else {
      applyText(await f.text());
      setCurName(f.name);
    }
    void refreshLib();
  }

  const title = mode === "text" && textVal ? titleFromText(textVal, "论文正文") : isBundled ? "NSR 论文（内置）" : curName;

  // 文本模式术语高亮
  const segments = useMemo(() => {
    if (mode !== "text" || !textVal) return [];
    const sorted = terms.map(engName).filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
    const re = new RegExp("(" + sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "i");
    return textVal.split(re).map((part, i) => {
      const match = sorted.find((n) => n.toLowerCase() === part.toLowerCase());
      return { key: i, type: match ? "term" : "text", value: part, termName: match };
    });
  }, [mode, textVal, terms]);

  return (
    <>
      <div className="paper-pane">
        <div className="paper-pane-head">
          <p className="paper-pane-title">{title}</p>
          <div className="paper-pane-actions">
            <button className="btn btn--ghost btn--quiet" onClick={() => { setLibOpen(true); void refreshLib(); }}>论文库</button>
            <button className="btn btn--ghost btn--quiet" onClick={() => fileRef.current?.click()}>导入</button>
            <button className="btn btn--ghost btn--quiet" onClick={() => setPasteOpen((v) => !v)}>粘贴</button>
            {!isBundled && (
              <button className="btn btn--ghost btn--quiet" onClick={() => { setIsBundled(true); setPdfSrc("/papers/nsr.pdf"); setMode("pdf"); onExtractText?.(""); }}>
                回到内置
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".md,.txt,.pdf" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </div>

        {libOpen && (
          <div style={{ padding: "0.8rem 0.9rem", borderBottom: "1px solid var(--border)" }}>
            <div className="ledger-head" style={{ marginBottom: "0.5rem" }}>
              <span className="ledger-title">论文库</span>
              <span className="mono-label">导入的论文存本机浏览器 · 点击切换</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <button className="lib-row" onClick={() => { setIsBundled(true); setPdfSrc("/papers/nsr.pdf"); setMode("pdf"); setCurName("NSR 论文（内置）"); setLibOpen(false); }}>
                <span>NSR 论文（内置）</span>
                <span className="mono-label">built-in · PDF</span>
              </button>
              {lib.map((m) => (
                <div key={m.name} className="lib-row">
                  <button className="tlink" style={{ flex: 1, textAlign: "left" }} onClick={() => void openFromLib(m.name)}>
                    <span>{m.name}</span>
                    <span className="mono-label" style={{ marginLeft: "0.7rem" }}>{Math.round(m.size / 1024)} KB</span>
                  </button>
                  <button className="btn btn--ghost btn--quiet" onClick={() => { void deletePaper(m.name).then(() => refreshLib()); }}>删</button>
                </div>
              ))}
              {lib.length === 0 && <p className="mono-label" style={{ padding: "0.4rem 0" }}>还没有导入的论文——点「导入」选择 PDF / md / txt。</p>}
            </div>
          </div>
        )}

        {pasteOpen && (
          <div style={{ padding: "0.8rem 0.9rem", borderBottom: "1px solid var(--border)", display: "flex", gap: "0.6rem", flexDirection: "column" }}>
            <textarea className="field" rows={5} value={pasteVal}
              onChange={(e) => setPasteVal(e.target.value)}
              placeholder="把论文文本（含标题结构）粘贴到这里…" />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn--primary" onClick={() => { applyText(pasteVal); setPasteVal(""); setPasteOpen(false); }}>应用到正文面板</button>
              <button className="btn btn--ghost" onClick={() => setPasteOpen(false)}>取消</button>
            </div>
          </div>
        )}

        <div className="paper-pane-body">
          {mode === "pdf" ? (
            <PdfReader src={pdfSrc} terms={terms} onGoTerms={onGoTerms} onExtractText={onExtractText} onAsk={onAsk} />
          ) : textVal ? (
            <div className="paper-text">
              {segments.map((s) =>
                s.type === "term" ? (
                  <button key={s.key} className="term-link"
                    onClick={() => {
                      const t = terms.find((x) => engName(x).toLowerCase() === (s.termName ?? "").toLowerCase());
                      if (t) setOpenTerm(t);
                    }}>
                    {s.value}
                  </button>
                ) : (
                  <span key={s.key}>{s.value}</span>
                )
              )}
            </div>
          ) : (
            <div className="paper-empty">
              <p style={{ margin: 0, fontFamily: "var(--font-lora)", fontStyle: "italic", fontSize: "1rem" }}>
                正文空缺
              </p>
              <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.6 }}>
                上传 .md / .txt / .pdf，或直接粘贴；讲解时自动带上原文。
              </p>
            </div>
          )}
        </div>
      </div>

      <TermDrawer term={openTerm} onClose={() => setOpenTerm(null)} onGoTerms={onGoTerms} />
    </>
  );
}
