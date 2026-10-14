import Link from "next/link";
import LearningCenter from "@/components/learning-center";
export default function LearningPage() {
  return <main><header className="topbar"><div className="topbar-inner"><Link href="/">Research Atelier · 返回项目</Link></div></header><div style={{padding:"24px 20px"}}><LearningCenter /></div></main>;
}
