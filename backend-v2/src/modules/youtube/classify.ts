/**
 * Content classification for the ingest pipeline.
 *
 * This is the gate between "a video an SDA channel uploaded" and "a row the
 * music page can play". It runs on every single upload the poller sees, and it
 * is deliberately conservative: a false negative costs a missing song, a false
 * positive puts a forty-minute sermon on the front page of a listening app
 * aimed at people reading scripture. So the order matters and it is not
 * negotiable:
 *
 *   Step A — Exclude. Spoken word loses, even if it also mentions a choir.
 *   Step B — Include. Surviving video must actually look like music.
 *   Step C — Categorise. Assign exactly one sub-category.
 *
 * Step A before Step B is the whole design. A single-purpose preaching channel
 * publishes "Sabbath School:第 lesson" and a single-purpose choir channel
 * publishes "Nyimbo za Kristo — 5. Msimamizi" from the same denomination, and
 * only one of them belongs on the music page.
 *
 * Pure and synchronous on purpose: no clock, no database, no network. Every
 * decision is reproducible from `(title, description, channelFocus)`, which is
 * what makes `tests/classify.test.ts` worth writing.
 */

/** What the pipeline should do with a video. */
export type Verdict = "music" | "sermon" | "skipped";

/** The buckets the music page renders as rows. */
export type MusicCategory = "choirs" | "hymns" | "instrumentals" | "acapella" | "worship";

export type Classification = {
  verdict: Verdict;
  category: MusicCategory | null;
  tags: string[];
  /** 0–1. Only meaningful for `verdict === "music"`. */
  confidence: number;
  /** Human-readable trace of the decision, stored on `youtube_videos`. */
  reasons: string[];
  /** The include keyword that carried the video into the music pipeline. */
  matchedKeyword: string | null;
  /** The exclude keyword that bailed it out, when Step A fired. */
  excludedKeyword: string | null;
};

/**
 * A channel's own nature. `focus` is the bouncer's first input: a channel
 * dedicated to preaching is routed to sermons on a lighter signal than a
 * general church channel, because its uploads are sermons by default.
 */
export type ChannelFocus = "music" | "preaching" | "mixed";

export type ClassifyInput = {
  title: string;
  description?: string | null;
  channelFocus?: ChannelFocus;
  /** IETF tags YouTube reports on the video, when it reports any. */
  tags?: string[];
  /** Shorts and live replays under a minute are not "songs". */
  durationSeconds?: number;
};

/**
 * Step A — spoken word, preaching, and anything that is a lesson rather than a
 * song. Matched with word boundaries so "sermon" does not fire inside
 * "sermonlessness" and, more importantly, so a title like
 * "Sermon: how the choir found its voice" still loses.
 */
const EXCLUDE_PATTERNS: { term: string; re: RegExp }[] = [
  { term: "sermon", re: /\bsermons?\b/i },
  { term: "preaching", re: /\bpreach(?:ing|ed|er|ers)?\b/i },
  { term: "pastor", re: /\bpastors?\b/i },
  // The courtesy titles, not just the words. East African channels sign a
  // preacher as "Pr. David Mmbaga" or "Pst. John" or, in Swahili, "Mch." (for
  // "Mchungaji") — a title like that is the whole biography of a sermon, and
  // without these a Week of Prayer series on a mixed channel would sit
  // keywordless in Step B and be dropped as neither song nor sermon.
  //
  // `(?!\w)` rather than `\b`, because the trailing boundary never fires: a
  // word boundary needs a word character on one side and a non-word one on the
  // other, and both "." and the following space are non-word. The lookahead
  // still rejects "Pr.X" and "April." both before "pr" and after the period.
  { term: "pr.", re: /\bpr\.(?!\w)/i },
  { term: "pst.", re: /\bpst\.(?!\w)/i },
  { term: "mch.", re: /\bmch\.(?!\w)/i },
  { term: "mchungaji", re: /\bmchungaji\b/i },
  { term: "hutubani", re: /\bhutubani\b/i },
  { term: "sabbath school", re: /\bsabbath[\s-]?school\b/i },
  { term: "seminar", re: /\bseminar(?:s)?\b/i },
  { term: "prophetic message", re: /\bprophetic\s+(?:message|prophesy|worship)\b/i },
  { term: "prophesy", re: /\bprophes(?:y|ies|ing|ied)\b/i },
  { term: "bible study", re: /\bbible[\s-]?study\b/i },
  { term: "scripture study", re: /\bscripture[\s-]?study\b/i },
  { term: "devotion talk", re: /\bdevotional\s+(?:talk|message|lesson|series)\b/i },
  { term: "lesson", re: /\blesson\s+\d+\b/i },
  { term: "study guide", re: /\bstudy\s+guide\b/i },
  { term: "testimony", re: /\btestimon(?:y|ies)\b/i },
  { term: "prayer meeting", re: /\bprayer\s+(?:meeting|request|hour)\b/i },
  { term: "vespers", re: /\bvespers\b/i },
  { term: "camp meeting", re: /\bcamp\s+meeting\b/i },
  { term: "revival", re: /\brevival\s+(?:series|week|night|day)\b/i },
  { term: "anniversary", re: /\b(?:annual|thanksgiving)\s+anniversary\b/i },
  { term: "funeral", re: /\bfuneral\b/i },
  { term: "wedding", re: /\bwedding\b/i },
  { term: "interview", re: /\b(?:interview|conversation with|q&a|q and a)\b/i },
  { term: "documentary", re: /\b(?:documentary|behind the scenes|episode \d+)\b/i },
  { term: "how to", re: /\bhow\s+to\b/i },
  { term: "tutorial", re: /\btutorial\b/i },
  { term: "commentary", re: /\b(?:commentary|exposition|lecture)\b/i },
  { term: "announcement", re: /\b(?:announcement|notice|important notice)\b/i },
  { term: "trial", re: /\btrial\s+(?:service|session|meeting)\b/i },
  // A livestream marker. A church uploads its whole service to YouTube Live and
  // the "LIVE" badge stays in the title afterwards, so this catches the ones
  // whose title carries no other signal (see "🔴 LIVE :MAKAMBI MTAA WA
  // KURASINI 2026" on a music channel — a four-hour service, not a song).
  { term: "live stream", re: /\blivestream|\blive\s+stream\b|\blive\b\s*[:：]/i },
  { term: "live broadcast", re: /\blive\s+(?:broadcast|coverage|programme|program)\b/i },
];

/**
 * Step B — the music vocabulary. Bilingual on purpose: a good share of the
 * whitelist is East African, and `kwaya` / `nyimbo` / `ndudzo` never appear in
 * an English keyword list, so an English-only filter would empty the
 * "Trending in Kenya & East Africa" row.
 */
/**
 * `decisive` marks a term that describes the *form* of the recording rather than
 * the material it was written from. "Hymns for Piano, No Vocals" and "Acapella
 * version of Hymn 108" both name a hymn, but neither is a choir performance of
 * one. When a decisive term appears in the title it settles the category on its
 * own instead of out-scoring the source-material terms, which would otherwise
 * double-weight the same word.
 */
const INCLUDE_PATTERNS: { term: string; re: RegExp; category: MusicCategory; weight: number; decisive?: boolean }[] = [

  // Choirs
  { term: "choir", re: /\bchoirs?\b/i, category: "choirs", weight: 3 },
  { term: "choral", re: /\bchoral\b/i, category: "choirs", weight: 2 },
  { term: "kwaya", re: /\bkwaya\b/i, category: "choirs", weight: 3 },
  { term: "ensemble", re: /\bensembles?\b/i, category: "choirs", weight: 2 },
  { term: "voices", re: /\bvoices\b/i, category: "choirs", weight: 1 },
  { term: "quartet", re: /\bquartets?\b/i, category: "choirs", weight: 2 },
  { term: "oratorio", re: /\boratorio\b/i, category: "choirs", weight: 3 },
  { term: "cantata", re: /\bcantata\b/i, category: "choirs", weight: 3 },
  { term: "massed", re: /\bmassed\s+(?:choir|bands|voices)\b/i, category: "choirs", weight: 2 },

  // Hymns
  { term: "hymn", re: /\bhymns?\b/i, category: "hymns", weight: 3 },
  { term: "hymnal", re: /\bhymnals?\b/i, category: "hymns", weight: 3 },
  { term: "nyimbo za kristo", re: /\bnyimbo\s+za\s+kristo\b/i, category: "hymns", weight: 3 },
  { term: "nyimbo", re: /\bnyimbo\b/i, category: "hymns", weight: 2 },
  { term: "ndudzo", re: /\bndudzo\b/i, category: "hymns", weight: 3 },
  { term: "himno", re: /\bhimnos?\b/i, category: "hymns", weight: 3 },
  { term: "worship song", re: /\bworship\s+songs?\b/i, category: "hymns", weight: 2 },
  { term: "praise", re: /\b(?:praise|worship)\s+(?:song|medley|service\s+audio)\b/i, category: "hymns", weight: 1 },
  { term: "gazebo", re: /\bgazebo\b/i, category: "hymns", weight: 2 },
  { term: "doxology", re: /\bdoxolog(?:y|ies)\b/i, category: "hymns", weight: 2 },

  // Instrumentals
  { term: "instrumental", re: /\binstrumentals?\b/i, category: "instrumentals", weight: 3, decisive: true },
  { term: "piano", re: /\bpianos?\b/i, category: "instrumentals", weight: 2 },
  { term: "orchestra", re: /\borchestras?\b/i, category: "instrumentals", weight: 2 },
  { term: "guitar", re: /\b(?:acoustic\s+)?guitars?\b/i, category: "instrumentals", weight: 2 },
  { term: "no vocals", re: /\b(?:no\s+vocals|instrumental\s+only|backing\s+track)\b/i, category: "instrumentals", weight: 3, decisive: true },

  { term: "meditation", re: /\b(?:meditation|relaxation|study\s+music|sleep\s+music)\b/i, category: "instrumentals", weight: 2 },
  { term: "string quartet", re: /\bstrings?\b/i, category: "instrumentals", weight: 1 },

  // Acapella
  { term: "acapella", re: /\ba[\s-]?capellas?\b/i, category: "acapella", weight: 3, decisive: true },
  { term: "a cappella", re: /\ba\s+cappellas?\b/i, category: "acapella", weight: 3, decisive: true },
  { term: "vocal only", re: /\bvocal[\s-]?only\b/i, category: "acapella", weight: 2, decisive: true },
  { term: "all voices", re: /\ball\s+voices\b/i, category: "acapella", weight: 1 },
  { term: "round", re: /\b(?:singerly\s+round|rounds?\s+and\s+canons?)\b/i, category: "acapella", weight: 1 },

  // General worship
  { term: "worship", re: /\bworship\b/i, category: "worship", weight: 1 },
  { term: "sabbat", re: /\bsabbath\b/i, category: "worship", weight: 1 },
  { term: "divine service", re: /\bdivine\s+(?:service|worship)\b/i, category: "worship", weight: 2 },
];

/**
 * Below this score a video is recorded and left out of the music page rather
 * than being shown and then being wrong. Tuned so that a title carrying a
 * single strong term ("Nyimbo za Kristo", "Acapella", "Instrumental") clears
 * it, while a bare "Worship" on a mixed channel does not.
 */
const MUSIC_THRESHOLD = 3;

/** Anything shorter than this is a clip or a jingle, not a piece of music. */
const MIN_MUSIC_SECONDS = 45;

export function classify(input: ClassifyInput): Classification {
  const focus = input.channelFocus ?? "mixed";
  const title = input.title ?? "";
  const description = input.description ?? "";
  // The title is what a human curator would read; the description is supporting
  // evidence. Weighting them differently stops a channel whose boilerplate
  // footer says "Sermon excerpts available" from poisoning every video.
  const titleLower = title.toLowerCase();
  const descriptionLower = description.toLowerCase();
  const haystack = `${titleLower}\n${descriptionLower}`;

  const reasons: string[] = [];
  const tags: string[] = [];

  // ── Step A: the bouncer ───────────────────────────────────────────────
  const excluded = findFirst(EXCLUDE_PATTERNS, haystack);
  if (excluded) {
    // A channel that only ever publishes music is allowed one more chance: the
    // word "sermon" in a choir video's description should not delete it. The
    // title still has to pass Step B on its own.
    const inTitleOnly = findFirst(EXCLUDE_PATTERNS, titleLower);
    const rescued = focus === "music" && !inTitleOnly && findFirst(INCLUDE_PATTERNS, titleLower);
    if (rescued) {
      reasons.push(
        `Excluded on "${excluded}" in the description, but this is a music-only channel and the title matches "${rescued.term}"`,
      );
    } else {
      reasons.push(`Excluded by Step A: "${excluded.term}"`);
      return {
        verdict: "sermon",
        category: null,
        tags: [],
        confidence: 1,
        reasons,
        matchedKeyword: null,
        excludedKeyword: excluded.term,
      };
    }
  }

  // ── Step B: is it music? ──────────────────────────────────────────────
  const titleMatches = findAll(INCLUDE_PATTERNS, titleLower);
  const descriptionMatches = findAll(INCLUDE_PATTERNS, descriptionLower);
  const matches = dedupeByTerm([...titleMatches, ...descriptionMatches]);

  // The "worship" bucket is the only one that describes the *occasion* rather
  // than the music, and "Sabbath" appears in the boilerplate of essentially
  // every SDA channel including choir-only ones. On a preaching channel, a video
  // whose only music signal is that bucket is a sermon, not a badly-classified
  // song — so it is routed there before the score is ever computed.
  if (focus === "preaching" && matches.length > 0 && matches.every((match) => match.category === "worship")) {
    reasons.push('Routed to sermons: a preaching channel matched only occasion words ("worship", "Sabbath")');
    return {
      verdict: "sermon",
      category: null,
      tags: [],
      confidence: 0.9,
      reasons,
      matchedKeyword: null,
      excludedKeyword: null,
    };
  }

  if (matches.length === 0) {
    reasons.push("Rejected by Step B: no music keyword in the title or description");
    return {
      verdict: focus === "preaching" ? "sermon" : "skipped",
      category: null,
      tags: [],
      confidence: 0,
      reasons,
      matchedKeyword: null,
      excludedKeyword: null,
    };
  }

  const duration = input.durationSeconds ?? 0;
  if (duration > 0 && duration < MIN_MUSIC_SECONDS) {
    reasons.push(`Skipped: ${duration}s is shorter than the ${MIN_MUSIC_SECONDS}s music floor`);
    return {
      verdict: "skipped",
      category: null,
      tags: [],
      confidence: 0,
      reasons,
      matchedKeyword: null,
      excludedKeyword: null,
    };
  }

  // ── Step C: categorise ────────────────────────────────────────────────
  // A decisive title term settles the category on its own. This runs before the
  // scoring because scoring alone gets it wrong: "Hymns for Piano, No Vocals"
  // scores its two hymn spellings at 12 and its instrumental signals at 10.
  const decisive = titleMatches.find((match) => match.decisive);

  const scores = new Map<MusicCategory, number>();
  const titleTerms = new Set(titleMatches.map((match) => match.term));
  for (const match of matches) {
    if (decisive && match.decisive) continue;
    const bonus = titleTerms.has(match.term) ? 2 : 1;
    scores.set(match.category, (scores.get(match.category) ?? 0) + match.weight * bonus);
  }
  if (decisive) scores.set(decisive.category, (scores.get(decisive.category) ?? 0) + decisive.weight * 4);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [winner, topScore] = ranked[0]!;
  const runnerUp = ranked[1]?.[1] ?? 0;


  const base = titleMatches.length > 0 ? topScore : Math.max(0, topScore - 1);
  // A clear winner is trusted; a near-tie is reported honestly with a lower
  // number so the music page can be tuned later without re-reading the rules.
  const separation = topScore - runnerUp;
  const confidence = Math.min(1, base / 8 + (separation >= 2 ? 0.1 : 0));

  tags.push(...matches.map((match) => match.term));
  if (input.tags?.length) {
    for (const tag of input.tags.slice(0, 5)) {
      if (tag && !tags.includes(tag.toLowerCase())) tags.push(tag.toLowerCase());
    }
  }

  reasons.push(
    `Matched in Step B: ${matches.slice(0, 4).map((match) => `"${match.term}"`).join(", ")}`,
    `Categorised as ${winner} (score ${topScore}${separation > 0 ? `, ${separation} ahead of the next bucket` : ""})`,
  );

  // A near-tie between "hymns" and "worship" is not worth a low score: both
  // land in the same page. The threshold only rejects genuine ambiguity.
  if (confidence < 0.4 && topScore < MUSIC_THRESHOLD) {
    reasons.push("Skipped: no single music keyword carried enough weight");
    return {
      verdict: "skipped",
      category: null,
      tags,
      confidence,
      reasons,
      matchedKeyword: matches[0]?.term ?? null,
      excludedKeyword: null,
    };
  }

  return {
    verdict: "music",
    category: winner,
    tags: [...new Set(tags)].slice(0, 12),
    confidence,
    reasons,
    matchedKeyword: titleMatches[0]?.term ?? matches[0]?.term ?? null,
    excludedKeyword: null,
  };
}

/**
 * Titles are frequently wrapped in emoji, bracketed channel names, and
 * `#Shorts`. Normalising first is what makes the word boundaries hold.
 */
export function normalizeText(value: string): string {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/[#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findFirst<T extends { re: RegExp }>(patterns: T[], haystack: string): T | null {
  for (const pattern of patterns) {
    if (pattern.re.test(haystack)) return pattern;
  }
  return null;
}

function findAll<T extends { re: RegExp; term: string }>(patterns: T[], haystack: string): T[] {
  return patterns.filter((pattern) => pattern.re.test(haystack));
}

function dedupeByTerm<T extends { term: string }>(matches: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const match of matches) {
    if (seen.has(match.term)) continue;
    seen.add(match.term);
    out.push(match);
  }
  return out;
}

/** Exposed so the ingest audit trail can explain a verdict in a UI. */
export const classifierVocabulary = {
  excludeTerms: EXCLUDE_PATTERNS.map((pattern) => pattern.term),
  includeTerms: INCLUDE_PATTERNS.map((pattern) => pattern.term),
  musicThreshold: MUSIC_THRESHOLD,
  minMusicSeconds: MIN_MUSIC_SECONDS,
};
