import { HymnReader } from "@/components/hymn-reader";

export const metadata = {
  title: "Read a hymn",
  description: "A calm reading view for a single SDA hymn.",
};

export default async function HymnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HymnReader hymnId={id} />;
}
