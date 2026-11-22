import { getVideoPageData, getVideoFacetsData } from "@/lib/data";
import { VideoExperience } from "@/components/video-experience";

export const metadata = {
  title: "Videos",
  description: "Watch authorized SDA worship, sermons, choirs and church stories.",
};

export default async function VideosPage() {
  // Both the first page and the facets come from the server, so the grid is
  // populated on first paint and every filter has a real label to show.
  const [initial, facets] = await Promise.all([
    getVideoPageData({ limit: 48 }),
    getVideoFacetsData(),
  ]);
  return <VideoExperience initial={initial} facets={facets} />;
}
