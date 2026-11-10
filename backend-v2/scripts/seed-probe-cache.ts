#!/usr/bin/env node --experimental-strip-types
/**
 * Seeds the probe cache from channel ids that have already been discovered.
 *
 *     npm run channels:probe -- --seed-from-ids
 *
 * A search is 100 units and a hydration is 1 unit per 50 ids. Once candidates
 * are known, re-running the searches to recover them is pure waste, so this
 * hydrates the ids already on file into the cache. It exists because the first
 * version of the probe threw away its results after printing them, which turned
 * a 1,202-unit run into a 2,402-unit one.
 *
 * Ids come from `data/channel-probe-ids.json` — a flat list per whitelist title.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHANNEL_WHITELIST } from "../src/modules/youtube/whitelist.ts";
import { env, projectRoot } from "../src/config/env.ts";
import { CHANNELS_LIST_UNIT_COST, recordQuotaUse, remainingQuota } from "../src/modules/youtube/client.ts";

const IDS_FILE = resolve(projectRoot, "data", "channel-probe-ids.json");
const CACHE_FILE = resolve(projectRoot, "data", "channel-probe.json");

if (!existsSync(IDS_FILE)) {
  process.stderr.write(
    `No id list at ${IDS_FILE}.\n\n` +
      "Create it as { \"<whitelist title>\": [\"UC…\", …], … } — one key per\n" +
      "whitelist title, up to five ids each in search-rank order. Only needed to\n" +
      "recover from a probe run whose results were not cached.\n",
  );
  process.exit(1);
}

const idsByTitle = JSON.parse(readFileSync(IDS_FILE, "utf8")) as Record<string, string[]>;
const known = new Set(CHANNEL_WHITELIST.map((channel) => channel.title));
const allIds = [...new Set(Object.values(idsByTitle).flat())];

process.stdout.write(`\nHydrating ${allIds.length} ids (~${Math.ceil(allIds.length / 50)} unit, ${remainingQuota()} available)\n`);

const hydrated = new Map<string, Record<string, unknown>>();
for (let start = 0; start < allIds.length; start += 50) {
  const batch = allIds.slice(start, start + 50);
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("id", batch.join(","));
  url.searchParams.set("key", env.youtubeApiKey!);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json().catch(() => ({}))) as {
    items?: {
      id: string;
      snippet?: { title?: string; customUrl?: string; country?: string; description?: string };
      statistics?: { subscriberCount?: string; videoCount?: string };
    }[];
  };
  recordQuotaUse("channels.list:probe-hydrate", CHANNELS_LIST_UNIT_COST, body.items?.length ?? 0);
  for (const item of body.items ?? []) {
    hydrated.set(item.id, {
      id: item.id,
      title: item.snippet?.title ?? "(untitled)",
      handle: item.snippet?.customUrl ?? null,
      country: item.snippet?.country ?? null,
      subscribers: item.statistics?.subscriberCount ?? null,
      videos: item.statistics?.videoCount ?? null,
      description: (item.snippet?.description ?? "").replace(/\s+/g, " ").slice(0, 220),
    });
  }
}

let cache: Record<string, unknown> = {};
try {
  cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, unknown>;
} catch {
  /* first run */
}

for (const [title, ids] of Object.entries(idsByTitle)) {
  if (!known.has(title)) {
    process.stderr.write(`  skipping "${title}" — not a whitelist title\n`);
    continue;
  }
  cache[title] = {
    title,
    candidates: ids.flatMap((id) => (hydrated.has(id) ? [hydrated.get(id)] : [])),
  };
}

writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
process.stdout.write(`\nCached ${Object.keys(cache).length} titles. Print them with:\n  npm run channels:probe -- --cached\n\n`);
