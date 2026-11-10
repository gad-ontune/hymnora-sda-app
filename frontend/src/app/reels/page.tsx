import type { Metadata } from "next";
import { ReelsExperience } from "@/components/reels-experience";
import { getReelFacetsData, getReelsData } from "@/lib/data";

export const metadata: Metadata = {
  title: "Reels",
  description: "Watch the voices worth watching from across the global Seventh-day Adventist church.",
};

/**
 * Reels renders on the server, not behind a client effect.
 *
 * The feed is a full-bleed stack of iframes; a page that server-renders one reel
 * and then fills the rest in is a black rectangle with a gap under it for as long
 * as the fetch takes. So the first page comes with the HTML, and the client only
 * refetches when the reader changes feed, shelf or region.
 */
export default async function ReelsPage({ searchParams }: { searchParams: Promise<{ reel?: string }> }) {
  const { reel } = await searchParams;
  const [initialPage, facets] = await Promise.all([
    getReelsData({ feed: "for-you", limit: 10 }).catch(() => ({
      items: [],
      total: 0,
      feed: "for-you" as const,
      personalised: false,
      hasMore: false,
    })),
    getReelFacetsData().catch(() => null),
  ]);

  return <ReelsExperience initialPage={initialPage} facets={facets} initialReelId={reel ?? null} />;
}
