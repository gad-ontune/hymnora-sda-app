import { getVideoPageData, getVideoFacetsData } from "@/lib/data";
import { VideoExperience } from "@/components/video-experience";

export const metadata = {
  title: "Videos",
  description: "Watch authorized SDA worship, sermons, choirs and church stories.",
};

export default async function VideosPage() {
  // Both the first page and the facet counts come from the server, so the grid
  // is populated on first paint and the chip counts are real rather than guesses.
  const [initial, facets] = await Promise.all([
    getVideoPageData({ limit: 24 }),
    getVideoFacetsData(),
  ]);
  return <VideoExperience initial={initial} facets={facets} />;
}
