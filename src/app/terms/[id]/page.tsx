import Terms from "@/components/terms";
import Link from "next/link";
export default async function TermPage({ params, searchParams }: { params: Promise<{ id:string }>; searchParams:Promise<{paper?:string}> }) {
  const {id}=await params;const {paper}=await searchParams;
  return <div style={{maxWidth:1200,margin:"0 auto",padding:"24px"}}><Link href="/">← 返回研究工作台</Link><Terms initialId={id} initialPaper={paper}/></div>;
}
