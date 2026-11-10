/**
 * The WHERE clause the music catalogue is browsed with.
 *
 * Every one of these assertions covers a way this got quietly wrong rather than
 * loudly: the endpoint 500'd on every request, and the only symptom was a log
 * line nobody reads. A clause list that drops its first entry, or a placeholder
 * with no binding behind it, both fail at the database and not before.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBrowseFilter } from "../src/modules/music/service.ts";

/** Counts the `?` placeholders, so a clause can be checked against its bindings. */
function placeholders(where: string): number {
  return [...where.matchAll(/\?/g)].length;
}

describe("buildBrowseFilter", () => {
  it("contributes nothing at all when there is no filter", () => {
    const { where, params } = buildBrowseFilter({});
    // A bare `AND` here is what produced `AND ORDER BY` and a syntax error.
    assert.equal(where, "");
    assert.deepEqual(params, []);
  });

  it("keeps a single filter instead of discarding it", () => {
    const { where, params } = buildBrowseFilter({ category: "choirs" });
    assert.equal(where, "AND sub_category = ?");
    assert.deepEqual(params, ["choirs"]);
  });

  it("keeps every filter when more than one is given", () => {
    const { where, params } = buildBrowseFilter({ region: "east-africa", category: "hymns" });
    assert.equal(where, "AND region = ? AND sub_category = ?");
    assert.deepEqual(params, ["east-africa", "hymns"]);
  });

  it("binds one value per placeholder, always", () => {
    // A missing binding is not a syntax error at the database, it is a wrong
    // answer or a runtime failure, so the counts are compared rather than assumed.
    for (const filter of [
      {},
      { category: "choirs" },
      { region: "east-africa" },
      { region: "east-africa", category: "hymns" },
      { q: "jesus" },
      { region: "east-africa", category: "hymns", q: "jesus" },
    ]) {
      const { where, params } = buildBrowseFilter(filter);
      assert.equal(
        placeholders(where),
        params.length,
        `placeholder/binding mismatch for ${JSON.stringify(filter)}: ${where}`,
      );
    }
  });

  it("searches title, artist and tags, case-insensitively", () => {
    const { where, params } = buildBrowseFilter({ q: "Nyimbo Za Kristo" });
    assert.equal(where, "AND (lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(tags) LIKE ?)");
    assert.equal(params.length, 3);
    // The same lowercased needle in all three positions, not the raw query.
    assert.deepEqual(params, ["%nyimbo za kristo%", "%nyimbo za kristo%", "%nyimbo za kristo%"]);
  });

  it("ignores an empty filter rather than matching on an empty string", () => {
    assert.equal(buildBrowseFilter({ category: "" }).where, "");
    assert.equal(buildBrowseFilter({ region: "" }).where, "");
    assert.equal(buildBrowseFilter({ q: "" }).where, "");
  });

  it("never emits a clause that is not preceded by AND", () => {
    for (const filter of [
      { category: "choirs" },
      { region: "east-africa" },
      { region: "east-africa", category: "hymns", q: "a" },
    ]) {
      const { where } = buildBrowseFilter(filter);
      for (const clause of where.split("AND").filter((part) => part.trim())) {
        assert.match(clause, /^\s*[a-z(]/, `clause is not a condition: "${clause}"`);
      }
    }
  });
});
