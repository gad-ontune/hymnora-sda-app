#!/usr/bin/env node
/**
 * Smoke-tests every documented GET endpoint and prints a pass/fail table.
 *
 * Run against a booted server: `node scripts/smoke.mjs [baseUrl]`
 */

const base = process.argv[2] ?? "http://127.0.0.1:4000";

const paths = [
  "/api/health", "/api/health/live", "/api/health/ready",
  "/api/openapi", "/api/openapi.json", "/api/openapi/count",
  "/api/home", "/api/hero-track",
  "/api/search?q=love", "/api/search/facets?q=love", "/api/search/popular",
  "/api/tracks", "/api/tracks/facets", "/api/tracks/trk_001", "/api/tracks/trk_001/related",
  "/api/albums", "/api/collections",
  "/api/videos", "/api/videos/facets",
  "/api/hymns", "/api/hymns/detail", "/api/hymns/themes", "/api/hymns/tunes", "/api/hymns/editions",
  "/api/bible/versions", "/api/bible/books", "/api/bible/verses?reference=John%203:16",
  "/api/bible/passage/John%203:16", "/api/bible/search?q=light", "/api/bible/chapters?book=John",
  "/api/bible/chapters/3?book=John",
  "/api/sermons", "/api/sermons/detail", "/api/sermons/series", "/api/sermons/speakers",
  "/api/news", "/api/news/facets", "/api/news/detail",
  "/api/churches", "/api/churches/facets",
  "/api/events", "/api/events/facets",
  "/api/live", "/api/live/now", "/api/live/facets",
  "/api/preferences", "/api/preferences/notifications",
  "/api/admin/stats",
];

const results = [];
for (const path of paths) {
  const started = process.hrtime.bigint();
  try {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(8000) });
    const body = await response.text();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const size = body.length;
    let note = "";
    if (!response.ok) note = body.slice(0, 160);
    else {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) note = `array(${parsed.length})`;
        else if (parsed && typeof parsed === "object") note = `object{${Object.keys(parsed).slice(0, 5).join(",")}}`;
      } catch { note = `text(${size}b)`; }
    }
    results.push({ path, status: response.status, ms: ms.toFixed(0), note });
  } catch (error) {
    results.push({ path, status: "ERR", ms: "-", note: String(error).slice(0, 120) });
  }
}

const width = Math.max(...paths.map((p) => p.length));
for (const r of results) {
  const status = String(r.status).padStart(3);
  const mark = r.status === 200 ? " " : "!";
  console.log(`${mark} ${status} ${r.path.padEnd(width)}  ${String(r.ms).padStart(5)}ms  ${r.note}`);
}
const failed = results.filter((r) => r.status !== 200);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
