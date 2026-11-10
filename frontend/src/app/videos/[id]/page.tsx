import { notFound } from "next/navigation";
import { getVideoDetailData } from "@/lib/data";
import { WatchExperience } from "@/components/watch-experience";

export const metadata = {
  title: "Watch",
  description: "Watch an SDA video, sermon or worship broadcast.",
};

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try {
    detail = await getVideoDetailData(id);
  } catch {
    // An id that no longer resolves is a dead link, not a server error: the
    // uploader may have removed the video since it was shared.
    notFound();
  }
  return <WatchExperience detail={detail} />;
}
