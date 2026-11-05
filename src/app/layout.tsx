import type { Metadata, Viewport } from "next";
import "./globals.css";
import './personalization.css';
import './model-settings.css';
import { ModelSettingsProvider } from '@/components/model-settings';
import 'katex/dist/katex.min.css';
import { ReadingMemoryProvider } from '@/components/reading-memory';
import { ReadingNotesProvider } from '@/components/reading-notes';

export const metadata: Metadata = {
  title: "Research Atelier · 我的研究空间",
  description: "个人论文学习一体化工具：积累阅读历史、研究方向、知识结构与个人理解。",
};

export const viewport: Viewport = {
  themeColor: "#F7F4EF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full"><ModelSettingsProvider><ReadingNotesProvider><ReadingMemoryProvider>{children}</ReadingMemoryProvider></ReadingNotesProvider></ModelSettingsProvider></body>
    </html>
  );
}
