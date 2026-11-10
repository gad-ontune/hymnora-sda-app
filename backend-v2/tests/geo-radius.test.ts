/**
 * A radius search, which is what "churches near me" runs on.
 *
 * Two faults lived here and neither threw. The column splitter tore the computed
 * distance expression apart at its own inner commas, which SQLite rejected as
 * `near ","` — a loud failure, but only on the one route that used it. The
 * bounding box was divided by the wrong constant, so the searched area was a
 * fraction of the radius requested and churches inside the range were silently
 * left out: a quiet wrong answer, which is worse. A distance search that returns
 * a plausible-looking list of the wrong churches is indistinguishable from one
 * that works, so both are pinned here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { all, run, get } from "../src/db/client.ts";
import { distanceKm, radiusFilter, formatDistance } from "../src/lib/geo.ts";
import { selectList } from "../src/lib/sql.ts";

/** Counts rows matching a `WHERE` fragment against the real churches table. */
function countNear(sql: string, params: (number | string)[]): number {
  const row = get<{ total: number }>(`SELECT COUNT(*) AS total FROM churches c WHERE c.deleted_at IS NULL AND c.is_active = 1 AND ${sql}`, params);
  return Number(row?.total ?? 0);
}

describe("a column list keeps a computed expression whole", () => {
  it("does not split at the commas inside a nested call", () => {
    const expression = "(6371 * 2 * asin(sqrt(pow(sin(radians((-1.2 - c.latitude) / 2)), 2) + cos(radians(-1.2)) * cos(radians(c.latitude)) * pow(sin(radians((36.8 - c.longitude) / 2)), 2)))) AS distance_km";
    const built = selectList(`c.id, c.name,\n        ${expression}`);
    // The expression must survive intact, commas and all.
    assert.match(built, /asin\(sqrt\(pow\(/);
    assert.match(built, /\) AS distance_km/);
    // And the statement has to actually parse — the fault only showed at runtime.
    const rows = all(`${built} FROM churches c WHERE c.deleted_at IS NULL LIMIT 1`, []);
    assert.ok(Array.isArray(rows));
  });

  it("still splits plain column lists on their own commas", () => {
    assert.equal(selectList("c.id, c.name, c.city"), "SELECT c.id, c.name, c.city");
    assert.equal(selectList("\n  c.id,\n  c.name\n"), "SELECT c.id, c.name");
  });

  it("leaves a comma inside a quoted string alone", () => {
    assert.equal(selectList("c.name, 'a, b' AS tag"), "SELECT c.name, 'a, b' AS tag");
  });
});

describe("a radius search finds what falls inside the radius", () => {
  // Central Nairobi, where the seeded church sits. It must be found at 1 km,
  // 2 km, 3 km and 4 km. Named `latitude`/`longitude` because that is what
  // `distanceKm` reads — a `{ lat, lng }` here silently yields `NaN` and makes
  // every comparison false, which looks like an empty result rather than a typo.
  const CENTRE = { latitude: -1.2921, longitude: 36.8219 };
  const boxAt = (km: number) => radiusFilter(CENTRE.latitude, CENTRE.longitude, km);

  it("finds a church well inside a 1 km request", () => {
    const box = boxAt(1);
    assert.ok(countNear(box.sql, box.params) > 0, "a 1 km box around central Nairobi returned nothing");
  });

  it("widens monotonically as the radius grows", () => {
    const counts = [1, 2, 3, 4, 10].map((km) => {
      const box = boxAt(km);
      return countNear(box.sql, box.params);
    });
    for (let index = 1; index < counts.length; index += 1) {
      assert.ok(counts[index] >= counts[index - 1], `a wider radius found fewer churches: ${counts.join(", ")}`);
    }
  });

  it("reaches at least as far as the true great-circle distance says", () => {
    // The box is an equirectangular approximation, so it is allowed to be loose —
    // but never short. A 4 km request must not exclude a church the haversine
    // distance puts inside 4 km, which is exactly what the old constant did.
    const box = boxAt(4);
    const sql = `${selectList("c.id, c.latitude, c.longitude")} FROM churches c WHERE c.deleted_at IS NULL AND c.is_active = 1`;
    const inside = all<{ id: string; latitude: number; longitude: number }>(sql, []).filter(
      (church) => distanceKm(CENTRE, church) <= 4,
    );
    assert.ok(inside.length > 0, "no church is within 4 km of the centre in this dataset");
    for (const church of inside) {
      const found = get<{ id: string }>(
        `SELECT c.id FROM churches c WHERE c.id = ? AND ${box.sql}`,
        [church.id, ...box.params],
      );
      assert.ok(found, `${church.id} is ${distanceKm(CENTRE, church).toFixed(2)} km away but a 4 km box excluded it`);
    }
  });

  it("keeps out what is genuinely beyond the radius", () => {
    // The other seeded churches are 137 km and further out, so a 4 km box around
    // central Nairobi must not sweep them in.
    const box = boxAt(4);
    const count = countNear(box.sql, box.params);
    const total = get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM churches c WHERE c.deleted_at IS NULL AND c.is_active = 1",
    );
    assert.ok(count < Number(total?.total ?? 0), "a 4 km box returned every church in the country");
  });
});

describe("a distance is shown the way a reader reads it", () => {
  it("says metres below a kilometre and kilometres above", () => {
    assert.equal(formatDistance(0.42), "420 m");
    assert.equal(formatDistance(2.44), "2.4 km");
    assert.equal(formatDistance(312.6), "313 km");
  });

  it("refuses to invent a number it was not given", () => {
    assert.equal(formatDistance(Number.NaN), "—");
  });
});
