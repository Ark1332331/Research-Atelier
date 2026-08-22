import FullReader from "@/components/full-reader";

export default async function ReadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FullReader slug={slug} />;
}
