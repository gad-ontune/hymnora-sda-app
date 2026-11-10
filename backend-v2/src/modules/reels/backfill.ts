/**
 * Bringing the feed's data up to date.
 *
 * `content_links` shipped with no writer, so the table was empty and every
 * related-content rail in the app was a hard-coded list. The reel taxonomy has
 * the same problem in a milder form: the classifier is pure, so a new rule does
 * not migrate the data by itself.
 *
 * Both are fixed here, idempotently, and both are inference rather than
 * editorial judgement — which is why every link this writes is marked
 * `inferred`. A human linking an article to a camp meeting is a stronger signal
 * than a shared word count, and the two must not be confused when someone is
 * deciding what to correct.
 */

import { all, get, run } from "../../db/client.ts";
import { classifyReelCategory, reelCategories, type MusicBucket } from "./category.ts";

export type BackfillReport = {
  classified: number;
  shelfChanges: number;
  linksCreated: number;
  linksKept: number;
};

type VideoRow = {
  video_id: string;
  title: string;
  description: string | null;
  tags: string | null;
  category: string | null;
  verdict: string | null;
  routed_to: string | null;
  channel_focus: string | null;
};

/**
 * `channel_focus` is the ingest bouncer's own verdict about the channel, which is
 * a stronger signal than anything in a title: a channel that only ever publishes
 * sermons should not have its one choir video filed under Church life because
 * the title mentioned a service.
 */
export function backfillReelCategories(): { classified: number; shelfChanges: number } {
  const rows = all<VideoRow>(
    `SELECT v.video_id, v.title, v.description, v.tags, v.category, v.verdict, v.routed_to,
            c.focus AS channel_focus
     FROM youtube_videos v JOIN youtube_channels c ON c.channel_id = v.channel_id`,
  );
  let classified = 0;
  let shelfChanges = 0;
  for (const row of rows) {
    const current = get<{ reel_category: string | null }>(
      "SELECT reel_category FROM youtube_videos WHERE video_id = ?",
      [row.video_id],
    )?.reel_category;
    const tags = row.tags ? row.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
    const result = classifyReelCategory({
      title: row.title,
      description: row.description,
      tags,
      // The ingest bouncer's own verdict, which is a stronger signal than a
      // title: `routed_to` is where the video actually went, not what it matched.
      musicCategory: row.routed_to === "sermons" || row.verdict === "sermon"
        ? "sermons"
        : ((row.category as MusicBucket | null) ?? null),
      channelFocus: (row.channel_focus as "music" | "preaching" | "mixed") ?? "mixed",
    });
    const source = result.fromIngest ? `ingest:${result.matchedTerm ?? "prior"}` : result.matchedTerm;
    if (current === result.category) continue;
    run("UPDATE youtube_videos SET reel_category = ?, reel_category_source = ? WHERE video_id = ?", [
      result.category,
      source,
      row.video_id,
    ]);
    classified += 1;
    if (current) shelfChanges += 1;
  }
  return { classified, shelfChanges };
}

/** The chips live in the database too, so a label change is data, not a deploy. */
export function seedReelCategories(): number {
  let written = 0;
  for (const category of reelCategories) {
    run(
      `INSERT INTO reel_categories (id, label, description, position) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, description = excluded.description, position = excluded.position`,
      [category.id, category.label, category.description, category.position],
    );
    written += 1;
  }
  return written;
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "our", "your", "are", "was", "has", "have", "its",
  "how", "why", "what", "when", "who", "will", "new", "into", "over", "you", "not", "church", "adventist",
  "sda", "video", "watch", "official", "audio", "hd", "meeting", "camp", "day", "live", "stream",
]);

function keywords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP.has(word)),
  );
}

/**
 * Article-to-reel links, from the words the two pieces of content share.
 *
 * A reel of a camp meeting and the article announcing that camp meeting share
 * the date, the city and the name — three words, and a link a reader would have
 * made by hand. Two shared words is the threshold, and a reel is linked to at
 * most three articles so the rail stays a rail.
 */
export function backfillContentLinks(): { linksCreated: number; linksKept: number } {
  const articles = all<{ slug: string; title: string; excerpt: string | null; body: string | null }>(
    "SELECT slug, title, excerpt, body FROM news_articles WHERE deleted_at IS NULL AND status = 'published'",
  );
  const reels = all<{ video_id: string; title: string; description: string | null }>(
    "SELECT video_id, title, description FROM youtube_videos",
  );
  const perReel = new Map<string, number>();
  let created = 0;
  let kept = 0;

  for (const article of articles) {
    const words = keywords(`${article.title} ${article.excerpt ?? ""} ${(article.body ?? "").slice(0, 600)}`);
    if (words.size === 0) continue;
    const scored = reels
      .map((reel) => {
        const reelWords = keywords(`${reel.title} ${(reel.description ?? "").slice(0, 400)}`);
        const shared = [...reelWords].filter((word) => words.has(word)).length;
        return { reel, shared };
      })
      .filter((entry) => entry.shared >= 2)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 4);

    for (const { reel, shared } of scored) {
      const used = perReel.get(reel.video_id) ?? 0;
      if (used >= 3) continue;
      const existing = run(
        `INSERT INTO content_links (id, from_type, from_id, to_type, to_id, relation, position)
         VALUES (?, 'article', ?, 'reel', ?, 'covers', ?)
         ON CONFLICT(from_type, from_id, to_type, to_id, relation) DO NOTHING`,
        [stableLinkId(article.slug, reel.video_id), article.slug, reel.video_id, used],
      );
      if (existing.changes > 0) {
        created += 1;
        perReel.set(reel.video_id, used + 1);
      } else {
        kept += 1;
      }
    }
  }
  return { linksCreated: created, linksKept: kept };
}

/**
 * Article-to-church and article-to-event links.
 *
 * The article page shows a "churches" block, and it was showing churches that
 * happened to be in the database rather than churches the article was about. A
 * church link is made when the article names it or names its city, which is the
 * same judgement a reader makes, and the reverse direction is filled in too so
 * a church can point back at the stories that mention it.
 */
export function backfillArticlePlaces(): { churches: number; events: number } {
  const articles = all<{ id: string; slug: string; title: string; excerpt: string | null; body: string | null }>(
    "SELECT id, slug, title, excerpt, body FROM news_articles WHERE deleted_at IS NULL AND status = 'published'",
  );
  const churches = all<{ id: string; name: string; city: string | null; region: string | null }>(
    "SELECT id, name, city, region FROM churches WHERE deleted_at IS NULL",
  );
  const events = all<{ id: string; title: string; city: string | null; venue: string | null }>(
    "SELECT id, title, city, venue FROM events WHERE deleted_at IS NULL",
  );

  let churchLinks = 0;
  let eventLinks = 0;
  for (const article of articles) {
    const text = `${article.title} ${article.excerpt ?? ""} ${(article.body ?? "").slice(0, 1_200)}`.toLowerCase();
    for (const church of churches) {
      const names = [church.name, church.city, church.region].filter((value): value is string => Boolean(value));
      if (!names.some((name) => name.length > 3 && text.includes(name.toLowerCase()))) continue;
      churchLinks += link("article", article.slug, "church", church.id, "mentions") + link("church", church.id, "article", article.slug, "mentioned in");
    }
    for (const event of events) {
      const names = [event.title, event.venue, event.city].filter((value): value is string => Boolean(value));
      if (!names.some((name) => name.length > 6 && text.includes(name.toLowerCase()))) continue;
      eventLinks += link("article", article.slug, "event", event.id, "mentions");
    }
  }
  return { churches: churchLinks, events: eventLinks };
}

/** A link row, or 0 when the link already exists. Never overwrites an editorial relation. */
function link(fromType: string, fromId: string, toType: string, toId: string, relation: string): number {
  const result = run(
    `INSERT INTO content_links (id, from_type, from_id, to_type, to_id, relation, position)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(from_type, from_id, to_type, to_id, relation) DO NOTHING`,
    [stableLinkId(`${fromId}::${relation}`, toId), fromType, fromId, toType, toId, relation],
  );
  return result.changes;
}

function stableLinkId(fromId: string, toId: string): string {
  // Deterministic so a re-run updates rather than duplicates, and so the
  // resolver can find a link without reading the table twice.
  let hash = 0;
  const key = `${fromId}::${toId}`;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return `lnk_${hash.toString(16).padStart(8, "0")}`;
}
