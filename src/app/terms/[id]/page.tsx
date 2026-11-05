import { redirect } from 'next/navigation';
export default async function TermPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{paper?:string}>}) {
  const {id}=await params;const {paper}=await searchParams;
  redirect('/?view=terms&term='+encodeURIComponent(id)+(paper?'&paper='+encodeURIComponent(paper):''));
}
