/**
 * The shelves of the reels feed.
 *
 * `classify.ts` answers one question — "is this music?" — and its answer is a
 * gate, not a feed. A feed needs something narrower: which of the fourteen
 * chips a reader is holding should this reel appear under. A choir video can
 * also be a Youth clip and a Mission clip, but the chip a reader taps has to
 * land somewhere definite, so the classifier returns exactly one shelf and
 * records why, the same way ingest does.
 *
 * The order below is the design. A video's shelf is decided by the most
 * *specific* promise its title makes, not by the most recent thing mentioned:
 *
 *   1. The spoken-word shelves, which share the wording of a title that was
 *      written to be understood (Sermons, Testimonies, Bible, Education).
 *   2. The occasion shelves — an event is a moment in time, so an event title
 *      beats a music type even when a choir is singing at it.
 *   3. The music shelves, which are the last word because a hymn sung at a
 *      camp meeting is still a hymn.
 *   4. The mission and people shelves, which are a video's *purpose* and so
 *      outrank its format.
 *   5. `church-life` as the floor, which is what an Adventist general channel
 *      uploading a Sabbath morning service is.
 *
 * Pure and synchronous, like the ingest gate it sits beside: reproducible from
 * its input, testable without a database, and safe to re-run over 86 rows when a
 * rule changes.
 */

/** The taxonomy ids, in the order the chips are shown. */
export const reelCategoryIds = [
  "for-you",
  "worship",
  "choirs",
  "mission",
  "youth",
  "bible",
  "testimonies",
  "sermons",
  "church-life",
  "events",
  "education",
  "community",
  "hymns",
  "instrumentals",
  "acapella",
] as const;

export type ReelCategoryId = (typeof reelCategoryIds)[number];

export type ReelCategory = {
  id: ReelCategoryId;
  label: string;
  description: string;
  position: number;
  /** `for-you` is the unfiltered feed, not a shelf — nothing is classified into it. */
  feed: "following" | "browse" | "mixed";
};

/**
 * The chips, in order. `for-you` leads because it is what the feed opens on,
 * and it is marked `mixed` because nothing is ever classified into it — it is
 * the absence of a classification, not one.
 */
export const reelCategories: ReelCategory[] = [
  { id: "for-you", label: "For you", description: "Everything the feed thinks you will like", position: 0, feed: "mixed" },
  { id: "worship", label: "Worship", description: "Sabbath worship, divine service and praise", position: 1, feed: "browse" },
  { id: "choirs", label: "Choirs", description: "Choirs, ensembles and choral masses", position: 2, feed: "browse" },
  { id: "mission", label: "Mission", description: "Outreach, evangelism and missionary work", position: 3, feed: "browse" },
  { id: "youth", label: "Youth", description: "Young people, Pathfinders and Adventist Youth", position: 4, feed: "browse" },
  { id: "bible", label: "Bible", description: "Scripture, study and devotional reading", position: 5, feed: "browse" },
  { id: "testimonies", label: "Testimonies", description: "People telling what God has done", position: 6, feed: "browse" },
  { id: "sermons", label: "Sermons", description: "Preaching, Bible studies and devotional talks", position: 7, feed: "browse" },
  { id: "church-life", label: "Church life", description: "What a week looks like at an Adventist church", position: 8, feed: "browse" },
  { id: "events", label: "Events", description: "Camp meetings, conventions, crusades and vespers", position: 9, feed: "browse" },
  { id: "education", label: "Education", description: "Schools, academies and study resources", position: 10, feed: "browse" },
  { id: "community", label: "Community", description: "The people and work around the church", position: 11, feed: "browse" },
  { id: "hymns", label: "Hymns", description: "Hymnals, nyimbo and traditional song", position: 12, feed: "browse" },
  { id: "instrumentals", label: "Instrumentals", description: "Piano, orchestra and guitar", position: 13, feed: "browse" },
  { id: "acapella", label: "Acapella", description: "Unaccompanied and all-voice singing", position: 14, feed: "browse" },
];

const byId = new Map(reelCategories.map((category) => [category.id, category]));

export function reelCategory(id: string | null | undefined): ReelCategory | null {
  if (!id) return null;
  return byId.get(id as ReelCategoryId) ?? null;
}

export function reelCategoryLabel(id: string | null | undefined): string {
  return reelCategory(id)?.label ?? "For you";
}

/** The kind of music the ingest gate already decided on, when it decided at all. */
export type MusicBucket = "choirs" | "hymns" | "instrumentals" | "acapella" | "worship" | "sermons" | null;

export type ReelClassifyInput = {
  title: string;
  description?: string | null;
  tags?: string[];
  /** The ingest bucket, used as a prior and never allowed to contradict a title. */
  musicCategory?: MusicBucket;
  /** A channel's own nature, as `classify.ts` determines it. */
  channelFocus?: "music" | "preaching" | "mixed";
};

export type ReelClassification = {
  category: ReelCategoryId;
  /** The term that decided it, so a shelf can be audited without re-running. */
  matchedTerm: string | null;
  /** Whether the ingest bucket, rather than the title, chose the shelf. */
  fromIngest: boolean;
};

type Rule = { id: ReelCategoryId; terms: string[] };

/**
 * Matched with word boundaries, for the same reason `classify.ts` does it: a
 * reader who searches a shelf for "mission" should not be shown a film called
 * "Commission", and a church called "Mission Hill" should not pull a whole feed.
 */
const rule = (id: ReelCategoryId, ...terms: string[]): Rule => ({ id, terms });

const RULES: Rule[] = [
  rule(
    "testimonies",
    "testimony", "testimonies", "testimonial", "testifying", "praise report", "grateful to god",
  ),
  // Before the spoken-word shelves, deliberately: a piece titled "Literature
  // evangelists report record scripture distribution" is about mission work that
  // happens to quote scripture, and filing it under Bible would put a reader
  // looking for a study looking at a report card.
  rule(
    "mission",
    "mission", "missionary", "missionaries", "evangelist", "evangelists", "evangelism", "evangelise",
    "evangelize", "evangelistic", "outreach", "literature evangelist", "planting churches",
    "church planting", "temperance", "public lectures", "health message", "community service",
    "healing", "helping the needy",
  ),
  rule(
    "youth",
    "youth", "young people", "yp", "pathfinders", "pathfinder", "adventist youth", "ayc", "jyc",
    "ambassador", "ambassadors", "students", "student", "campus", "college students", "teen", "teens",
    "children", "kids",
  ),
  rule(
    "sermons",
    "sermon", "sermons", "preaching", "preach", "preacher", "homily", "message", "devotional",
    "devotion", "bible study", "bible class", "study guide", "explaining", "explains", "lesson",
  ),
  rule(
    "bible",
    "bible", "scripture", "scriptures", "gospel of", "gospel", "psalm", "psalms", "passage",
    "meditation on", "reading the", "word of god", "in the bible", "bible in", "cross reference",
  ),
  rule(
    "events",
    "camp meeting", "campmeet", "campmeeting", "camp meetings", "campmeetings", "convention", "congress",
    "crusade", "crusades", "revival", "revival meetings", "seminar", "conference", "conferences",
    "anniversary", "vespers", "gathering", "rally", "programme", "program", "concert", "night of",
    "experience", "campfire",
  ),
  rule(
    "education",
    "academy", "college", "university", "school", "vbs", "seminary", "training", "class", "lesson plan",
    "tutorial", "how to study", "curriculum", "scholarship", "graduation",
  ),
  rule(
    "community",
    "fellowship", "community", "neighbourhood", "neighborhood", "together", "friendship", "family",
    "marriage", "youth camp", "food", "distribution", "donation", "charity",
  ),
  rule(
    "church-life",
    "church service", "divine service", "sabbath service", "prayer meeting", "prayer", "midweek",
    "communion", "ordinance", "pastor", "elder", "deacon", "bulletin", "announcement", "new year",
    "christmas", "easter", "good friday", "holy week", "palm sunday",
  ),
];

const MUSIC_RULES: Rule[] = [
  rule("acapella", "acapella", "a cappella", "vocal only", "all voices", "all-voices", "sings a cappella"),
  rule("choirs", "choir", "choirs", "choral", "ensemble", "quartet", "quintet", "oratorio", "cantata", "massed choir", "kwaya"),
  rule("instrumentals", "instrumental", "piano", "orchestra", "orchestral", "guitar", "strings", "violin", "flute", "no vocals", "meditation music"),
  rule("hymns", "hymn", "hymns", "hymnal", "nyimbo", "ndudzo", "himno", "imsangiso", "zambezi", "doxology", "cantico"),
  rule("worship", "worship", "worshipping", "worshiping", "praise", "adoration", "sanctuary", "tabernacle"),
];

/** Music buckets that may stand in for a title that says nothing useful. */
const INGEST_PRIORS: MusicBucket[] = ["choirs", "hymns", "instrumentals", "acapella", "worship"];

function normalise(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function match(ruleSet: Rule[], haystack: string): { id: ReelCategoryId; term: string } | null {
  for (const candidate of ruleSet) {
    for (const term of candidate.terms) {
      // A trailing plural is accepted, so a rule lists "evangelist" rather than
      // both "evangelist" and "evangelists" — and, more importantly, so that
      // adding a term cannot be silently half-applied to only one form.
      const suffix = term.endsWith("s") ? "" : "(?:e?s)?";
      const pattern = term
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+")
        .concat(suffix);
      if (new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(haystack)) {
        return { id: candidate.id, term };
      }
    }
  }
  return null;
}

/**
 * Assigns exactly one shelf.
 *
 * `sermons` is a valid result for music too — a choir singing during a service
 * that a preaching channel published lands there, which is the right answer for
 * a feed, and the reason the ingest prior is applied *last* rather than first.
 */
export function classifyReelCategory(input: ReelClassifyInput): ReelClassification {
  const haystack = normalise(
    [input.title, input.description ?? "", ...(input.tags ?? [])].filter(Boolean).join(" — "),
  );

  const topical = match(RULES, haystack);
  if (topical) return { category: topical.id, matchedTerm: topical.term, fromIngest: false };

  const musical = match(MUSIC_RULES, haystack);
  if (musical) return { category: musical.id, matchedTerm: musical.term, fromIngest: false };

  const prior = input.musicCategory ?? null;
  if (prior && INGEST_PRIORS.includes(prior)) {
    return { category: prior, matchedTerm: `ingest:${prior}`, fromIngest: true };
  }

  // A preaching channel with an untitled upload is a sermon far more often than
  // it is anything else, and `sermons` is also the right floor for a talk with
  // no detectable subject matter.
  if (input.channelFocus === "preaching" || prior === "sermons") {
    return { category: "sermons", matchedTerm: "channel:preaching", fromIngest: true };
  }

  return { category: "church-life", matchedTerm: null, fromIngest: false };
}

/**
 * The feed order: newest first, with a light nudge so that a shelf the reader
 * has just opened does not replay the same three videos in the same order.
 *
 * FNV-1a rather than a `charCode * 31` rolling sum, because a rolling sum over
 * short, similar ids — which is exactly what a set of YouTube ids looks like —
 * produces weights inside a narrow band, and a "shuffle" that only varies the
 * order within a narrow band is not a shuffle.
 */
export function reelFeedWeight(videoId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < videoId.length; index += 1) {
    hash ^= videoId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // One more avalanche step: the last character of the input is otherwise the
  // dominant bit of the output, and ids that differ only at the end would land
  // next to each other in the feed.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4_294_967_296;
}
