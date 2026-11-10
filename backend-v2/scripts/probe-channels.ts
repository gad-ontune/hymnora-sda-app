#!/usr/bin/env node --experimental-strip-types
/**
 * Resolves whitelist titles to candidate channel ids and prints a review table.
 * It does NOT write to whitelist.ts.
 *
 *     npm run channels:probe -- east-africa
 *     npm run channels:probe -- east-africa "Adventist Choir of Kenya"
 *     npm run channels:probe -- --cached          # re-print, costs nothing
 *
 * A name search cannot prove a channel is the SDA organisation it claims to be,
 * and this script does not pretend otherwise. What it does is make the judgement
 * cheap: the top candidates come back with their real title, handle, country,
 * subscriber count and upload count, so the decision is made from one screen
 * rather than by opening forty tabs.
 *
 * Two costs, both recorded:
 *   100 units per title  — `search.list`, unavoidable
 *     1 unit per 50 ids  — `channels.list` for the stats and real titles
 *
 * `search.list` returns almost nothing useful: no `customUrl`, and the title it
 * does return is often a legacy handle. That is why every candidate is hydrated
 * afterwards. Requesting `statistics` on the search call instead is rejected
 * outright and the 100 units are gone.
 *
 * Results are cached in data/channel-probe.json, so printing and re-reviewing
 * costs nothing. Delete the file to search again.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHANNEL_WHITELIST, type WhitelistSeed } from "../src/modules/youtube/whitelist.ts";
import { env, projectRoot } from "../src/config/env.ts";
import { CHANNELS_LIST_UNIT_COST, recordQuotaUse, remainingQuota, SEARCH_UNIT_COST } from "../src/modules/youtube/client.ts";

const CACHE_FILE = resolve(projectRoot, "data", "channel-probe.json");

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const positional = args.filter((arg) => !arg.startsWith("--"));
const region = positional[0];
const explicitTitles = positional.slice(1);

type Candidate = {
  id: string;
  title: string;
  handle: string | null;
  country: string | null;
  subscribers: string | null;
  videos: string | null;
  description: string;
};

type ProbeResult = { title: string; candidates: Candidate[] };

function readCache(): Record<string, ProbeResult> {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, ProbeResult>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, ProbeResult>): void {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

/** A loose hint, never a verdict. See `looksRight`. */
async function search(query: string): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "channel");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("key", env.youtubeApiKey!);

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json().catch(() => ({}))) as {
    items?: { id: { channelId?: string } }[];
    error?: { message?: string };
  };
  recordQuotaUse("search.list:probe", SEARCH_UNIT_COST, body.items?.length ?? 0);
  if (!response.ok) {
    throw new Error(body.error?.message ?? `YouTube returned ${response.status}`);
  }
  return (body.items ?? []).flatMap((item) => (item.id.channelId ? [item.id.channelId] : []));
}

/** Real titles, handles, countries and counts for up to 50 ids per unit. */
async function hydrate(ids: string[]): Promise<Map<string, Candidate>> {
  const found = new Map<string, Candidate>();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
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
      found.set(item.id, {
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
  return found;
}

/**
 * How well a candidate matches the title we were looking for.
 *
 * Two signals only. Does the candidate's own text share a distinctive word with
 * the intended title, and does it say Adventist or SDA at all. Common words are
 * dropped first, because "worship" and "church" match everything and would make
 * every row look strong.
 */
function looksRight(channel: WhitelistSeed, candidate: Candidate): "strong" | "adventist?" | "title match" | "weak" {
  const haystack = `${candidate.title} ${candidate.description}`.toLowerCase();
  const wanted = channel.title
    .toLowerCase()
    .split(/[\s—&/|,]+/)
    .filter((word) => word.length > 4 && !["church", "media", "official", "worship", "music", "choir", "singers"].includes(word));
  const overlap = wanted.some((word) => haystack.includes(word));
  const saysAdventist = /adventist|\bsda\b|seventh[- ]day|general conference|mission\b/.test(haystack);
  if (overlap && saysAdventist) return "strong";
  if (saysAdventist) return "adventist?";
  if (overlap) return "title match";
  return "weak";
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)}…` : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

async function main(): Promise<void> {
  const regions = [...new Set(CHANNEL_WHITELIST.map((channel) => channel.region))];
  if (positional.length === 1 && !regions.includes(region as never)) {
    process.stderr.write(`"${region}" is not a region. Choose one of: ${regions.join(", ")}\n`);
    process.exit(1);
  }

  const targets = explicitTitles.length
    ? CHANNEL_WHITELIST.filter((channel) => explicitTitles.includes(channel.title))
    : CHANNEL_WHITELIST.filter((channel) => (region ? channel.region === region : true));

  if (!targets.length) {
    process.stderr.write(`No whitelist entries matched ${JSON.stringify(positional)}\n`);
    process.exit(1);
  }

  const cache = readCache();
  const pending = args.includes("--cached") ? [] : targets.filter((channel) => !cache[channel.title]);
  const cached = targets.filter((channel) => cache[channel.title]);

  if (pending.length) {
    if (!env.youtubeApiKey) {
      process.stderr.write("YOUTUBE_API_KEY is not set. Add it to backend-v2/.env first.\n");
      process.exit(1);
    }
    const cost = pending.length * SEARCH_UNIT_COST;
    const budget = remainingQuota();
    if (cost + 2 > budget) {
      process.stderr.write(
        `This batch would cost about ${cost} units but only ${budget} remain today. ` +
          "Narrow it first, for example: npm run channels:probe -- east-africa\n",
      );
      process.exit(1);
    }
    process.stdout.write(`\nSearching ${pending.length} titles (${cost} units, ${budget} available)\n`);

    // One search per title, in search-rank order, kept per channel so the
    // ordering survives into the report. Searching again to recover the order
    // would double the bill.
    const perChannel = new Map<string, string[]>();
    const discovered: string[] = [];
    for (const channel of pending) {
      const query = channel.handle ? `@${channel.handle.replace(/^@/, "")}` : channel.title;
      let ids: string[] = [];
      try {
        ids = await search(query);
      } catch (error) {
        process.stderr.write(
          `  search failed for "${channel.title}": ${error instanceof Error ? error.message : error}\n`,
        );
      }
      perChannel.set(channel.title, ids);
      discovered.push(...ids);
    }

    const hydrated = await hydrate(discovered);
    for (const channel of pending) {
      const ids = perChannel.get(channel.title) ?? [];
      cache[channel.title] = {
        title: channel.title,
        candidates: ids.flatMap((id) => (hydrated.get(id) ? [hydrated.get(id)!] : [])),
      };
    }
    writeCache(cache);
  }

  if (cached.length) {
    process.stdout.write(`\n${cached.length} titles reused from cache (no quota spent)\n`);
  }

  process.stdout.write(`\nWhitelist probe — candidates per title. Nothing here is written to the source.\n\n`);

  const strong: string[] = [];
  for (const channel of targets) {
    const candidates = cache[channel.title]?.candidates ?? [];
    const scored = candidates
      .map((candidate) => ({ candidate, score: looksRight(channel, candidate) }))
      .sort((a, b) => (a.score === "strong" ? -1 : b.score === "strong" ? 1 : 0));

    const top = scored[0];
    process.stdout.write(
      `  ${top?.score === "strong" ? "★" : " "} ${pad(channel.title, 42)} ${pad(channel.region, 15)}` +
        `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}\n`,
    );
    if (top?.score === "strong") strong.push(channel.title);

    for (const { candidate, score } of scored.slice(0, 3)) {
      process.stdout.write(
        `      ${pad(score, 13)} ${candidate.id}  ${pad(candidate.title, 40)} ${padStart(candidate.subscribers ?? "?", 9)} subs  ` +
          `${padStart(candidate.videos ?? "?", 6)} videos  ${candidate.handle ?? ""}\n`,
      );
      if (candidate.description) {
        process.stdout.write(`                     ${candidate.description}\n`);
      }
    }
  }

  process.stdout.write(
    `\n  ${targets.length} titles — ${strong.length} with a strong top candidate` +
      `\n  remaining today: ${remainingQuota()}\n\n`,
  );
  process.stdout.write(
    "★ is a keyword hint only. Before pasting any id into whitelist.ts, open the channel and\n" +
      "read its About page: the name must match and the description must show it is an SDA\n" +
      "organisation, not a fan upload or a compilation channel. `channels:verify` will then\n" +
      "confirm the id resolves and the title matches.\n\n",
  );
}

await main();
