import type { Metadata, Viewport } from "next";
import "./globals.css";
import ObservationIndicator from "@/components/observation-indicator";

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
      <body className="min-h-full">{children}<ObservationIndicator/></body>
    </html>
  );
}
