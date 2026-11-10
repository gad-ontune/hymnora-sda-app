import { browseMusicData, getMusicFacetsData } from "@/lib/data";
import { BrowseExperience } from "@/components/browse-experience";

export const metadata = {
  title: "Browse music",
  description: "A filtered view of the Hymnora music catalogue.",
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; region?: string; title?: string }>;
}) {
  const params = await searchParams;
  const category = params.category ?? "";
  const region = params.region ?? "";
  const [page, facets] = await Promise.all([
    browseMusicData({ category: category || undefined, region: region || undefined, limit: 40 }),
    getMusicFacetsData(),
  ]);
  return (
    <BrowseExperience
      title={params.title ?? "Browse the catalogue"}
      description="Every recording we hold from the churches, choirs and ministries we follow, filtered however you like."
      initial={page.items}
      initialTotal={page.total}
      facets={facets}
      category={category}
      region={region}
    />
  );
}
