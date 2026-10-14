"use client";

import { useState } from "react";
import LearningCenter from "@/components/learning-center";
import Projects from "@/components/projects";
import ProjectRepro from "@/components/project-repro";
import Discovery from "@/components/discovery";
import Terms from "@/components/terms";
import PageHead from "@/components/page-head";
import type { PaperProject } from "@/lib/project";

type View = "projects" | "repro" | "discovery" | "terms" | "learning";

export default function App() {
  const [view, setView] = useState<View>("projects");
  const [projectId, setProjectId] = useState<string | null>(null);
  const openProject = (project: PaperProject) => {
    setProjectId(project.id); setView("repro");
  };
  return (
    <div className="shell">
      <header className="topbar"><div className="topbar-inner"><span className="topbar-word">Research Atelier<span className="dot">.</span></span><span className="mono-label">按论文项目组织研究</span></div></header>
      <div className="app-body">
        <nav className="rail" aria-label="项目导航">
          <div className="rail-head"><p className="rail-title">我的研究<span className="dot">.</span></p><p className="rail-sub">PROJECT CENTER</p></div>
          <div className="rail-nav">
            <button className={"rail-item" + (view === "projects" ? " is-active" : "")} onClick={() => setView("projects")}><span>项目</span></button>
            <button className={"rail-item" + (view === "discovery" ? " is-active" : "")} onClick={() => setView("discovery")}><span>文献发现</span></button>
            <button className={"rail-item" + (view === "terms" ? " is-active" : "")} onClick={() => setView("terms")}><span>术语卡</span></button>
            <button className={"rail-item" + (view === "learning" ? " is-active" : "")} onClick={() => setView("learning")}><span>助手如何懂我</span></button>
          </div>
          <div className="rail-foot"><span className="rail-status-line">AI 是研究伴侣</span></div>
        </nav>
        <main className="workspace">
          {view === "projects" && <Projects onOpen={openProject} />}
          {view === "repro" && projectId && <ProjectRepro projectId={projectId} onBack={() => setView("projects")} />}
          {view === "discovery" && <><PageHead num="01" name="文献发现" title="文献发现" desc="告诉我研究问题，我会给出检索策略并协助筛选。" meta="研究会话持久化" /><Discovery /></>}
          {view === "terms" && <Terms />}
          {view === "learning" && <LearningCenter />}
        </main>
      </div>
    </div>
  );
}
