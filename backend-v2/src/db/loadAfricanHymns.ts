import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { run, all } from "./client.ts";

const ROOT = new URL("../../../assets/global-african/", import.meta.url).pathname;

function parseFrontmatter(text: string) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only top-level keys; the nested `metadata:` block is not top level.
    const idx = line.indexOf(":");
    if (idx <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    // `title: |` and `description: >` are YAML block scalars: the real text is
    // on the following indented lines, not the `|` on the key's own line.
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        block.push(lines[++i].trim());
      }
      meta[key] = block.join(" ").trim();
      continue;
    }
    meta[key] = value;
  }
  return meta;
}

/** `203. Ya Saba Ni Kwa Yesu - Nyimbo Za Kristo` -> `Ya Saba Ni Kwa Yesu` */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*\d+\s*[.)-]?\s*/, "")
    .replace(/\s*[-–—]\s*Nyimbo\s+[Zz]a\s+Kristo\s*$/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function loadAfrican(): { loaded: number; skipped: boolean; errors: string[] } {
  let loaded = 0, errors: string[] = [];
  const editionId = "NZK";

  // "Nyimbo za Kristo" is also shipped as CIS-swahili, with the same 220 hymns
  // under the same numbers. Loading both would show every Swahili hymn twice,
  // so this edition only loads when the CIS one is absent.
  const cisSwahili = all<{ c: number }>(
    "SELECT COUNT(*) c FROM hymn_editions WHERE id = 'CIS-swahili'",
  )[0].c;
  if (cisSwahili > 0) {
    return { loaded: 0, skipped: true, errors: [] };
  }

  // Ensure edition
  const ed = all<{ c: number }>("SELECT COUNT(*) c FROM hymn_editions WHERE id = ?", [editionId])[0].c;
  if (ed === 0) {
    run("INSERT INTO hymn_editions (id, name, code, language, year, publisher) VALUES (?, ?, ?, ?, ?, ?)",
      [editionId, "Nyimbo za Kristo", "NZK", "Swahili", 1944, "Advent Hymnals"]);
  }

  function processDir(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) processDir(p);
      else if (entry.endsWith(".md") && !entry.includes("index")) {
        try {
          const text = readFileSync(p, "utf-8");
          const meta = parseFrontmatter(text);
          const rawTitle = meta.title || meta.description || entry.replace(/\.md$/, "");
          const title = cleanTitle(rawTitle.split("\n")[0] ?? rawTitle);
          if (!title) {
            errors.push(`${entry}: no usable title in frontmatter`);
            continue;
          }
          const author = meta.author || "Unknown";
          // Extract lyrics after code block
          const lyricsMatch = text.match(/```txt\n([\s\S]*?)\n```/);
          const lyrics = lyricsMatch ? lyricsMatch[1].trim() : text.slice(text.indexOf("---") + 1).trim();
          const number = String(loaded + 1);
          const id = `nzk-${String(loaded + 1).padStart(3, "0")}`;
          run(`INSERT INTO hymns (id, number, sort_number, title, edition_id, edition, language, duration_seconds, image, theme, lyrics, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, lyrics=excluded.lyrics`, [
            id, number, loaded + 1, title, editionId, "Nyimbo za Kristo", "Swahili", 0, "", "Worship", lyrics || null, "published"
          ]);
          loaded++;
        } catch (e) {
          errors.push(`${entry}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  processDir(ROOT);
  return { loaded, skipped: false, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = loadAfrican();
  console.log(
    r.skipped
      ? "Skipped NZK: CIS-swahili already provides the same 220 Nyimbo za Kristo hymns"
      : `Loaded ${r.loaded} African hymns, errors=${r.errors.length}`,
  );
  if (r.errors.length) console.log(r.errors.slice(0, 3));
}
