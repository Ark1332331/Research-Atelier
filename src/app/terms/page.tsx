import { redirect } from 'next/navigation';
export default async function TermsPage({searchParams}:{searchParams:Promise<{paper?:string}>}) {
  const {paper}=await searchParams;
  redirect('/?view=terms'+(paper?'&paper='+encodeURIComponent(paper):''));
}
