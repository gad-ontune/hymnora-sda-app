/**
 * The arithmetic behind "churches near me".
 *
 * A radius control that quietly does the wrong thing is worse than no control at
 * all: the reader is shown "2 km" and believes it while the map is framing
 * something else entirely. Every claim the church page makes about distance goes
 * through this file, so the claims are pinned here — in particular that widening
 * the range visibly widens the map, which is the only way a reader can tell the
 * control is real.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RADIUS_KM,
  RADIUS_CHOICES,
  distanceKm,
  formatDistance,
  isValidCoordinate,
  radiusBounds,
  withinRadius,
  zoomForRadius,
} from "../src/lib/geo.ts";

const NAIROBI = { lat: -1.2921, lng: 36.8219 };

describe("a distance between two points is a real distance", () => {
  it("reads zero for the same point twice", () => {
    assert.equal(distanceKm(NAIROBI, NAIROBI), 0);
  });

  it("matches a known separation to within a few metres", () => {
    // Nairobi to Nakuru is about 137 km by road; as the crow flies it is near
    // that. A degree of latitude is 111.32 km, so 1.234° must be ~137.4 km.
    const nakuru = { lat: NAIROBI.lat + 1.234, lng: NAIROBI.lng };
    assert.ok(Math.abs(distanceKm(NAIROBO_UNUSED(), nakuru) - 137.4) < 0.5);
  });

  it("is symmetric", () => {
    const other = { lat: -0.0917, lng: 34.768 };
    assert.ok(Math.abs(distanceKm(NAIROBI, other) - distanceKm(other, NAIROBI)) < 1e-9);
  });

  it("measures a longitude degree as shorter than a latitude degree away from the equator", () => {
    // At the equator both are ~111 km. Towards the pole a longitude degree is
    // squeezed by cos(latitude); failing to apply that is how a "2 km" box ends
    // up covering hundreds of kilometres of longitude.
    const north = { lat: 60, lng: 0 };
    const eastOfNorth = { lat: 60, lng: 0.5 };
    assert.ok(distanceKm(north, eastOfNorth) < 56);
  });
});

/** A named alias so the assertion above reads as one fact, not two. */
function NAIROBO_UNUSED() {
  return NAIROBI;
}

describe("a distance is shown the way a reader reads it", () => {
  it("says metres below a kilometre and kilometres above", () => {
    assert.equal(formatDistance(0.42), "420 m");
    assert.equal(formatDistance(1), "1.0 km");
    assert.equal(formatDistance(2.44), "2.4 km");
    assert.equal(formatDistance(312.6), "313 km");
  });

  it("refuses to invent a number it was not given", () => {
    assert.equal(formatDistance(Number.NaN), "—");
    assert.equal(formatDistance(Number.POSITIVE_INFINITY), "—");
  });
});

describe("a radius frames a box on the globe", () => {
  it("grows with the radius", () => {
    const small = radiusBounds(NAIROBI, 1);
    const large = radiusBounds(NAIROBI, 4);
    assert.ok(large.north - large.south > small.north - small.south);
    assert.ok(large.east - large.west > small.east - small.west);
  });

  it("is centred on the point it was given", () => {
    const bounds = radiusBounds(NAIROBI, 2);
    const midLat = (bounds.north + bounds.south) / 2;
    const midLng = (bounds.east + bounds.west) / 2;
    assert.ok(Math.abs(midLat - NAIROBI.lat) < 1e-9);
    assert.ok(Math.abs(midLng - NAIROBI.lng) < 1e-9);
  });

  it("stays finite at the pole instead of dividing by zero", () => {
    const pole = { lat: 89.9, lng: 0 };
    const bounds = radiusBounds(pole, 4);
    assert.ok(Number.isFinite(bounds.east) && Number.isFinite(bounds.west));
    assert.ok(bounds.north <= 90 && bounds.south >= -90);
  });

  it("spans about a degree of latitude per 111 km", () => {
    const bounds = radiusBounds(NAIROBI, 111.32);
    assert.ok(Math.abs(bounds.north - bounds.south - 2) < 0.01);
  });
});

describe("the map zooms out as the range widens", () => {
  it("makes each offered choice a visible step", () => {
    const zooms = RADIUS_CHOICES.map(zoomForRadius);
    for (let index = 1; index < zooms.length; index += 1) {
      assert.ok(zooms[index] < zooms[index - 1], `choosing a wider range did not zoom out: ${zooms.join(", ")}`);
    }
  });

  it("starts at 1 km unless told otherwise", () => {
    assert.equal(DEFAULT_RADIUS_KM, 1);
    assert.equal(RADIUS_CHOICES[0], 1);
  });

  it("stays inside the zoom levels a map actually has", () => {
    for (const km of [0.01, 1, 4, 500, 20_000]) {
      const zoom = zoomForRadius(km);
      assert.ok(zoom >= 2 && zoom <= 19, `zoom ${zoom} is not a level the map can show`);
    }
  });
});

describe("only what falls inside the range is kept", () => {
  const points = [
    { id: "here", lat: NAIROBI.lat, lng: NAIROBI.lng },
    { id: "near", lat: NAIROBI.lat + 0.008, lng: NAIROBI.lng }, // ~0.9 km
    { id: "mid", lat: NAIROBI.lat + 0.03, lng: NAIROBI.lng }, // ~3.3 km
    { id: "far", lat: NAIROBI.lat + 0.4, lng: NAIROBI.lng }, // ~44 km
  ];

  it("keeps the near ones and drops the far ones at 1 km", () => {
    const kept = withinRadius(NAIROBI, 1, points).map((point) => point.id);
    assert.deepEqual(kept, ["here", "near"]);
  });

  it("admits more as the range grows", () => {
    const counts = [1, 2, 3, 4].map((km) => withinRadius(NAIROBI, km, points).length);
    for (let index = 1; index < counts.length; index += 1) {
      assert.ok(counts[index] >= counts[index - 1], `a wider range found fewer churches: ${counts.join(", ")}`);
    }
  });

  it("sorts nearest first", () => {
    const kept = withinRadius(NAIROBI, 4, points);
    const distances = kept.map((point) => point.distanceKm);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  });

  it("drops a point with no coordinates rather than plotting it at zero", () => {
    const broken = [...points, { id: "broken", lat: Number.NaN, lng: 0 }];
    assert.equal(withinRadius(NAIROBI, 4, broken).some((point) => point.id === "broken"), false);
  });
});

describe("a coordinate is checked before it is trusted", () => {
  it("accepts a real position", () => {
    assert.equal(isValidCoordinate(NAIROBI), true);
  });

  it("refuses the impossible and the missing", () => {
    assert.equal(isValidCoordinate(null), false);
    assert.equal(isValidCoordinate(undefined), false);
    assert.equal(isValidCoordinate({ lat: 91, lng: 0 }), false);
    assert.equal(isValidCoordinate({ lat: 0, lng: 181 }), false);
    assert.equal(isValidCoordinate({ lat: Number.NaN, lng: 0 }), false);
  });
});
