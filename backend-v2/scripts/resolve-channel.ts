#!/usr/bin/env node --experimental-strip-types
/**
 * Resolves a channel handle or name to its id, for filling in the whitelist.
 *
 *     npm run channels:resolve -- @hopesda
 *     npm run channels:resolve -- "Adventist Choir of Kenya"
 *
 * The ids in `whitelist.ts` were written by hand. This is the tool that replaces
 * them with something real, so nobody is tempted to fix a broken id by editing a
 * string in the source. Costs 100 units, so it is for the moment of resolving,
 * not for the worker.
 */

import { env } from "../src/config/env.ts";
import { recordQuotaUse, SEARCH_UNIT_COST } from "../src/modules/youtube/client.ts";

const query = process.argv.slice(2).filter((arg) => arg !== "--").join(" ").trim();
if (!query) {
  process.stderr.write(
    "Usage: npm run channels:resolve -- <@handle or channel name>\n\n" +
      "  A handle is unambiguous and cheap. A name search is not: check that the\n" +
      "  result really is the SDA organisation you want before pasting the id.\n",
  );
  process.exit(1);
}

if (!env.youtubeApiKey) {
  process.stderr.write("YOUTUBE_API_KEY is not set. Add it to backend-v2/.env first.\n");
  process.exit(1);
}

type SearchItem = {
  id: { channelId?: string };
  snippet: {
    title: string;
    customUrl?: string;
    country?: string;
    description?: string;
  };
};

const isHandle = query.startsWith("@");
const url = new URL("https://www.googleapis.com/youtube/v3/search");
// A handle is a lookup; a name is a search. The pipeline itself never searches —
// this script is the one place a human is allowed to.
const parts = isHandle ? ["snippet", "channelId"] : ["snippet"];
url.searchParams.set("part", parts.join(","));
url.searchParams.set("type", "channel");
url.searchParams.set("q", query);
url.searchParams.set("maxResults", isHandle ? "1" : "10");
url.searchParams.set("key", env.youtubeApiKey);

process.stdout.write(`\nResolving ${isHandle ? "handle" : "name"} "${query}" (100 quota units)\n\n`);

const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
const body = (await response.json().catch(() => ({}))) as {
  items?: SearchItem[];
  error?: { message?: string };
};

// A search is the single most expensive call in the project, so it is recorded
// even when it fails — the quota is spent either way, and an audit that only
// logs the successes understates the bill.
recordQuotaUse(`search.list:${isHandle ? "handle" : "name"}`, SEARCH_UNIT_COST, body.items?.length ?? 0);

if (!response.ok) {
  process.stderr.write(`YouTube returned ${response.status}: ${body.error?.message ?? "unknown error"}\n`);
  process.exit(1);
}

const items = body.items ?? [];
if (!items.length) {
  process.stderr.write(`Nothing found for "${query}".\n\n`);
  process.exit(1);
}

for (const item of items) {
  const channelId = item.id.channelId;
  process.stdout.write(
    `  ${item.snippet.title}\n` +
      `    id       ${channelId ?? "(no channelId — this is a playlist or video result)"}\n` +
      `    handle   ${item.snippet.customUrl ?? "—"}\n` +
      `    country  ${item.snippet.country ?? "—"}\n\n`,
  );
}

if (items.length > 1) {
  process.stdout.write(
    "Several results. Confirm this is the SDA organisation you mean by opening the\n" +
      "channel's About page, then paste the id into whitelist.ts.\n\n",
  );
} else {
  process.stdout.write("Check the About page says what you expect, then paste the id into whitelist.ts.\n\n");
}
