/**
 * Hand-rolled OpenAPI 3.1 document.
 *
 * A generator would need decorators or a separate schema file that drifts from
 * the Zod schemas already validating every request. Describing the surface here
 * keeps one source of truth per module: the routes, plus this document for
 * discovery.
 */

type Operation = {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  summary: string;
  tags: string[];
  auth?: "none" | "optional" | "session" | "editor" | "admin";
  parameters?: { name: string; in: "query" | "path"; required?: boolean; description: string }[];
  requestBody?: { description: string; required: boolean };
  responses: Record<string, string>;
};

const listParams: Operation["parameters"] = [
  { name: "limit", in: "query", description: "Page size, 1–100 (default 20)" },
  { name: "offset", in: "query", description: "Rows to skip" },
  { name: "page", in: "query", description: "1-based page number; overrides `offset`" },
  { name: "sort", in: "query", description: "Sort field; unrecognised values fall back to the default" },
  { name: "order", in: "query", description: "`asc` or `desc`" },
  { name: "q", in: "query", description: "Free-text search" },
  { name: "format", in: "query", description: "Set to `envelope` for `{ data, meta }` instead of a bare array" },
  { name: "includeDrafts", in: "query", description: "Include unpublished rows (editor roles only)" },
];

const listResponses = {
  "200": "Paginated list. A bare JSON array by default; totals travel in `X-Total-Count`, `X-Page`, `X-Limit` and `X-Has-More`.",
  "400": "Bad request",
  "422": "Validation failed",
};

const operations: Operation[] = [
  // ── System ──
  { method: "get", path: "/api/health", summary: "Liveness and dependency snapshot", tags: ["System"], auth: "none", responses: { "200": "Service health" } },
  { method: "get", path: "/api/health/ready", summary: "Readiness probe with database latency", tags: ["System"], auth: "none", responses: { "200": "Ready", "503": "Database unavailable" } },
  { method: "get", path: "/api/openapi.json", summary: "This document", tags: ["System"], auth: "none", responses: { "200": "OpenAPI 3.1 document" } },

  // ── Home & search ──
  { method: "get", path: "/api/home", summary: "Entire home screen: hero, rails, events, churches, stats", tags: ["Home"], auth: "optional", responses: { "200": "HomeDashboard" } },
  { method: "get", path: "/api/hero-track", summary: "The single hero track for the landing banner", tags: ["Home"], auth: "optional", responses: { "200": "TrackDetail" } },
  {
    method: "get",
    path: "/api/search",
    summary: "Global search across every indexed entity type",
    tags: ["Search"],
    auth: "optional",
    parameters: [
      { name: "q", in: "query", required: true, description: "Search term" },
      { name: "type", in: "query", description: "Comma-separated content types to filter by" },
      { name: "availability", in: "query", description: "`any`, `live`, `replay` or `download`" },
      ...listParams,
    ],
    responses: { "200": "SearchResult[] — FTS5 ranked when available, LIKE otherwise", "422": "Validation failed" },
  },
  { method: "get", path: "/api/search/facets", summary: "Result counts per entity type", tags: ["Search"], auth: "optional", parameters: [{ name: "q", in: "query", description: "Search term" }], responses: { "200": "Record<entityType, count>" } },
  { method: "get", path: "/api/search/popular", summary: "Most-searched queries", tags: ["Search"], auth: "optional", responses: { "200": "string[]" } },

  // ── Music ──
  { method: "get", path: "/api/tracks", summary: "Browse tracks", tags: ["Music"], auth: "optional", parameters: [...listParams, { name: "kind", in: "query", description: "`audio`, `video`, `hymn` or `sermon`" }, { name: "collectionId", in: "query", description: "Restrict to one collection" }, { name: "featured", in: "query", description: "Filter by featured flag" }], responses: listResponses },
  { method: "get", path: "/api/tracks/facets", summary: "Distinct artists, genres, moods and languages", tags: ["Music"], auth: "none", responses: { "200": "Facet object" } },
  { method: "get", path: "/api/tracks/{id}", summary: "One track, full detail", tags: ["Music"], auth: "optional", parameters: [{ name: "id", in: "path", required: true, description: "Track id" }], responses: { "200": "TrackDetail", "404": "Not found" } },
  { method: "get", path: "/api/tracks/{id}/related", summary: "Tracks sharing artist, album, genre or mood", tags: ["Music"], auth: "none", parameters: [{ name: "id", in: "path", required: true, description: "Track id" }], responses: { "200": "Track[]" } },
  { method: "post", path: "/api/tracks/{id}/play", summary: "Record a play", tags: ["Music"], auth: "none", parameters: [{ name: "id", in: "path", required: true, description: "Track id" }], responses: { "202": "Recorded", "404": "Not found" } },
  { method: "post", path: "/api/tracks/{id}/view", summary: "Record a view", tags: ["Music"], auth: "none", parameters: [{ name: "id", in: "path", required: true, description: "Track id" }], responses: { "202": "Recorded" } },
  { method: "post", path: "/api/tracks", summary: "Create a track", tags: ["Music"], auth: "editor", requestBody: { description: "TrackInput", required: true }, responses: { "201": "TrackDetail", "422": "Validation failed" } },
  { method: "patch", path: "/api/tracks/{id}", summary: "Update a track", tags: ["Music"], auth: "editor", requestBody: { description: "Partial TrackInput", required: true }, responses: { "200": "TrackDetail" } },
  { method: "delete", path: "/api/tracks/{id}", summary: "Soft-delete a track", tags: ["Music"], auth: "editor", responses: { "204": "Deleted" } },
  { method: "post", path: "/api/tracks/{id}/restore", summary: "Restore a soft-deleted track", tags: ["Music"], auth: "editor", responses: { "200": "Restored" } },

  { method: "get", path: "/api/albums", summary: "Browse albums", tags: ["Music"], parameters: listParams, responses: listResponses },
  { method: "get", path: "/api/albums/{id}", summary: "One album with its track count", tags: ["Music"], auth: "none", responses: { "200": "Album", "404": "Not found" } },

  { method: "get", path: "/api/collections", summary: "Browse collections with their tracks inlined", tags: ["Music"], parameters: [...listParams, { name: "kind", in: "query", description: "`music`, `video` or `mixed`" }, { name: "featured", in: "query", description: "Filter by featured flag" }], responses: listResponses },
  { method: "get", path: "/api/collections/{idOrSlug}", summary: "One collection by id or slug", tags: ["Music"], auth: "none", responses: { "200": "Collection", "404": "Not found" } },
  { method: "post", path: "/api/collections/{idOrSlug}/tracks/{trackId}", summary: "Append a track to a collection", tags: ["Music"], auth: "editor", responses: { "201": "Collection" } },
  { method: "delete", path: "/api/collections/{idOrSlug}/tracks/{trackId}", summary: "Remove a track from a collection", tags: ["Music"], auth: "editor", responses: { "200": "Collection" } },

  { method: "get", path: "/api/videos", summary: "Browse videos (tracks with `kind = video`)", tags: ["Videos"], parameters: [...listParams, { name: "category", in: "query", description: "Matches the track genre" }], responses: listResponses },
  { method: "get", path: "/api/videos/facets", summary: "Distinct video categories and languages", tags: ["Videos"], auth: "none", responses: { "200": "Facet object" } },
  { method: "get", path: "/api/videos/{id}", summary: "One video, full detail", tags: ["Videos"], auth: "optional", responses: { "200": "TrackDetail", "404": "Not a video" } },

  // ── Hymns ──
  { method: "get", path: "/api/hymns", summary: "Browse hymns, ordered by hymn number", tags: ["Hymns"], parameters: [...listParams, { name: "theme", in: "query", description: "Theme slug" }, { name: "number", in: "query", description: "Hymn number within an edition" }, { name: "edition", in: "query", description: "Edition id or name" }], responses: listResponses },
  { method: "get", path: "/api/hymns/detail", summary: "Browse hymns with tune, meter, key and lyrics", tags: ["Hymns"], parameters: listParams, responses: listResponses },
  { method: "get", path: "/api/hymns/themes", summary: "Distinct themes with counts", tags: ["Hymns"], auth: "none", responses: { "200": "Theme facet array" } },
  { method: "get", path: "/api/hymns/tunes", summary: "Tune, meter and key metadata with counts", tags: ["Hymns"], auth: "none", responses: { "200": "Tune facet array" } },
  { method: "get", path: "/api/hymns/editions", summary: "All hymn editions", tags: ["Hymns"], auth: "none", responses: { "200": "HymnEdition[]" } },
  { method: "get", path: "/api/hymns/{idOrNumber}", summary: "One hymn by id or hymn number", tags: ["Hymns"], auth: "optional", responses: { "200": "HymnDetail", "404": "Not found" } },
  { method: "get", path: "/api/hymn-editions/{idOrCode}", summary: "One edition by id or code", tags: ["Hymns"], auth: "none", responses: { "200": "HymnEdition" } },

  // ── Bible ──
  { method: "get", path: "/api/bible/versions", summary: "All Bible versions", tags: ["Bible"], auth: "none", responses: { "200": "BibleVersion[]" } },
  { method: "get", path: "/api/bible/books", summary: "Books of a version, canonically ordered", tags: ["Bible"], auth: "none", parameters: [{ name: "version", in: "query", description: "Version id or code (default KJV)" }, { name: "testament", in: "query", description: "`Old` or `New`" }], responses: { "200": "BibleBook[]" } },
  { method: "get", path: "/api/bible/chapters", summary: "Chapter numbers that contain verses", tags: ["Bible"], auth: "none", parameters: [{ name: "book", in: "query", required: true, description: "Book name, abbreviation or id" }, { name: "version", in: "query", description: "Version id or code" }], responses: { "200": "number[]" } },
  { method: "get", path: "/api/bible/chapters/{chapter}", summary: "Every verse in a chapter", tags: ["Bible"], auth: "none", parameters: [{ name: "chapter", in: "path", required: true, description: "Chapter number" }, { name: "book", in: "query", required: true, description: "Book name, abbreviation or id" }], responses: { "200": "BibleVerse[]" } },
  { method: "get", path: "/api/bible/verses", summary: "A passage by reference, e.g. `John 3:16-17`", tags: ["Bible"], auth: "none", parameters: [{ name: "reference", in: "query", required: true, description: "Scripture reference; ranges may cross chapters" }, { name: "version", in: "query", description: "Version id or code" }], responses: { "200": "BiblePassage", "400": "Unparseable reference" } },
  { method: "get", path: "/api/bible/passage/{reference}", summary: "A passage by path", tags: ["Bible"], auth: "none", responses: { "200": "BiblePassage" } },
  { method: "get", path: "/api/bible/search", summary: "Full-text search within one version", tags: ["Bible"], auth: "none", parameters: [{ name: "q", in: "query", required: true, description: "Search term" }], responses: { "200": "BibleVerse[]" } },
  { method: "get", path: "/api/bible/bookmarks", summary: "The caller's saved verses", tags: ["Bible"], auth: "session", responses: { "200": "BibleBookmark[]" } },
  { method: "post", path: "/api/bible/bookmarks", summary: "Save a verse (idempotent per verse)", tags: ["Bible"], auth: "session", requestBody: { description: "BookmarkInput", required: true }, responses: { "201": "BibleBookmark" } },
  { method: "patch", path: "/api/bible/bookmarks/{id}", summary: "Update a highlight or note", tags: ["Bible"], auth: "session", responses: { "200": "BibleBookmark" } },
  { method: "delete", path: "/api/bible/bookmarks/{id}", summary: "Remove a bookmark", tags: ["Bible"], auth: "session", responses: { "204": "Deleted" } },

  // ── Sermons ──
  { method: "get", path: "/api/sermons", summary: "Browse sermons", tags: ["Sermons"], parameters: [...listParams, { name: "series", in: "query", description: "Series id" }, { name: "speaker", in: "query", description: "Speaker id" }], responses: listResponses },
  { method: "get", path: "/api/sermons/detail", summary: "Browse sermons with transcript and chapters", tags: ["Sermons"], parameters: listParams, responses: listResponses },
  { method: "get", path: "/api/sermons/series", summary: "All sermon series with episode counts", tags: ["Sermons"], auth: "none", responses: { "200": "SermonSeries[]" } },
  { method: "get", path: "/api/sermons/speakers", summary: "All speakers with sermon counts", tags: ["Sermons"], auth: "none", responses: { "200": "Speaker facet array" } },
  { method: "get", path: "/api/sermons/{id}", summary: "One sermon, full detail", tags: ["Sermons"], auth: "optional", responses: { "200": "SermonDetail", "404": "Not found" } },

  // ── News ──
  { method: "get", path: "/api/news", summary: "Browse news, newest first", tags: ["News"], parameters: [...listParams, { name: "category", in: "query", description: "Category name" }, { name: "region", in: "query", description: "Region name" }, { name: "featured", in: "query", description: "Filter by featured flag" }], responses: listResponses },
  { method: "get", path: "/api/news/facets", summary: "Categories with counts and available regions", tags: ["News"], auth: "none", responses: { "200": "Facet object" } },
  { method: "get", path: "/api/news/detail", summary: "Browse articles with body, tags and author", tags: ["News"], parameters: listParams, responses: listResponses },
  { method: "get", path: "/api/news/{idOrSlug}", summary: "One article by id or slug", tags: ["News"], auth: "optional", responses: { "200": "NewsArticle", "404": "Not found" } },
  { method: "post", path: "/api/news/{idOrSlug}/view", summary: "Record a read", tags: ["News"], auth: "none", responses: { "202": "Recorded" } },

  // ── Churches ──
  { method: "get", path: "/api/churches", summary: "Browse churches, or search nearby with `?lat=&lng=&radius=`", tags: ["Churches"], parameters: [...listParams, { name: "lat", in: "query", description: "Centre latitude; enables distance ordering" }, { name: "lng", in: "query", description: "Centre longitude" }, { name: "radius", in: "query", description: "Search radius in km (default 50)" }, { name: "country", in: "query", description: "Country name" }], responses: listResponses },
  { method: "get", path: "/api/churches/facets", summary: "Distinct countries, cities and conferences", tags: ["Churches"], auth: "none", responses: { "200": "Facet object" } },
  { method: "get", path: "/api/churches/followed", summary: "Churches the caller follows", tags: ["Churches"], auth: "session", responses: { "200": "Church[]" } },
  { method: "post", path: "/api/churches/{idOrSlug}/follow", summary: "Follow a church", tags: ["Churches"], auth: "session", responses: { "200": "{ following: true }" } },
  { method: "delete", path: "/api/churches/{idOrSlug}/follow", summary: "Unfollow a church", tags: ["Churches"], auth: "session", responses: { "200": "{ following: false }" } },
  { method: "get", path: "/api/churches/{idOrSlug}", summary: "One church with ministries, service times and upcoming events", tags: ["Churches"], auth: "none", responses: { "200": "ChurchDetail", "404": "Not found" } },

  // ── Events ──
  { method: "get", path: "/api/events", summary: "Browse upcoming events, soonest first", tags: ["Events"], parameters: [...listParams, { name: "church", in: "query", description: "Church id" }, { name: "category", in: "query", description: "Category name" }, { name: "upcoming", in: "query", description: "`false` includes past events" }], responses: listResponses },
  { method: "get", path: "/api/events/facets", summary: "Categories with counts and cities", tags: ["Events"], auth: "none", responses: { "200": "Facet object" } },
  { method: "get", path: "/api/events/saved", summary: "Events the caller saved", tags: ["Events"], auth: "session", responses: { "200": "EventDetail[]" } },
  { method: "post", path: "/api/events/{idOrSlug}/save", summary: "Save an event and set a reminder", tags: ["Events"], auth: "session", responses: { "200": "{ saved: true }" } },
  { method: "delete", path: "/api/events/{idOrSlug}/save", summary: "Remove a saved event", tags: ["Events"], auth: "session", responses: { "200": "{ saved: false }" } },
  { method: "get", path: "/api/events/{idOrSlug}", summary: "One event by id or slug", tags: ["Events"], auth: "optional", responses: { "200": "EventDetail", "404": "Not found" } },

  // ── Live ──
  { method: "get", path: "/api/live", summary: "Streams ordered by lifecycle: live, starting soon, upcoming, replay", tags: ["Live"], parameters: [...listParams, { name: "status", in: "query", description: "Lifecycle status" }, { name: "live", in: "query", description: "Shorthand for `status=Live now`" }], responses: listResponses },
  { method: "get", path: "/api/live/now", summary: "Streams currently on air", tags: ["Live"], auth: "none", responses: { "200": "LiveStream[]" } },
  { method: "get", path: "/api/live/facets", summary: "Statuses, categories and languages", tags: ["Live"], auth: "none", responses: { "200": "Facet object" } },
  { method: "get", path: "/api/live/{id}", summary: "One stream", tags: ["Live"], auth: "none", responses: { "200": "LiveStream", "404": "Not found" } },

  // ── Library ──
  { method: "get", path: "/api/library/favorites", summary: "The caller's favourites, with titles resolved", tags: ["Library"], auth: "session", parameters: [{ name: "itemType", in: "query", description: "Filter by content type" }], responses: { "200": "Favourite[]" } },
  { method: "get", path: "/api/library/favorites/ids", summary: "Batch favourite lookup for hydrating a list", tags: ["Library"], auth: "session", parameters: [{ name: "itemType", in: "query", required: true, description: "Content type" }, { name: "ids", in: "query", required: true, description: "Comma-separated ids" }], responses: { "200": "string[] of favourited ids" } },
  { method: "post", path: "/api/library/favorites", summary: "Add a favourite", tags: ["Library"], auth: "session", requestBody: { description: "{ itemType, itemId }", required: true }, responses: { "201": "{ favorited: true }" } },
  { method: "delete", path: "/api/library/favorites/{itemType}/{itemId}", summary: "Remove a favourite", tags: ["Library"], auth: "session", responses: { "200": "{ favorited: false }" } },
  { method: "get", path: "/api/library/playlists", summary: "The caller's playlists with items inlined", tags: ["Library"], auth: "session", responses: { "200": "Playlist[]" } },
  { method: "post", path: "/api/library/playlists", summary: "Create a playlist", tags: ["Library"], auth: "session", requestBody: { description: "PlaylistInput", required: true }, responses: { "201": "Playlist" } },
  { method: "get", path: "/api/library/playlists/{id}", summary: "One playlist (own, or public)", tags: ["Library"], auth: "session", responses: { "200": "Playlist", "404": "Not found" } },
  { method: "patch", path: "/api/library/playlists/{id}", summary: "Rename or re-scope a playlist", tags: ["Library"], auth: "session", responses: { "200": "Playlist" } },
  { method: "delete", path: "/api/library/playlists/{id}", summary: "Delete a playlist", tags: ["Library"], auth: "session", responses: { "204": "Deleted" } },
  { method: "post", path: "/api/library/playlists/{id}/items", summary: "Append an item", tags: ["Library"], auth: "session", responses: { "201": "Playlist" } },
  { method: "put", path: "/api/library/playlists/{id}/items", summary: "Replace the item order (drag-to-reorder)", tags: ["Library"], auth: "session", requestBody: { description: "{ items: [...] }", required: true }, responses: { "200": "Playlist" } },
  { method: "delete", path: "/api/library/playlists/{id}/items/{itemType}/{itemId}", summary: "Remove an item and close the position gap", tags: ["Library"], auth: "session", responses: { "200": "Playlist" } },
  { method: "get", path: "/api/library/history", summary: "Recently played, titles resolved", tags: ["Library"], auth: "session", responses: { "200": "PlayHistoryEntry[]" } },
  { method: "post", path: "/api/library/history", summary: "Record or update playback position", tags: ["Library"], auth: "session", requestBody: { description: "{ itemType, itemId, progressPercent }", required: true }, responses: { "201": "{ recorded: true }" } },
  { method: "delete", path: "/api/library/history", summary: "Clear history", tags: ["Library"], auth: "session", responses: { "200": "{ cleared: true }" } },
  { method: "get", path: "/api/library/notes", summary: "The caller's notes on media", tags: ["Library"], auth: "session", responses: { "200": "Note[]" } },
  { method: "post", path: "/api/library/notes", summary: "Attach a note to a timestamp", tags: ["Library"], auth: "session", requestBody: { description: "NoteInput", required: true }, responses: { "201": "Note" } },
  { method: "patch", path: "/api/library/notes/{id}", summary: "Edit a note", tags: ["Library"], auth: "session", responses: { "200": "Note" } },
  { method: "delete", path: "/api/library/notes/{id}", summary: "Delete a note", tags: ["Library"], auth: "session", responses: { "204": "Deleted" } },
  { method: "get", path: "/api/library/downloads", summary: "Offline downloads", tags: ["Library"], auth: "session", responses: { "200": "DownloadRecord[]" } },

  // ── Account ──
  { method: "get", path: "/api/preferences", summary: "Reader, playback and notification preferences", tags: ["Account"], auth: "session", responses: { "200": "UserPreferences" } },
  { method: "patch", path: "/api/preferences", summary: "Update preferences", tags: ["Account"], auth: "session", requestBody: { description: "Partial preferences", required: true }, responses: { "200": "UserPreferences" } },
  { method: "get", path: "/api/preferences/notifications", summary: "The caller's notifications", tags: ["Account"], auth: "session", responses: { "200": "Notification[]" } },

  // ── Platform ──
  { method: "post", path: "/api/newsletter/subscribe", summary: "Subscribe to the weekly letter", tags: ["Platform"], auth: "none", requestBody: { description: "{ email, topics }", required: true }, responses: { "201": "{ subscribed, status }" } },
  { method: "post", path: "/api/newsletter/unsubscribe", summary: "Unsubscribe an address", tags: ["Platform"], auth: "none", requestBody: { description: "{ email }", required: true }, responses: { "200": "{ unsubscribed: true }" } },
  { method: "post", path: "/api/uploads", summary: "Upload a file (multipart, field `file`)", tags: ["Platform"], auth: "editor", requestBody: { description: "multipart/form-data", required: true }, responses: { "201": "MediaAsset", "400": "Unsupported type or too large" } },
  { method: "get", path: "/api/admin/stats", summary: "Content counters for the admin overview", tags: ["Platform"], auth: "editor", responses: { "200": "Record<string, number>" } },
  { method: "post", path: "/api/admin/search/reindex", summary: "Rebuild the derived search index", tags: ["Platform"], auth: "admin", responses: { "200": "{ indexed }" } },
];

function pathsObject(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const operation of operations) {
    const existing = (paths[operation.path] as Record<string, unknown> | undefined) ?? {};
    const parameters = (operation.parameters ?? []).map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required ?? false,
      description: parameter.description,
      schema: { type: "string" },
    }));
    existing[operation.method] = {
      summary: operation.summary,
      tags: operation.tags,
      ...(operation.auth ? { "x-auth": operation.auth } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(operation.requestBody
        ? { requestBody: { required: operation.requestBody.required, description: operation.requestBody.description, content: { "application/json": { schema: { type: "object" } } } } }
        : {}),
      responses: Object.fromEntries(Object.entries(operation.responses).map(([code, description]) => [code, { description }])),
    };
    paths[operation.path] = existing;
  }
  return paths;
}

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Hymnora SDA API",
      version: "1.0.0",
      description: [
        "Backend for the Hymnora Seventh-day Adventist worship platform: music, hymns,",
        "scripture, sermons, news, churches, events and live streams.",
        "",
        "List endpoints return a bare JSON array by default — the Next.js frontend",
        "consumes arrays directly. Totals travel in the `X-Total-Count`, `X-Page`,",
        "`X-Limit` and `X-Has-More` headers; pass `?format=envelope` to receive",
        "`{ data, meta }` instead.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "This server" }],
    tags: [
      { name: "System", description: "Health and discovery" },
      { name: "Home", description: "Aggregated home screen" },
      { name: "Search", description: "Cross-entity search" },
      { name: "Music", description: "Tracks, albums and collections" },
      { name: "Videos", description: "Video tracks" },
      { name: "Hymns", description: "Hymnal, editions, themes and tunes" },
      { name: "Bible", description: "Versions, books, verses and bookmarks" },
      { name: "Sermons", description: "Preaching, series and speakers" },
      { name: "News", description: "Community and mission news" },
      { name: "Churches", description: "Congregations and nearby search" },
      { name: "Events", description: "Conventions and gatherings" },
      { name: "Live", description: "Live and replayed streams" },
      { name: "Library", description: "Favourites, playlists, history and notes" },
      { name: "Account", description: "Preferences and notifications" },
      { name: "Platform", description: "Newsletter, uploads and admin" },
    ],
    paths: pathsObject(),
  };
}

export const operationCount = operations.length;
