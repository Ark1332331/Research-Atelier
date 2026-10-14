"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown 渲染组件：把 AI 回复渲染成编辑感排版（标题/表格/列表/代码块/引用）。
 * 设计：md-body 排版体系见 globals.css（衬线标题 + 发丝线表格 + 衬线引用 + 等宽代码）。
 * 依据：node_modules/next/dist/docs 客户端组件约定（'use client' 边界）。
 */
export default function Markdown({ children }: { children: string }) {
  const normalized = unwrapMarkdownFence(children);
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalized}</ReactMarkdown>
    </div>
  );
}

function unwrapMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? value;
}
