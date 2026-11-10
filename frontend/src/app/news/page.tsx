import { getNewsArticlesData, getNewsFacetsData, getReelCountData } from "@/lib/data";
import { NewsExperience } from "@/components/news-experience";

export const metadata = {
  title: "News & Reels",
  description: "Read thoughtful SDA news and watch the voices worth watching from across the global church.",
};

export default async function NewsPage() {
  const [articles, facets, reelCount] = await Promise.all([
    getNewsArticlesData().catch(() => []),
    getNewsFacetsData().catch(() => ({ categories: [], regions: [] })),
    getReelCountData().catch(() => 0),
  ]);

  return <NewsExperience articles={articles} facets={facets} reelCount={reelCount} />;
}
