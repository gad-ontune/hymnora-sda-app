/**
 * Ordered, append-only schema migrations.
 *
 * Each entry runs once inside a transaction and is recorded in `_migrations`.
 * Never edit a migration that has shipped — add a new one.
 */

export type Migration = {
  id: string;
  name: string;
  sql: string;
};

const coreSchema = `
-- ─── Identity ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','moderator','editor','admin')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  display_name      TEXT,
  avatar_url        TEXT,
  bio               TEXT,
  phone             TEXT,
  home_church_id    TEXT REFERENCES churches(id) ON DELETE SET NULL,
  city              TEXT,
  country           TEXT,
  timezone          TEXT DEFAULT 'Africa/Nairobi',
  latitude          REAL,
  longitude         REAL,
  language          TEXT NOT NULL DEFAULT 'English',
  email_verified_at TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language                TEXT NOT NULL DEFAULT 'English',
  theme                   TEXT NOT NULL DEFAULT 'warm' CHECK (theme IN ('light','warm','dark','system')),
  reading_theme           TEXT NOT NULL DEFAULT 'cream' CHECK (reading_theme IN ('cream','light','dark')),
  reader_font_size        INTEGER NOT NULL DEFAULT 18,
  autoplay                INTEGER NOT NULL DEFAULT 1,
  crossfade               INTEGER NOT NULL DEFAULT 0,
  normalize_volume        INTEGER NOT NULL DEFAULT 1,
  download_quality        TEXT NOT NULL DEFAULT 'high' CHECK (download_quality IN ('standard','high','lossless')),
  data_saver              INTEGER NOT NULL DEFAULT 0,
  captions                INTEGER NOT NULL DEFAULT 0,
  bedroom_mode            INTEGER NOT NULL DEFAULT 0,
  notify_new_content      INTEGER NOT NULL DEFAULT 1,
  notify_live_events      INTEGER NOT NULL DEFAULT 1,
  notify_weekly_letter    INTEGER NOT NULL DEFAULT 0,
  event_reminder_minutes  INTEGER NOT NULL DEFAULT 60,
  default_bible_version   TEXT NOT NULL DEFAULT 'KJV',
  bible_translation      TEXT NOT NULL DEFAULT 'KJV',
  followed_topics         TEXT NOT NULL DEFAULT '[]',
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  user_agent  TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verification','password_reset','email_change')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  href       TEXT,
  meta       TEXT NOT NULL DEFAULT '{}',
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('image','audio','video','document')),
  filename         TEXT NOT NULL,
  original_name    TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  storage_path     TEXT NOT NULL,
  url              TEXT NOT NULL,
  alt_text         TEXT,
  width            INTEGER,
  height           INTEGER,
  duration_seconds INTEGER,
  checksum         TEXT,
  status           TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('pending','ready','rejected')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets (owner_id, kind);

-- ─── Music, video and collections ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS albums (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL DEFAULT '',
  cover_url    TEXT,
  release_date TEXT,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'audio' CHECK (kind IN ('audio','video','hymn','sermon')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  artist              TEXT NOT NULL DEFAULT '',
  album_id            TEXT REFERENCES albums(id) ON DELETE SET NULL,
  album               TEXT NOT NULL DEFAULT '',
  image               TEXT NOT NULL DEFAULT '',
  audio_url           TEXT,
  video_url           TEXT,
  stream_url          TEXT,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  language            TEXT NOT NULL DEFAULT 'English',
  kind                TEXT NOT NULL DEFAULT 'audio' CHECK (kind IN ('audio','video','hymn','sermon')),
  genre               TEXT,
  mood                TEXT,
  is_live             INTEGER NOT NULL DEFAULT 0,
  live_status         TEXT,
  captions_available  INTEGER NOT NULL DEFAULT 0,
  downloadable        INTEGER NOT NULL DEFAULT 0,
  is_explicit         INTEGER NOT NULL DEFAULT 0,
  featured            INTEGER NOT NULL DEFAULT 0,
  play_count          INTEGER NOT NULL DEFAULT 0,
  like_count          INTEGER NOT NULL DEFAULT 0,
  release_date        TEXT,
  lyrics              TEXT,
  credits             TEXT NOT NULL DEFAULT '[]',
  view_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  published_at        TEXT,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks (status, deleted_at, kind);
CREATE INDEX IF NOT EXISTS idx_tracks_language ON tracks (language);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks (album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_featured ON tracks (featured, status);
CREATE INDEX IF NOT EXISTS idx_tracks_live ON tracks (is_live, live_status);

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  image       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'music' CHECK (kind IN ('music','video','mixed')),
  tone        TEXT,
  curator     TEXT,
  featured    INTEGER NOT NULL DEFAULT 0,
  item_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (collection_id, track_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_order ON collection_items (collection_id, position);

-- ─── Hymns ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hymn_editions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  language    TEXT NOT NULL DEFAULT 'English',
  year        INTEGER,
  publisher   TEXT,
  rights      TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS hymns (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL,
  sort_number      INTEGER NOT NULL DEFAULT 0,
  title            TEXT NOT NULL,
  edition_id       TEXT NOT NULL REFERENCES hymn_editions(id) ON DELETE CASCADE,
  edition          TEXT NOT NULL,
  language         TEXT NOT NULL DEFAULT 'English',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  image            TEXT NOT NULL DEFAULT '',
  theme            TEXT NOT NULL DEFAULT 'Worship',
  theme_slug       TEXT,
  tune             TEXT,
  meter            TEXT,
  musical_key      TEXT,
  verse_count      INTEGER NOT NULL DEFAULT 0,
  lyrics           TEXT,
  copyright        TEXT,
  audio_url        TEXT,
  downloadable     INTEGER NOT NULL DEFAULT 0,
  play_count       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT,
  UNIQUE (edition_id, number)
);
CREATE INDEX IF NOT EXISTS idx_hymns_status ON hymns (status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hymns_theme ON hymns (theme);
CREATE INDEX IF NOT EXISTS idx_hymns_edition ON hymns (edition_id);
CREATE INDEX IF NOT EXISTS idx_hymns_number ON hymns (sort_number);

-- ─── Bible ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bible_versions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  language       TEXT NOT NULL DEFAULT 'English',
  language_code  TEXT NOT NULL DEFAULT 'en',
  status         TEXT NOT NULL DEFAULT 'Public domain',
  publisher      TEXT,
  year           INTEGER,
  description    TEXT,
  books_count    INTEGER NOT NULL DEFAULT 0,
  chapters_count INTEGER NOT NULL DEFAULT 0,
  verses_count   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS bible_books (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  abbreviation  TEXT NOT NULL,
  testament     TEXT NOT NULL CHECK (testament IN ('Old','New')),
  book_number   INTEGER NOT NULL,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  verse_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (version_id, book_number)
);
CREATE INDEX IF NOT EXISTS idx_bible_books_version ON bible_books (version_id, book_number);

CREATE TABLE IF NOT EXISTS bible_verses (
  id         TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE,
  book_id    TEXT NOT NULL REFERENCES bible_books(id) ON DELETE CASCADE,
  book       TEXT NOT NULL,
  chapter    INTEGER NOT NULL,
  verse      INTEGER NOT NULL,
  text       TEXT NOT NULL,
  UNIQUE (version_id, book_id, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_bible_verses_lookup ON bible_verses (version_id, book_id, chapter, verse);
CREATE INDEX IF NOT EXISTS idx_bible_verses_book ON bible_verses (book, chapter);

CREATE TABLE IF NOT EXISTS bible_bookmarks (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_id     TEXT NOT NULL,
  book           TEXT NOT NULL,
  chapter        INTEGER NOT NULL,
  verse          INTEGER NOT NULL,
  text           TEXT NOT NULL DEFAULT '',
  highlight_color TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, version_id, book, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_bible_bookmarks_user ON bible_bookmarks (user_id, created_at);

-- ─── Sermons ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS speakers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT,
  church_id  TEXT REFERENCES churches(id) ON DELETE SET NULL,
  image      TEXT NOT NULL DEFAULT '',
  bio        TEXT,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sermon_series (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_url   TEXT,
  speaker_id  TEXT REFERENCES speakers(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sermons (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  speaker_id          TEXT REFERENCES speakers(id) ON DELETE SET NULL,
  speaker             TEXT NOT NULL DEFAULT '',
  speaker_bio         TEXT,
  topic               TEXT NOT NULL DEFAULT '',
  series_id           TEXT REFERENCES sermon_series(id) ON DELETE SET NULL,
  series              TEXT NOT NULL DEFAULT '',
  image               TEXT NOT NULL DEFAULT '',
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  language            TEXT NOT NULL DEFAULT 'English',
  description         TEXT,
  scripture_reference TEXT,
  transcript          TEXT,
  chapters            TEXT NOT NULL DEFAULT '[]',
  audio_url           TEXT,
  video_url           TEXT,
  downloadable        INTEGER NOT NULL DEFAULT 0,
  captions_available  INTEGER NOT NULL DEFAULT 0,
  play_count          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  published_at        TEXT,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sermons_status ON sermons (status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_sermons_series ON sermons (series_id);
CREATE INDEX IF NOT EXISTS idx_sermons_speaker ON sermons (speaker);

-- ─── News ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS news_articles (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'Community',
  region         TEXT,
  excerpt        TEXT NOT NULL DEFAULT '',
  body           TEXT,
  source         TEXT NOT NULL DEFAULT 'Hymnora Editorial',
  author         TEXT,
  image          TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '[]',
  featured       INTEGER NOT NULL DEFAULT 0,
  view_count     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  published_at   TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_status ON news_articles (status, deleted_at, published_at);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_articles (category);
CREATE INDEX IF NOT EXISTS idx_news_region ON news_articles (region);

-- ─── Churches ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS churches (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  location       TEXT NOT NULL DEFAULT '',
  address        TEXT,
  city           TEXT NOT NULL DEFAULT '',
  region         TEXT,
  country        TEXT NOT NULL DEFAULT '',
  country_code   TEXT,
  conference     TEXT,
  latitude       REAL NOT NULL DEFAULT 0,
  longitude      REAL NOT NULL DEFAULT 0,
  service        TEXT NOT NULL DEFAULT '',
  service_times  TEXT NOT NULL DEFAULT '[]',
  image          TEXT NOT NULL DEFAULT '',
  phone          TEXT,
  email          TEXT,
  website        TEXT,
  members        INTEGER,
  established    TEXT,
  description    TEXT,
  ministries     TEXT NOT NULL DEFAULT '[]',
  verified       INTEGER NOT NULL DEFAULT 0,
  is_live        INTEGER NOT NULL DEFAULT 0,
  live_status    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_churches_status ON churches (deleted_at, is_active);
CREATE INDEX IF NOT EXISTS idx_churches_country ON churches (country, city);
CREATE INDEX IF NOT EXISTS idx_churches_live ON churches (is_live);

CREATE TABLE IF NOT EXISTS followed_churches (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  church_id  TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  notify_live INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, church_id)
);

-- ─── Events ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'Worship',
  place            TEXT NOT NULL DEFAULT '',
  venue            TEXT,
  city             TEXT,
  country          TEXT,
  church_id        TEXT REFERENCES churches(id) ON DELETE SET NULL,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT,
  duration_days    INTEGER NOT NULL DEFAULT 1,
  is_online        INTEGER NOT NULL DEFAULT 0,
  is_live          INTEGER NOT NULL DEFAULT 0,
  image            TEXT NOT NULL DEFAULT '',
  description      TEXT,
  capacity         INTEGER,
  attending_count  INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived','cancelled')),
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events (status, deleted_at, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_category ON events (category);
CREATE INDEX IF NOT EXISTS idx_events_church ON events (church_id);

CREATE TABLE IF NOT EXISTS saved_events (
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id              TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  remind_before_minutes INTEGER NOT NULL DEFAULT 60,
  notify_live           INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, event_id)
);

-- ─── Live ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS live_streams (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  church_id          TEXT REFERENCES churches(id) ON DELETE SET NULL,
  church_name        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Live now','Starting soon','Upcoming','Recently ended')),
  image              TEXT NOT NULL DEFAULT '',
  stream_url         TEXT,
  replay_url         TEXT,
  viewer_count       INTEGER NOT NULL DEFAULT 0,
  captions_available INTEGER NOT NULL DEFAULT 0,
  multiview_count    INTEGER NOT NULL DEFAULT 1,
  language           TEXT NOT NULL DEFAULT 'English',
  category           TEXT NOT NULL DEFAULT 'Worship service',
  chat_enabled       INTEGER NOT NULL DEFAULT 1,
  track_id           TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  starts_at          TEXT,
  ends_at            TEXT,
  view_count         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_live_church ON live_streams (church_id);

-- ─── Library (per user) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_created ON favorites (user_id, created_at);

CREATE TABLE IF NOT EXISTS playlists (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  description            TEXT,
  cover_url              TEXT,
  is_public              INTEGER NOT NULL DEFAULT 0,
  item_count             INTEGER NOT NULL DEFAULT 0,
  total_duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists (user_id, updated_at);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (playlist_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items (playlist_id, position);

CREATE TABLE IF NOT EXISTS play_history (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type        TEXT NOT NULL,
  item_id          TEXT NOT NULL,
  progress_percent REAL NOT NULL DEFAULT 0,
  seconds_played   INTEGER NOT NULL DEFAULT 0,
  completed        INTEGER NOT NULL DEFAULT 0,
  played_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history (user_id, played_at);

CREATE TABLE IF NOT EXISTS notes (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type        TEXT NOT NULL,
  item_id          TEXT NOT NULL,
  body             TEXT NOT NULL,
  timestamp_seconds INTEGER,
  reference        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id, updated_at);

CREATE TABLE IF NOT EXISTS downloads (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  quality       TEXT NOT NULL DEFAULT 'high',
  size_bytes    INTEGER,
  downloaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads (user_id, downloaded_at);

CREATE TABLE IF NOT EXISTS followed_topics (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_type TEXT NOT NULL DEFAULT 'news',
  topic      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, topic_type, topic)
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','unsubscribed')),
  topics         TEXT NOT NULL DEFAULT '[]',
  source         TEXT,
  token_hash     TEXT,
  subscribed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at   TEXT,
  unsubscribed_at TEXT
);

-- ─── Cross-cutting ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_links (
  id          TEXT PRIMARY KEY,
  from_type   TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  to_type     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  relation    TEXT NOT NULL DEFAULT 'related',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (from_type, from_id, to_type, to_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_content_links_from ON content_links (from_type, from_id, position);
CREATE INDEX IF NOT EXISTS idx_content_links_to ON content_links (to_type, to_id);


CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL REFERENCES content_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS search_index (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  meta         TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  image        TEXT NOT NULL DEFAULT '',
  href         TEXT NOT NULL DEFAULT '',
  language     TEXT,
  availability TEXT NOT NULL DEFAULT 'any' CHECK (availability IN ('any','live','replay','download')),
  popularity   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_search_index_type ON search_index (type);
CREATE INDEX IF NOT EXISTS idx_search_index_availability ON search_index (availability);

CREATE TABLE IF NOT EXISTS search_queries (
  id            TEXT PRIMARY KEY,
  query         TEXT NOT NULL,
  normalized    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  result_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_search_queries_normalized ON search_queries (normalized, result_count);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  meta        TEXT NOT NULL DEFAULT '{}',
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id, created_at);
`;

const ftsSchema = `
CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5 (
  title,
  subtitle,
  meta,
  body,
  content = 'search_index',
  content_rowid = 'id',
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS trg_search_index_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO search_index_fts (rowid, title, subtitle, meta, body)
  VALUES (new.id, new.title, new.subtitle, new.meta, new.body);
END;

CREATE TRIGGER IF NOT EXISTS trg_search_index_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO search_index_fts (search_index_fts, rowid, title, subtitle, meta, body)
  VALUES ('delete', old.id, old.title, old.subtitle, old.meta, old.body);
END;

CREATE TRIGGER IF NOT EXISTS trg_search_index_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO search_index_fts (search_index_fts, rowid, title, subtitle, meta, body)
  VALUES ('delete', old.id, old.title, old.subtitle, old.meta, old.body);
  INSERT INTO search_index_fts (rowid, title, subtitle, meta, body)
  VALUES (new.id, new.title, new.subtitle, new.meta, new.body);
END;
`;

const nullableHymnTheme = `
-- Hymnal sources carry no thematic metadata, so themes come from the hand-maintained
-- assets/hymn-themes.json range map. Most hymns are not covered by it yet, so the
-- column has to be nullable: the NOT NULL DEFAULT 'Worship' previously stamped every
-- unmapped hymn with a placeholder and put all 9,460 of them in one bogus bucket.
ALTER TABLE hymns RENAME TO hymns_old;
CREATE TABLE hymns (
  id               TEXT PRIMARY KEY,
  number           TEXT NOT NULL,
  sort_number      INTEGER NOT NULL DEFAULT 0,
  title            TEXT NOT NULL,
  edition_id       TEXT NOT NULL,
  edition          TEXT NOT NULL DEFAULT '',
  language         TEXT NOT NULL DEFAULT 'English',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  image            TEXT NOT NULL DEFAULT '',
  theme            TEXT,
  theme_slug       TEXT,
  tune             TEXT,
  meter            TEXT,
  musical_key      TEXT,
  verse_count      INTEGER NOT NULL DEFAULT 0,
  lyrics           TEXT,
  copyright        TEXT,
  audio_url        TEXT,
  downloadable     INTEGER NOT NULL DEFAULT 0,
  play_count       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'published',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT,
  UNIQUE (edition_id, number)
);
INSERT INTO hymns SELECT
  id, number, sort_number, title, edition_id, edition, language, duration_seconds, image,
  CASE WHEN theme IN ('Worship', 'Hymn') THEN NULL ELSE theme END,
  theme_slug, tune, meter, musical_key, verse_count, lyrics, copyright, audio_url,
  downloadable, play_count, status, created_at, updated_at, deleted_at
FROM hymns_old;
DROP TABLE hymns_old;
CREATE INDEX IF NOT EXISTS idx_hymns_status ON hymns (status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_hymns_theme ON hymns (theme);
CREATE INDEX IF NOT EXISTS idx_hymns_edition ON hymns (edition_id);
CREATE INDEX IF NOT EXISTS idx_hymns_number ON hymns (sort_number);
`;

/**
 * The compact chapter store. Kept as its own migration because it changes how
 * verse text is stored, and a fresh database should get it in the same pass as
 * everything else.
 */
const chapterStore = `
/*
 * The compact store the reader actually reads from.
 *
 * One row per chapter instead of one per verse. At 31,000 verses a Bible is
 * 1,189 rows holding a zstd-compressed array of verse strings, instead of
 * 31,000 rows each repeating the version, book, book name and a surrogate text
 * key, each duplicated by four indexes. Measured on the real corpus that is
 * 719 MB down to roughly 65 MB for the same text, and a chapter read becomes
 * one row fetch rather than thirty.
 *
 * A plain rowid table rather than WITHOUT ROWID: measured on 8,000 real
 * chapters, WITHOUT ROWID came to 2.32x the payload against 1.37x for this
 * shape, because the key is stored in every leaf cell and large blobs spill
 * through overflow pages. The UNIQUE index is a rounding error next to that.
 */
CREATE TABLE IF NOT EXISTS bible_chapters (
  version_id  TEXT    NOT NULL,
  book_number INTEGER NOT NULL,
  chapter     INTEGER NOT NULL,
  verse_count INTEGER NOT NULL,
  payload     BLOB    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bible_chapters ON bible_chapters (version_id, book_number, chapter);
`;

/**
 * Device-level reminders, the YouTube ingest pipeline, and the reading streak
 * ledger.
 *
 * Three separate concerns land together because they share one thing: every
 * alert the phone can raise is a row in `push_subscriptions` joined to a row in
 * `user_preferences`. Splitting them across migrations would leave a database
 * where a subscription could not be read.
 */
const remindersAndIngest = `
-- ─── Reminders: device-level push, no in-app inbox ────────────────────────────
--
-- The app deliberately has no notifications page. Everything the user can be
-- alerted about is a native push delivered to a subscribed device, so a
-- subscription is the only durable record the platform keeps.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint            TEXT NOT NULL UNIQUE,
  p256dh              TEXT NOT NULL,
  auth                TEXT NOT NULL,
  content_encoding    TEXT NOT NULL DEFAULT 'aes128gcm',
  user_agent          TEXT,
  device_label        TEXT,
  timezone            TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  failure_count       INTEGER NOT NULL DEFAULT 0,
  last_success_at     TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- One row per (subscription, purpose, local day). The unique key is the whole
-- point: a worker that runs twice, or a user with two tabs open, must not
-- produce two identical morning verses on one phone.
CREATE TABLE IF NOT EXISTS push_deliveries (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  purpose         TEXT NOT NULL CHECK (purpose IN ('daily_verse','reading_streak','live_worship','event_reminder','new_content','weekly_letter','test')),
  dedupe_key      TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  url             TEXT,
  delivered_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (subscription_id, purpose, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_purpose ON push_deliveries (purpose, delivered_at);

-- A day the user actually read. Streaks are counted from this rather than from
-- the reader's saved place, so that someone who moves between translations or
-- clears their bookmarks does not silently lose a streak.
CREATE TABLE IF NOT EXISTS reading_days (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  chapters_read INTEGER NOT NULL DEFAULT 1,
  first_read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_reading_days_user ON reading_days (user_id, day);

-- ─── YouTube ingest: the whitelist registry ──────────────────────────────────
--
-- Channel ids here are the *only* thing the poller is allowed to ask YouTube
-- about. There is no open-ended search anywhere in the pipeline, which is what
-- keeps the daily quota flat regardless of how many users browse.

CREATE TABLE IF NOT EXISTS youtube_channels (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  handle             TEXT,
  channel_id         TEXT NOT NULL UNIQUE,
  country            TEXT NOT NULL DEFAULT '',
  region             TEXT NOT NULL DEFAULT 'global',
  language           TEXT NOT NULL DEFAULT 'English',
  focus              TEXT NOT NULL DEFAULT 'mixed' CHECK (focus IN ('music','preaching','mixed')),
  denomination       TEXT NOT NULL DEFAULT 'sda' CHECK (denomination IN ('sda','other')),
  is_active          INTEGER NOT NULL DEFAULT 1,
  max_new_per_run    INTEGER NOT NULL DEFAULT 12,
  last_polled_at     TEXT,
  last_upload_seen   TEXT,
  last_item_at       TEXT,
  added_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_youtube_channels_active ON youtube_channels (is_active, region);

-- Everything the poller saw, and what the filter decided about it. This is the
-- audit trail for the exclude/include gate: when a real choir upload is missing
-- from the music page, the verdict and the keywords that produced it are here.
CREATE TABLE IF NOT EXISTS youtube_videos (
  id                TEXT PRIMARY KEY,
  video_id          TEXT NOT NULL UNIQUE,
  channel_id        TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  thumbnail_url     TEXT,
  duration_seconds  INTEGER NOT NULL DEFAULT 0,
  published_at      TEXT,
  region            TEXT NOT NULL DEFAULT 'global',
  verdict           TEXT NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending','music','sermon','skipped')),
  category          TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  confidence        REAL NOT NULL DEFAULT 0,
  reasons           TEXT NOT NULL DEFAULT '[]',
  matched_keyword   TEXT,
  excluded_keyword  TEXT,
  routed_to         TEXT,
  reclassified_at    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_channel ON youtube_videos (channel_id, published_at);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_verdict ON youtube_videos (verdict, category);

-- Quota is the reason the whitelist exists, so it is measured rather than
-- assumed. A row per API call with its unit cost.
CREATE TABLE IF NOT EXISTS youtube_quota_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint      TEXT NOT NULL,
  units         INTEGER NOT NULL DEFAULT 1,
  channel_id    TEXT,
  items_seen    INTEGER NOT NULL DEFAULT 0,
  quota_day     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_youtube_quota_day ON youtube_quota_usage (quota_day, endpoint);
`;

/** Additive columns for the YouTube pipeline. SQLite has no ADD COLUMN IF NOT EXISTS. */
const ingestColumns = `
ALTER TABLE tracks ADD COLUMN youtube_video_id TEXT;
ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'editorial';
ALTER TABLE tracks ADD COLUMN sub_category TEXT;
ALTER TABLE tracks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tracks ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
ALTER TABLE tracks ADD COLUMN source_channel_id TEXT;

ALTER TABLE sermons ADD COLUMN youtube_video_id TEXT;
ALTER TABLE sermons ADD COLUMN source TEXT NOT NULL DEFAULT 'editorial';
ALTER TABLE sermons ADD COLUMN source_channel_id TEXT;

ALTER TABLE user_preferences ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN notify_daily_verse INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN daily_verse_time TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE user_preferences ADD COLUMN notify_reading_streak INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN streak_reminder_time TEXT NOT NULL DEFAULT '19:30';
ALTER TABLE user_preferences ADD COLUMN notify_live_worship INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN live_alert_lead_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE user_preferences ADD COLUMN notify_new_hymns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN reading_streak_current INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN reading_streak_best INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN last_reading_day TEXT;
`;

/**
 * The unique indexes are what make re-running the poller harmless, and they
 * live in their own migration because SQLite refuses to add a partial unique
 * index while duplicates exist. Databases predating the pipeline have no
 * `youtube_video_id` at all, so the sweep is a no-op on them and a genuine
 * cleanup on a database the poller has already touched.
 */
const ingestIndexes = `
DELETE FROM tracks WHERE youtube_video_id IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM tracks WHERE youtube_video_id IS NOT NULL GROUP BY youtube_video_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_youtube ON tracks (youtube_video_id) WHERE youtube_video_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sermons_youtube ON sermons (youtube_video_id) WHERE youtube_video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_sub_category ON tracks (sub_category, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks (source, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tracks_region ON tracks (region, kind, status);
`;

/**
 * `bible_verses` was added to the `001` block after `001` had already been
 * applied in every existing database, and migrations are recorded by id — so
 * editing an applied migration is silently a no-op. The table was therefore
 * never created here, while `src/db/seed.ts` has been seeding into it and
 * failing with "no such table: bible_verses".
 *
 * Migration 004 is the real store (`bible_chapters`, chapter blobs in `loadBibles.ts`),
 * so this table is only the KJV text the seeder writes inline. It is recreated
 * here, idempotently, because that is cheaper than rewriting the seeder, and
 * because the FK from `bible_bookmarks`-adjacent queries expects it to exist.
 */
const bibleVerses = `
CREATE TABLE IF NOT EXISTS bible_verses (
  id         TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE,
  book_id    TEXT NOT NULL REFERENCES bible_books(id) ON DELETE CASCADE,
  book       TEXT NOT NULL,
  chapter    INTEGER NOT NULL,
  verse      INTEGER NOT NULL,
  text       TEXT NOT NULL,
  UNIQUE (version_id, book_id, chapter, verse)
);
CREATE INDEX IF NOT EXISTS idx_bible_verses_lookup ON bible_verses (version_id, book_id, chapter, verse);
CREATE INDEX IF NOT EXISTS idx_bible_verses_book ON bible_verses (book, chapter);
`;

/**
 * The video page reads one list of watchable uploads, and a sermon is as
 * watchable as a hymn. `sermons` therefore needs the same three columns
 * `tracks` already had, so a single query can span both tables and render a
 * uniform card — without them the video grid could only ever show songs, and
 * the "Sermons" and "Live" filters had nothing behind them.
 *
 * `category` is the ingest bucket for a sermon (worship, camp meeting, …) so
 * the region and category chips work identically on both tables.
 */
const videoFields = `
ALTER TABLE sermons ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sermons ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sermons ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sermons ADD COLUMN category TEXT;
ALTER TABLE sermons ADD COLUMN region TEXT NOT NULL DEFAULT 'global';
CREATE INDEX IF NOT EXISTS idx_sermons_region ON sermons (region, is_live, published_at);
CREATE INDEX IF NOT EXISTS idx_tracks_views ON tracks (view_count DESC) WHERE deleted_at IS NULL;
`;

/**
 * Reels arrived as a page of their own, and a feed needs a shelf to put things
 * on. The column is a cache of `classifyReelCategory` rather than its
 * replacement: the classifier is pure and the same function runs on ingest and
 * on backfill, so a rule change is a re-run and not a data migration.
 */
const reelFields = `
ALTER TABLE youtube_videos ADD COLUMN reel_category TEXT;
ALTER TABLE youtube_videos ADD COLUMN reel_category_source TEXT;
CREATE INDEX IF NOT EXISTS idx_youtube_videos_reel ON youtube_videos (reel_category) WHERE reel_category IS NOT NULL;
`;

/**
 * Reels, follows and comments.
 *
 * These are new tables rather than new columns, and they are a new migration for
 * a reason that is easy to forget: the DDL above lives in migration 001, which
 * every existing database has already recorded as applied. Tables added there
 * after the fact are only ever created in a fresh database, which is precisely
 * the database nobody is looking at when a route starts throwing
 * "no such table: content_comments".
 */
const communityTables = `
-- ─── Reels ───────────────────────────────────────────────────────────────────

-- The taxonomy a vertical feed is organised by.
--
-- A row here rather than a constant in code, because two things have to agree:
-- the chip a reader taps and the label printed on the reel. The ids are stable
-- slugs because they end up in youtube_videos.reel_category and in a shared
-- category query parameter, and neither should break when a label is reworded.
CREATE TABLE IF NOT EXISTS reel_categories (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);

-- The reels feed's own bucketing, kept beside the ingest classification rather
-- than replacing it: the category column answers "is this music?", the
-- reel_category column answers "which shelf of the feed does this belong on?".
-- Added by migration 009, since SQLite cannot add a column idempotently.

-- Who someone follows, beyond churches: creators, choirs, ministries, regions.
CREATE TABLE IF NOT EXISTS follows (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('creator','choir','church','ministry','topic','region')),
  target_id   TEXT NOT NULL,
  label       TEXT NOT NULL,
  notify_new  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_target ON follows (target_type, target_id);

-- "Not interested" is a real preference, not a UI trick: the reel must stay gone
-- on the next device that signs in, which local state can never do.
CREATE TABLE IF NOT EXISTS reel_hidden (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, video_id)
);

-- ─── Comments ────────────────────────────────────────────────────────────────

-- One comment table for every surface that can be commented on.
--
-- target_type is a string rather than four nullable foreign keys because the
-- comment thread is identical wherever it hangs — the reel, the article, the
-- church — and a table per surface would mean four copies of the same
-- pagination, the same delete rules and the same moderation query.
CREATE TABLE IF NOT EXISTS content_comments (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES content_comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  like_count  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_comments_target ON content_comments (target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_content_comments_parent ON content_comments (parent_id);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL REFERENCES content_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (comment_id, user_id)
);
`;

/**
 * The heart on a reel.
 *
 * Its own migration, added after the tables it sits beside were already applied,
 * for the same reason as 010: DDL added to an applied migration only ever runs
 * in a fresh database.
 */
const reelLikes = `
-- A heart on a reel, server-side. It is the first button on the action rail and
-- the one a reader is most likely to expect to still be there tomorrow.
CREATE TABLE IF NOT EXISTS reel_likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, video_id)
);
`;

/**
 * 012_recent_preferences.sql
 * SQLite cannot alter a CHECK constraint, and the theme column keeps the same
 * CHECK list everywhere it is defined, so this rewrites user_preferences. It
 * keeps every existing column and value, widens `theme` to accept 'system'
 * (follow the OS colour scheme), and adds the two Settings toggles that were
 * previously client-only: `captions` and `bedroom_mode`.
 *
 * The copy selects every old column explicitly so the two new booleans fall
 * back to their defaults instead of riding along the ORDER of the previous
 * schema description.
 */
const preferenceExtras = `
ALTER TABLE user_preferences RENAME TO user_preferences_old;

CREATE TABLE user_preferences (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language                TEXT NOT NULL DEFAULT 'English',
  theme                   TEXT NOT NULL DEFAULT 'warm' CHECK (theme IN ('light','warm','dark','system')),
  reading_theme           TEXT NOT NULL DEFAULT 'cream' CHECK (reading_theme IN ('cream','light','dark')),
  reader_font_size        INTEGER NOT NULL DEFAULT 18,
  autoplay                INTEGER NOT NULL DEFAULT 1,
  crossfade               INTEGER NOT NULL DEFAULT 0,
  normalize_volume        INTEGER NOT NULL DEFAULT 1,
  download_quality        TEXT NOT NULL DEFAULT 'high' CHECK (download_quality IN ('standard','high','lossless')),
  data_saver              INTEGER NOT NULL DEFAULT 0,
  captions                INTEGER NOT NULL DEFAULT 0,
  bedroom_mode            INTEGER NOT NULL DEFAULT 0,
  notify_new_content      INTEGER NOT NULL DEFAULT 1,
  notify_live_events      INTEGER NOT NULL DEFAULT 1,
  notify_weekly_letter    INTEGER NOT NULL DEFAULT 0,
  event_reminder_minutes  INTEGER NOT NULL DEFAULT 60,
  default_bible_version   TEXT NOT NULL DEFAULT 'KJV',
  bible_translation      TEXT NOT NULL DEFAULT 'KJV',
  followed_topics         TEXT NOT NULL DEFAULT '[]',
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO user_preferences (
  user_id, language, theme, reading_theme, reader_font_size, autoplay,
  crossfade, normalize_volume, download_quality, data_saver,
  notify_new_content, notify_live_events, notify_weekly_letter,
  event_reminder_minutes, default_bible_version, bible_translation,
  followed_topics, updated_at
)
SELECT
  user_id, language, theme, reading_theme, reader_font_size, autoplay,
  crossfade, normalize_volume, download_quality, data_saver,
  notify_new_content, notify_live_events, notify_weekly_letter,
  event_reminder_minutes, default_bible_version, bible_translation,
  followed_topics, updated_at
FROM user_preferences_old;

DROP TABLE user_preferences_old;
`;

export const migrations: Migration[] = [
  { id: "001", name: "core_schema", sql: coreSchema },
  { id: "002", name: "full_text_search", sql: ftsSchema },
  { id: "003", name: "nullable_hymn_theme", sql: nullableHymnTheme },
  { id: "004", name: "bible_chapter_store", sql: chapterStore },
  { id: "005", name: "reminders_and_youtube_ingest", sql: remindersAndIngest + ingestColumns },
  { id: "006", name: "ingest_indexes", sql: ingestIndexes },
  { id: "007", name: "bible_verses_backfill", sql: bibleVerses },
  { id: "008", name: "video_fields", sql: videoFields },
  { id: "009", name: "reels_taxonomy", sql: reelFields },
  { id: "010", name: "reels_follows_comments", sql: communityTables },
  { id: "011", name: "reel_likes", sql: reelLikes },
  { id: "012", name: "preferences_theme_and_flags", sql: preferenceExtras },
];

