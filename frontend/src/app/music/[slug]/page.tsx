import { getMixData } from "@/lib/data";
import { MixExperience } from "@/components/mix-experience";

export const metadata = {
  title: "Mix",
  description: "A Hymnora listening mix.",
};

export default async function MixPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getMixData(slug);
  return <MixExperience detail={detail} />;
}
