import StudyReader from '@/components/study-reader';
import '../../study-reader.css';

export default async function StudyDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudyReader documentId={id} />;
}
