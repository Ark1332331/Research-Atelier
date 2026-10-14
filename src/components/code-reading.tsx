"use client";

import { useEffect, useState } from "react";
import ChatPanel from "@/components/chat-panel";
import CodeRead from "@/components/code-read";
import PageHead from "@/components/page-head";
import type { CodeProfile } from "@/app/api/code-profile/route";

/** 代码导读 · 独立页（侧栏入口，与论文库/实验复现平级）。
 *  从复现页拆出：选项目/文件 → 自动带出重点（或针对提问）→ 带画像导读 → 读后写回画像。 */
export default function CodeReading() {
  const [attached, setAttached] = useState<{ name: string; content: string; highlights: string[]; chain: Record<string, unknown> | null; question: string; full: boolean } | null>(null);
  const [codeProfile, setCodeProfile] = useState<CodeProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/code-profile")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCodeProfile(d.profile ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <section>
      <PageHead
        num="05" name="代码导读"
        title="读代码"
        desc="选项目/文件 → 自动带出重点，或针对某个问题；对话和操作会留下观察，新发现的讲解改法经你确认后生效。"
        meta="按已确认的学习规则讲解"
      />
      {attached ? (
        <>
          <div className="chat-ctx-note" style={{ marginBottom: "0.7rem" }}>
            已选项目代码：{attached.name} · 模式 {attached.full ? "全部读" : "自动挑重点"}
            {codeProfile?.mastered?.length ? ` · ${codeProfile.mastered.length} 条历史自评，需核对理解` : ""}
          </div>
          <ChatPanel
            toolKey="code"
            resourceId={attached.name}
            hint={`代码导读开始：${attached.name}。请先按我的代码能力画像把这次会卡的写法单独讲清楚，再给调用链和数据合同。${attached.question ? `\n我这次的提问：${attached.question}` : ""}${attached.highlights.length ? "\n本文件重点（真实导入/定义/调用链）：\n" + attached.highlights.slice(0, 3).join("\n") : ""}`}
            contextKind="repro"
            attachedCode={{ name: attached.name, content: attached.content }}
            profile={codeProfile}
            seed={attached.question ? `请针对这个文件讲解（重点先讲我这次的问题）：${attached.question}` : ""}
            onCodeSessionEnd={(info) => {
              fetch("/api/code-profile", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "log", entry: { file: attached.name, explained: info.explained, blocked: info.blocked, passed: info.passed } }),
              });
            }}
          />
          <button className="btn btn--ghost btn--quiet" style={{ marginTop: "1.2rem" }} onClick={() => setAttached(null)}>
            ← 换一个文件/项目
          </button>
        </>
      ) : (
        <CodeRead
          onAttach={({ name, content, highlights, chain, question, full }) => { setAttached({ name, content, highlights, chain, question, full }); }}
        />
      )}
    </section>
  );
}
