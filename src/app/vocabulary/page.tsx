import { redirect } from 'next/navigation';
export default async function VocabularyPage({searchParams}:{searchParams:Promise<{paper?:string}>}) {
  const {paper}=await searchParams;
  redirect('/?view=vocabulary'+(paper?'&paper='+encodeURIComponent(paper):''));
}
