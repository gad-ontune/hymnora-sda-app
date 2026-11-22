import type { Metadata } from "next";
import { ReelCreateExperience } from "@/components/reel-create-experience";
import { getReelFacetsData } from "@/lib/data";

export const metadata: Metadata = {
  title: "Reel Studio",
  description: "Shape a four-minute reel with local filters, trim points, cover frames and drafts.",
};

/**
 * The shelves come from the reels API so the studio's category chips stay in
 * step with the feed. A failed facets request still leaves a usable studio —
 * the component carries a small fallback list.
 */
export default async function ReelCreatePage() {
  const facets = await getReelFacetsData().catch(() => null);

  return <ReelCreateExperience categories={facets?.all ?? []} />;
}
