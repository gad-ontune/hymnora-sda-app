/**
 * The ingest's two `INSERT`s, checked as column sets.
 *
 * Both `upsertTrackFromVideo` and `upsertSermonFromVideo` build a
 * `[column, value][]` array and render the SQL from it, which is what stopped the
 * hand-written placeholder lists from drifting out of step with the columns. It
 * does not stop the reverse failure: a field the caller has a value for, which the
 * array simply forgets to mention. That is not hypothetical — `like_count` was
 * read from YouTube, stored in the schema, and never written, so every ingested
 * row reported zero likes and nothing complained.
 *
 * So these tests assert coverage, not agreement: every field of `YouTubeVideo`
 * that carries information has to appear as a column somewhere in the insert.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/modules/youtube/ingest.ts", import.meta.url)), "utf8");

/** The column names inside one function's `columns` array. */
function columnsOf(functionName: string): string[] {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/\["([a-z_]+)",/g)].map((match) => match[1]);
}

const TRACK_COLUMNS = columnsOf("upsertTrackFromVideo");
const SERMON_COLUMNS = columnsOf("upsertSermonFromVideo");

describe("ingest insert coverage", () => {
  it("finds both insert builders", () => {
    assert.ok(TRACK_COLUMNS.length > 20, `track columns: ${TRACK_COLUMNS.length}`);
    assert.ok(SERMON_COLUMNS.length > 15, `sermon columns: ${SERMON_COLUMNS.length}`);
  });

  for (const [what, columns] of [
    ["track", TRACK_COLUMNS],
    ["sermon", SERMON_COLUMNS],
  ] as const) {
    it(`stores the view count on every ${what}`, () => {
      assert.ok(columns.includes("view_count"), `columns: ${columns.join(", ")}`);
    });

    it(`stores the like count on every ${what}`, () => {
      assert.ok(
        columns.includes("like_count"),
        `${what} insert omits like_count, so YouTube's like counts are dropped`,
      );
    });

    it(`stores the livestream flag on every ${what}`, () => {
      assert.ok(columns.includes("is_live"), `columns: ${columns.join(", ")}`);
    });

    it(`stores the YouTube id on every ${what}`, () => {
      assert.ok(columns.includes("youtube_video_id"), `columns: ${columns.join(", ")}`);
    });
  }

  it("never writes a column twice, which SQLite would accept but the data would not", () => {
    for (const [what, columns] of [
      ["track", TRACK_COLUMNS],
      ["sermon", SERMON_COLUMNS],
    ] as const) {
      const seen = new Set<string>();
      for (const column of columns) {
        assert.equal(seen.has(column), false, `${what} writes ${column} twice`);
        seen.add(column);
      }
    }
  });

  it("references a column that exists in the table it inserts into", () => {
    // A typo in a column name is an SQL error at runtime, and ingest wraps each
    // channel in a try, so it would read as a channel that failed rather than as
    // a broken write.
    //
    // The real table shape is the base CREATE TABLE plus every ADD COLUMN
    // migration, because that is how most of the YouTube columns got there:
    // `youtube_video_id` is added by migration, not declared in `tracks`.
    const schema = readFileSync(fileURLToPath(new URL("../src/db/schema.ts", import.meta.url)), "utf8");
    const columnsOf = (table: string) => {
      const declared = schema.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      assert.ok(declared, `${table} should be declared in the schema`);
      const columns = new Set([...declared[1]!.matchAll(/^\s*([a-z_]+)\s/gm)].map((found) => found[1]!));
      for (const added of schema.matchAll(
        new RegExp(`ALTER TABLE ${table} ADD COLUMN ([a-z_]+)`, "g"),
      )) {
        columns.add(added[1]!);
      }
      return columns;
    };
    const tracks = columnsOf("tracks");
    const sermons = columnsOf("sermons");
    for (const column of TRACK_COLUMNS) {
      assert.ok(tracks.has(column), `tracks has no column "${column}"`);
    }
    for (const column of SERMON_COLUMNS) {
      assert.ok(sermons.has(column), `sermons has no column "${column}"`);
    }
  });

  it("leaves no metric on YouTubeVideo unaccounted for", () => {
    // The general form of the bug: `YouTubeVideo` grew a field, the schema
    // gained a column for it, the client started reading it, and the insert
    // never mentioned it. The rule is that a camelCase metric must have its
    // snake_case column written, unless it is listed as derived below. So adding
    // a field to the type is a deliberate act rather than a silent one.
    const client = readFileSync(
      fileURLToPath(new URL("../src/modules/youtube/client.ts", import.meta.url)),
      "utf8",
    );
    const block = client.match(/export type YouTubeVideo = \{([\s\S]*?)\n\};/);
    assert.ok(block, "YouTubeVideo should be a declared type");
    const fields = [...block[1]!.matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((found) => found[1]!);
    assert.ok(fields.length > 5, `parsed ${fields.length} fields from YouTubeVideo`);

    // Fields that are not stored as themselves: either the lookup key, the text
    // we already persist in differently-named columns, or the classifier's
    // verdict, which lands in `tags` and `genre` rather than in its own column.
    const derived = new Set([
      "videoId",
      "title",
      "description",
      "publishedAt",
      "tags",
      "channelId",
      "channelTitle",
      "durationSeconds",
      "thumbnailUrl",
    ]);
    const snake = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const written = new Set([...TRACK_COLUMNS, ...SERMON_COLUMNS]);
    const unwritten = fields
      .filter((field) => !derived.has(field))
      .filter((field) => !written.has(snake(field)))
      .map(snake);
    assert.deepEqual(unwritten, [], "these YouTubeVideo metrics are read but never written:");
  });
});
