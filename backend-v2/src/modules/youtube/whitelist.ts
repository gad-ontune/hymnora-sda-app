/**
 * The whitelist: the only channels the pipeline will ever ask YouTube about.
 *
 * ⚠️  READ THIS BEFORE DEPLOYING
 * ──────────────────────────────
 * PROVENANCE IS PER-REGION, and the two halves are in very different states:
 *
 *   east-africa  — VERIFIED. Every `channelId` was resolved from a live
 *                  `search.list` → `channels.list` lookup, and each `title`/
 *                  `handle` pair is copied from the channel's own metadata.
 *   west-africa  — one entry (GNAAS UCC Media) verified the same way; the
 *                  remaining entries are still placeholders.
 *   everything else (southern-africa, europe, north-america, global)
 *                — PLACEHOLDERS. The `UC…` ids are hand-written and resolve to
 *                  nothing. Their titles are likewise not real channel names and
 *                  must not be trusted as a description of what exists.
 *
 * A wrong id does not fail loudly. It makes the poller ask about a channel that
 * does not exist, spend quota, and quietly return nothing, so the music page
 * just stays empty. `npm run channels:verify` prints OK/MISS/DIFF per entry.
 *
 * Before enabling the worker, resolve the remaining placeholders. The original
 * titles in those regions were written from a plausible guess at what an
 * SDA-run channel would be called, not from the channels that actually exist —
 * the East African pass turned up 12 guessed names and 0 real matches. Real
 * channels exist, they are just named differently ("Rwanda SDA Hymns", not
 * "Rwanda Adventist Hymnal Singers"). Resolve by searching the name, then
 * confirm the About page is the organisation you expect before adding it.
 *
 *     npm run channels:probe            # search titles, cache candidates
 *     npm run channels:probe -- --cached   # re-rank with no extra quota
 *     npm run channels:resolve @handle # handle → id
 *     npm run channels:verify          # live check of every entry
 *
 * This list *is* the quota strategy. The poller has no search capability and no
 * way to discover channels, so the cost of the entire ingest is a function of
 * how many rows are here — not of how many people are browsing the app. Sixty
 * channels is 61 units per poll.
 *
 * `focus` is the one fact the classifier needs:
 *
 *   music    — publishes songs. Step A gets a second chance on description-only
 *              exclude hits, so a choir's "Sermon excerpts available" footer
 *              does not delete its uploads.
 *   preaching— publishes messages. Routed to sermons on a lighter signal.
 *   mixed    — a general church channel. Nothing gets the benefit of the doubt.
 *
 * `denomination` is the affiliation gate, and it is the ONLY thing that decides
 * whether a channel May appear here at all:
 *
 *   sda     — publishes Seventh-day Adventist worship. The only thing this
 *             platform claims to carry, so the only thing that gets ingested.
 *   other   — a channel we encountered that is NOT SDA ("AIC" is the Africa
 *             Inland Church, a different denomination). It stays on the list
 *             only as a record; the ingest refuses it, `channels:verify`
 *             reports it, and nobody should need to remember why it is absent.
 *
 * The classifier never gets to make this call. It only decides music-vs-sermon
 * AFTER the affiliation gate has already admitted a channel — naming a choir
 * "… Choir" is enough to trip the music classifier on a genuinely SDA channel,
 * and it is also exactly how a non-SDA choir would get in without this gate.
 *
 * `region` drives the "Trending in Kenya & East Africa" row, so channels are
 * marked by the country they serve, which is not always the country YouTube
 * reports on the channel itself (Rwanda SDA Hymns is registered in GB).
 *
 * Adding a channel: resolve it against the API and check the About page by
 * hand, then insert it. Never add one because a search result suggested it —
 * the East African probe turned up both fan-upload channels and auto-generated
 * "- Topic" channels in its results, and only the human check separates those
 * from the real thing.
 */

export type WhitelistSeed = {
  channelId: string;
  title: string;
  handle: string | null;
  country: string;
  region: "east-africa" | "southern-africa" | "west-africa" | "europe" | "north-america" | "global";
  language: string;
  focus: "music" | "preaching" | "mixed";
  /** sda = the only thing this platform claims; other = present only for the record. */
  denomination: "sda" | "other";
};

export const CHANNEL_WHITELIST: WhitelistSeed[] = [
  // ─── East Africa ────────────────────────────────────────────────────────
  // Verified against the YouTube Data API: every channelId below was returned by
  // a live `search.list` → `channels.list` lookup, and title/handle match the
  // channel's own metadata. Region/country here are editorial groupings and may
  // differ from the country YouTube reports on the channel itself.
  {
    channelId: "UC8Dff5j4bmf2xcqsZAvz4nQ",
    title: "Kurasini SDA Choir",
    handle: "@kurasinisdachoir",
    country: "Tanzania",
    region: "east-africa",
    language: "Kiswahili",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCp6hUP-_0cm-QOh_kTNw6Xw",
    title: "Nyimbo Za Kristo SDA",
    handle: "@nyimbozakristosdaofficial",
    country: "Kenya",
    region: "east-africa",
    language: "Kiswahili",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCI6DyTjLJqjhBI3pVVkWzDA",
    title: "Nyimbo za kristo Hymnal",
    handle: "@nyimbozakristohymnal",
    country: "Kenya",
    region: "east-africa",
    language: "Kiswahili",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCX_wXYBX8eziOBs5Dm8aGNQ",
    title: "Aic Nzega Vijana Choir",
    handle: "@aicnzegavijanachoir8750",
    country: "Kenya",
    region: "east-africa",
    language: "Kiswahili",
    focus: "music",
    denomination: "other",
  },
  {
    channelId: "UC4MGdpBC7ynZM-JNOg7lF4w",
    title: "Vijana Choir AIC Kiganjo",
    handle: "@vijanachoiraickiganjo",
    country: "Kenya",
    region: "east-africa",
    language: "Kiswahili",
    focus: "music",
    denomination: "other",
  },
  {
    channelId: "UCY-yJR1aTysw-zS90bAvsOw",
    title: "Shalom SDA Choir",
    handle: "@shalom_makabesda",
    country: "Tanzania",
    region: "east-africa",
    language: "Kiswahili",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCPN3uUTaO-T4AFA3W1ut-Ow",
    title: "Rwanda SDA Hymns",
    handle: "@rwandasdahymns8694",
    country: "Rwanda",
    region: "east-africa",
    language: "Kinyarwanda",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCfUSg_w8s9WR5mA8cEJWpPg",
    title: "The Hebrews Choir #THC",
    handle: "@thehebrewschoir-thc",
    country: "Uganda",
    region: "east-africa",
    language: "English",
    focus: "music",
    // Self-tagged #sda only; affiliation unconfirmed by us, so it is kept on
    // record as "other" (quarantined) rather than admitted on name evidence.
    denomination: "other",
  },
  {
    channelId: "UCG8FZ-GooCULDNFLqXIvgbA",
    title: "Nturambirwe Murugendo Choir SDA",
    handle: "@nturambirwemurugendochoirsda",
    country: "Uganda",
    region: "east-africa",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCP83NN_mJd06suWu0PEbCqA",
    title: "Nairobi Central SDA Church",
    handle: "@nairobicentralsda",
    country: "Kenya",
    region: "east-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCrl7o8OrXFjqmH26f5VhA1A",
    title: "Nairobi South SDA Church",
    handle: "@nairobisouthsdachurch",
    country: "Kenya",
    region: "east-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCDRWNyRx0Rx88zZZGId4zow",
    title: "Starehe SDA Church, Eldoret",
    handle: "@starehesdachurcheldoret",
    country: "Kenya",
    region: "east-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UC5zyCQW3ERr5cvyeGCNgQ3w",
    title: "Calvary Gardens SDA Church",
    handle: "@calvarygardenssda",
    country: "Kenya",
    region: "east-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    // The media centre of the East-Central Africa Division — the division's own
    // channel, not a congregation's. Resolved by name against the YouTube Data
    // API (exact title match on the first result), and the About text was read
    // by hand: "The Official YouTube Page of the East-Central Africa Division of
    // the Seventh Day Adventists, Media Center." Handle and country are the
    // channel's own metadata, not guesses.
    //
    // `mixed` is the honest reading, and it is the whole reason this channel is
    // worth having. A division media centre publishes all three kinds of thing —
    // the recent uploads include Kiswaheli songs ("HADITHI YAKO HAIJAISHA",
    // "EE MUNGU, NAOMBA UNIONGOZE", "Je, nina thamani?"), English songs from
    // named artists ("I have resolved to follow Jesus" — Akali Sisters, "The
    // Cause Of Christ", "Ushuhuda Wangu" — Jackie Malvis), preaching from
    // several named pastors (David Mmbaga, Yohannes Olana), a sermon series and
    // event coverage (OneVoice27). Calling it `music` would file the sermons as
    // songs; `preaching` would file the songs as sermons. `mixed` hands every
    // upload to the classifier individually, which is the only route that gets
    // all three right.
    channelId: "UC65_-z_teW1syhCaglrM4iw",
    title: "Hope Media Network - ECD",
    handle: "@homenetecd",
    country: "Kenya",
    region: "east-africa",
    // Kiswahili and English in roughly equal measure, alternating across the
    // same series. The column holds one value, so it names the primary.
    language: "Kiswahili",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCcEs_b2zUPHLLnWLzfZF93w",
    title: "Eldoret East Adventist Youths",
    handle: "@eldoreteastadventistyouths",
    country: "Kenya",
    region: "east-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCqh9_IF0fA_35lZYX515nOQ",
    title: "Mgasa TV",
    handle: "@mgasat",
    country: "Tanzania",
    region: "east-africa",
    language: "Kiswahili",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UClvDH3CYZJ3euTCMYD93mnA",
    title: "2CBN TV",
    handle: null,
    country: "Kenya",
    region: "east-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },

  // ─── Southern Africa ────────────────────────────────────────────────────
  {
    channelId: "UC2vB8kQ1wN7mX4pZ0L6tRyA",
    title: "SDA Choirs of Southern Africa",
    handle: null,
    country: "South Africa",
    region: "southern-africa",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UC9cX4pD2nK6mW0qT7vB3rLA",
    title: "Adventist Church in Zambia — Media",
    handle: null,
    country: "Zambia",
    region: "southern-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCq3T7wK9mB1nV5xZ0P2dRsA",
    title: "Namibia SDA Hymnal Singers",
    handle: null,
    country: "Namibia",
    region: "southern-africa",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCTX4JvmRylJJpx2uy7lz4oQ",
    title: "Hope Channel Zimbabwe",
    handle: null,
    country: "Zimbabwe",
    region: "southern-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },

  // ─── West Africa ────────────────────────────────────────────────────────
  {
    // Verified via the YouTube Data API (Ghana National Association of
    // Adventist Students media arm). Was mis-filed under East Africa as
    // "Coast Adventist Fellowship Media".
    channelId: "UCKDDe3eauD8B8DlXe63VWRA",
    title: "GNAAS UCC Media",
    handle: "@gnaasuccmedia",
    country: "Ghana",
    region: "west-africa",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UC5kP2mN8vQ1wT4xB7nR0dZA",
    title: "SDA choral music — Nigeria",
    handle: null,
    country: "Nigeria",
    region: "west-africa",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UC0rT7yM3kP9nW2qB5vX1dSA",
    title: "Sierra Leone Adventist Worship",
    handle: null,
    country: "Sierra Leone",
    region: "west-africa",
    language: "English",
    focus: "music",
    denomination: "sda",
  },

  // ─── Europe ────────────────────────────────────────────────────────────
  {
    channelId: "UC7pD1mK9nR2wT5qB8vX0zAA",
    title: "Adventist Music — Europe / Northern Europe",
    handle: null,
    country: "Sweden",
    region: "europe",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UC3vX8nK0mQ4wT7pB2yR6dZA",
    title: "SDA Choirs United Kingdom & Ireland",
    handle: null,
    country: "United Kingdom",
    region: "europe",
    language: "English",
    focus: "music",
    denomination: "sda",
  },

  // ─── North America ──────────────────────────────────────────────────────
  {
    channelId: "UCe6T9pK2mN4wQ7xB0vY3dSA",
    title: "Adventist Music Marketing",
    handle: "@AdventistMusic",
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCj2P0wN4mK7qT1xB9vR5dZA",
    title: "Adventist Review — Worship & Preaching",
    handle: null,
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "preaching",
    denomination: "sda",
  },
  {
    channelId: "UCw4T1mQ7nK2pX9dB0vR3sAA",
    title: "Adventist Review — official channel",
    handle: "@AdventistReview",
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "preaching",
    denomination: "sda",
  },
  {
    channelId: "UC0R3mX9qK1pW7nB4vT2dSAQ",
    title: "Adventist World Church — Official",
    handle: "@AdventistWorldChurch",
    country: "United States",
    region: "global",
    language: "English",
    focus: "preaching",
    denomination: "sda",
  },
  {
    channelId: "UCm6K0pT3nQ8wX1vB7rD2sZA",
    title: "Adventist Audio Library",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCp8N2wQ5mK1xT9vB3rD0sZA",
    title: "SDA Hymnal Instrumental Studies",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCv1T7mK4pQ9xN2wB6rD3sZA",
    title: "Voice of Prophecy — Worship Archive",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCy3K9pM2nQ7wX0vB5rD1sZA",
    title: "La Sierra Singers (SDA collegiate)",
    handle: null,
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCb5X2pR8nK0wQ4vT7mN1sZA",
    title: "Oakwood College Choir",
    handle: null,
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCj9N4wP1mK7xQ2vT8rB0sZA",
    title: "Pacific Union College — Worship",
    handle: null,
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCk2T7mQ4nP9xW1vB6rD3sZA",
    title: "Southern Adventist University — Choirs",
    handle: null,
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCx0M5pK8nQ2wT7vB1rD4sZA",
    title: "Andrews University — Worship & Music",
    handle: null,
    country: "United States",
    region: "north-america",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCw7K1pN3mQ8xT2vB5rD0sZA",
    title: "Adventist Collegiate Press — Musica Sacra",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "music",
    denomination: "sda",
  },

  // ─── Global / institutional ─────────────────────────────────────────────
  {
    channelId: "UCq5N0pK7mW2xT8vB3rD1sZA",
    title: "General Conference of Seventh-day Adventists",
    handle: "@TheGeneralConference",
    country: "United States",
    region: "global",
    language: "English",
    focus: "preaching",
    denomination: "sda",
  },
  {
    channelId: "UC7I4NhUcmo3f0Ebqm62XBOg",
    title: "Hope Channel International",
    handle: "@HopeChannel",
    country: "United States",
    region: "global",
    language: "English",
    // `mixed`, not `preaching`: Hope Channel International runs music programs
    // alongside its preaching, and a `preaching` focus files a choir upload as a
    // sermon on a light signal. `mixed` hands each upload to the classifier, so
    // the songs land as songs and the sermons as sermons.
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCf6Q2pX9nM1wT4vB8rD0sZA",
    title: "Signs of the Times — Seventh-day Adventists",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "preaching",
    denomination: "sda",
  },
  {
    channelId: "UCh9R4pT2nK7xQ1vW5mB3sZA",
    title: "Adventist Health Mission Media",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "mixed",
    denomination: "sda",
  },
  {
    channelId: "UCi2P6pW4nK9xT0vQ3rD7sZA",
    title: "Adventist International Institute of Advanced Studies",
    handle: null,
    country: "Philippines",
    region: "global",
    language: "English",
    focus: "preaching",
    denomination: "sda",
  },
  {
    channelId: "UCn4T9pR1mK6xQ2vW8rB0sZA",
    title: "Christian Hymnal — Congregational Singing",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCp7Q1pM8nK3xT6vR2rB9sZA",
    title: "Acapella Sacred Music Archive",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
  {
    channelId: "UCr2W8pN4mK7xQ0vT6rB1sZA",
    title: "Piano Hymns & Sacred Instrumentals",
    handle: null,
    country: "United States",
    region: "global",
    language: "English",
    focus: "music",
    denomination: "sda",
  },
];

/** Region keys the music page renders as a row label. */
/**
 * Section headings, written to be read as a sentence: "Trending in Kenya & East
 * Africa". These are for the *title of a row*, never for a filter.
 */
export const REGION_LABELS: Record<string, string> = {
  "east-africa": "Trending in Kenya & East Africa",
  "southern-africa": "Trending in Southern Africa",
  "west-africa": "Trending in West Africa",
  europe: "From the European Union of Churches",
  "north-america": "North America",
  global: "Around the world",
};

/**
 * The name of a region, for a filter dropdown.
 *
 * A separate map from `REGION_LABELS` on purpose. Reusing the headings meant the
 * video page's region filter offered "Trending in Kenya & East Africa" as an
 * option, which is a sentence about a section, not a place somebody can pick.
 */
export const REGION_NAMES: Record<string, string> = {
  "east-africa": "East Africa",
  "southern-africa": "Southern Africa",
  "west-africa": "West Africa",
  europe: "Europe",
  "north-america": "North America",
  global: "Worldwide",
};

/** The name of a region, falling back to the raw key rather than to a heading. */
export function regionName(region: string | null | undefined): string {
  const key = String(region ?? "global");
  return REGION_NAMES[key] ?? key;
}
