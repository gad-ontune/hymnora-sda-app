/**
 * One-off: fill in `like_count` for rows ingested before the insert learned to
 * write it. Every YouTube-backed row was stored with 0 likes, because
 * `upsertTrackFromVideo`/`upsertSermonFromVideo` read `video.likeCount` from
 * YouTube and then left it out of the column list. YouTube does report the
 * counts, so they can be recovered rather than re-ingested.
 *
 * Ingest is append-only by design — it skips ids it has already seen — so a
 * re-run would not fix this. Cost is 1 unit per 50 ids.
 *
 * Usage: node --experimental-strip-types scripts/backfill-likes.ts
 */

import { DatabaseSync } from "node:sqlite";
import { hydrateVideos } from "../src/modules/youtube/client.ts";

const db = new DatabaseSync(new URL("../data/hymnora.db", import.meta.url).pathname);

const targets = [
  { table: "tracks", idColumn: "id" },
  { table: "sermons", idColumn: "id" },
] as const;

let total = 0;

for (const { table, idColumn } of targets) {
  const rows = db
    .prepare(
      `SELECT ${idColumn} AS id, youtube_video_id AS videoId, like_count AS likes
         FROM ${table}
        WHERE youtube_video_id IS NOT NULL AND COALESCE(like_count, 0) = 0`,
    )
    .all() as { id: string; videoId: string; likes: number }[];

  if (rows.length === 0) {
    console.log(`${table}: nothing to backfill`);
    continue;
  }

  const hydrated = await hydrateVideos(rows.map((row) => row.videoId));
  const update = db.prepare(`UPDATE ${table} SET like_count = ? WHERE ${idColumn} = ?`);

  let updated = 0;
  for (const row of rows) {
    const video = hydrated.get(row.videoId);
    // A missing entry means YouTube withheld the video, not that it has no
    // likes, so leave the row alone rather than writing a confident 0.
    if (!video) continue;
    update.run(video.likeCount, row.id);
    updated += 1;
  }

  const withLikes = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${table}
        WHERE youtube_video_id IS NOT NULL AND COALESCE(like_count, 0) > 0`,
    )
    .get() as { n: number };
  console.log(`${table}: ${updated}/${rows.length} rows updated, ${withLikes.n} now have likes`);
  total += updated;
}

console.log(`done: ${total} rows backfilled`);
