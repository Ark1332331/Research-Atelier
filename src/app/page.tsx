"use client";

import { Suspense, useEffect, useRef } from "react";
import Personalization from '@/components/personalization';
import Projects from "@/components/projects";
import ProjectRepro from "@/components/project-repro";
import Discovery from "@/components/discovery";
import Terms from "@/components/terms";
import PageHead from "@/components/page-head";
import type { PaperProject } from "@/lib/project";
import Vocabulary from '@/components/vocabulary';
import ReadingNotesLibrary from '@/components/reading-notes-library';
import StudyLibrary from '@/components/study-library';
import {ModelControl} from '@/components/model-settings';

import {useRouter,useSearchParams} from 'next/navigation';

type View = "projects" | "repro" | "discovery" | "terms" | "vocabulary" | "notes" | "personalization" | "study";

export default function App() { return <Suspense fallback={<p className="v1-empty">正在打开论文库…</p>}><Workspace /></Suspense>; }
function Workspace() {
  const router=useRouter(),params=useSearchParams();
  const rail=useRef<HTMLElement>(null);
  const projectId=params.get('project');
  const requested=params.get('view');
  const view:View=projectId?'repro':requested==='learning'||requested==='profile'||requested==='personalization'?'personalization':requested==='discovery'||requested==='terms'||requested==='vocabulary'||requested==='notes'||requested==='study'?requested:'projects';
  useEffect(()=>{const nav=rail.current?.querySelector<HTMLElement>('.rail-nav'),active=nav?.querySelector<HTMLElement>('.is-active');if(nav&&active&&window.innerWidth<=640){const b=nav.getBoundingClientRect(),a=active.getBoundingClientRect();if(a.right>b.right)nav.scrollLeft+=a.right-b.right+12;else if(a.left<b.left)nav.scrollLeft-=b.left-a.left+12;}},[view]);
  const setView=(next:View)=>router.push(next==='projects'?'/':`/?view=${next}`);
  const openProject=(project:PaperProject)=>router.push(`/?project=${encodeURIComponent(project.id)}`);
  return (
    <div className="shell">
      <header className="topbar"><div className="topbar-inner"><span className="topbar-word">Research Atelier<span className="dot">.</span></span><span className="mono-label">按论文项目组织研究</span><ModelControl /></div></header>
      <div className="app-body">
        <nav ref={rail} className="rail" aria-label="项目导航">
          <div className="rail-head"><p className="rail-title">我的研究<span className="dot">.</span></p><p className="rail-sub">PROJECT CENTER</p></div>
          <div className="rail-nav">
            <button className={"rail-item" + (view === "projects" ? " is-active" : "")} onClick={() => setView("projects")}><span>论文库</span></button>
            <button className={"rail-item" + (view === "study" ? " is-active" : "")} onClick={() => setView("study")}><span>学习</span></button>
            <button className={"rail-item" + (view === "discovery" ? " is-active" : "")} onClick={() => setView("discovery")}><span>文献发现</span></button>
            <button className={"rail-item" + (view === "terms" ? " is-active" : "")} onClick={() => setView("terms")}><span>术语卡</span></button>
            <button className={"rail-item" + (view === "vocabulary" ? " is-active" : "")} onClick={() => setView("vocabulary")}><span>生词本</span></button>
            <button className={"rail-item" + (view === "notes" ? " is-active" : "")} onClick={() => setView("notes")}><span>随心笔记</span></button>
            <button className={"rail-item" + (view === "personalization" ? " is-active" : "")} onClick={() => setView("personalization")}><span>个性化</span></button>
          </div>
          <div className="rail-foot"><span className="rail-status-line">AI 是研究伴侣</span></div>
        </nav>
        <main className="workspace">
          {view === "projects" && <Projects onOpen={openProject} />}
          {view === "study" && <StudyLibrary />}
          {view === "repro" && projectId && <ProjectRepro key={projectId} projectId={projectId} onBack={() => setView("projects")} />}
          {view === "discovery" && <><PageHead num="01" name="文献发现" title="文献发现" desc="告诉我研究问题，我会给出检索策略并协助筛选。" meta="研究会话持久化" /><Discovery /></>}
          {view === "terms" && <Terms key={`${params.get("paper")}:${params.get("term")}`} initialPaper={params.get("paper")??""} initialId={params.get("term")??undefined} />}
          {view === "vocabulary" && <Vocabulary initialPaper={params.get("paper")??""} />}
          {view === "notes" && <ReadingNotesLibrary />}
          {view === "personalization" && <Personalization initialTab={requested==='learning'?'teaching':'profile'} />}
        </main>
      </div>
    </div>
  );
}
