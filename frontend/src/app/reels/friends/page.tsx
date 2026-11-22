import type { Metadata } from "next";
import { ReelFriendsExperience } from "@/components/reel-friends-experience";
import { getReelFacetsData, getReelsData } from "@/lib/data";

export const metadata: Metadata = {
  title: "Friends · Reels",
  description: "The channels, choirs and causes behind the reels you watch.",
};

/**
 * The first paint comes from the server so the page is never an empty shell.
 * The client re-asks with the viewer's token once it knows there is a session:
 * follows and the "Following" feed are personal, while the public shelf is
 * still useful to somebody who has not signed in.
 */
export default async function ReelsFriendsPage() {
  const [facets, following, publicFeed] = await Promise.all([
    getReelFacetsData().catch(() => null),
    getReelsData({ feed: "following", limit: 12 }).catch(() => null),
    getReelsData({ feed: "for-you", limit: 12 }).catch(() => null),
  ]);

  return (
    <ReelFriendsExperience
      initialFacets={facets}
      initialFollowing={following}
      initialPublic={publicFeed}
    />
  );
}
