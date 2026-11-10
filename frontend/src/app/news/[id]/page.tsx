import { notFound } from "next/navigation";
import { getNewsArticleData, getNewsArticlesData, getNewsRelatedData, getReelsData } from "@/lib/data";
import { ArticleExperience } from "@/components/article-experience";
import type { RelatedItem, Reel } from "@/lib/types";

export const metadata = {
  title: "Read a story",
  description: "A single story from the Hymnora SDA newsroom.",
};

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A slug that no longer resolves is a dead shared link, not a server fault.
  const article = await getNewsArticleData(id).catch(() => null);
  if (!article) notFound();

  /**
   * The related rail is the real thing: `GET /news/:idOrSlug/related` answers
   * with the links an editor made plus anything the server could infer, each
   * marked `linked` or `inferred`, and it brings the church and event this story
   * is about along with it.
   *
   * The fallbacks exist because a brand-new story can have no links at all yet.
   * Same-desk stories and the general reel feed are then the rail — labelled as
   * what they are, rather than shown as though they had been chosen for this
   * article.
   */
  const [all, rail, reels] = await Promise.all([
    getNewsArticlesData().catch(() => []),
    getNewsRelatedData(id).catch(() => null),
    getReelsData({ limit: 4 }).catch(() => null),
  ]);

  const sameDesk = all.filter((story) => story.id !== article.id && story.category === article.category);
  const others = sameDesk.length > 0 ? sameDesk : all.filter((story) => story.id !== article.id);

  const linked = rail?.items ?? [];
  const linkedStories = linked.filter((item) => item.type === "article");
  const linkedReels = linked.filter((item) => item.type === "reel");
  const places = linked.filter((item) => item.type === "church" || item.type === "event");

  const relatedStories = (linkedStories.length > 0 ? linkedStories : others.slice(0, 3).map(toRelatedStory));
  const reelRail = linkedReels.length > 0 ? linkedReels : (reels?.items ?? []).map(toRelatedReel);

  return (
    <ArticleExperience
      article={article}
      related={relatedStories}
      relatedReels={reelRail}
      places={places}
      relatedIsInferred={linkedStories.length === 0}
      reelsAreInferred={linkedReels.length === 0}
    />
  );
}

/** Same shape the API returns, so one rail component can render both sources. */
function toRelatedStory(story: Awaited<ReturnType<typeof getNewsArticlesData>>[number]): RelatedItem {
  return {
    type: "article",
    id: story.id,
    title: story.title,
    subtitle: story.category,
    href: `/news/${story.slug}`,
    imageUrl: story.image,
    meta: `${story.date} · ${story.readTime}`,
    via: "inferred",
  };
}

function toRelatedReel(reel: Reel): RelatedItem {
  return {
    type: "reel",
    id: reel.videoId,
    title: reel.title,
    subtitle: reel.channel,
    href: `/reels?reel=${reel.videoId}`,
    imageUrl: reel.thumbnail,
    meta: reel.reelCategoryLabel,
    via: "inferred",
  };
}
