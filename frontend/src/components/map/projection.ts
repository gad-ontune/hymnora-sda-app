/**
 * The small amount of geometry the map needs.
 *
 * The map is deliberately not tied to a tile provider: these helpers turn
 * latitude/longitude into coordinates in a fixed viewBox, so panning and zooming
 * are just changes to one viewport value. Keeping the maths here makes the map
 * component about presentation, and makes the projection testable without a
 * browser or an API key.
 */

import { isValidCoordinate, type LatLng } from "@/lib/geo";

/** SVG units. HTML pins are placed as percentages of this same box. */
export const MAP_VIEW = { width: 1000, height: 620 } as const;

const KM_PER_DEG_LAT = 111.32;

export type MapViewport = {
  centre: LatLng;
  /** SVG units per kilometre, measured at the viewport centre. */
  pixelsPerKm: number;
};

type ViewportInput = {
  /** Where the reader is, or null while browsing the whole directory. */
  myLocation: LatLng | null;
  /** Fallback when there is no position and no church to fit around. */
  centre: LatLng;
  radiusKm: number;
  churches: readonly LatLng[];
  /** Multiplier from the map's own +/− controls. */
  zoom: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Degrees of longitude per kilometre shrink towards the poles. */
function kmPerDegreeLng(lat: number): number {
  // A clamp keeps the projection finite at the poles, where a longitude degree
  // covers almost no ground and dividing by cos(lat) would approach infinity.
  return KM_PER_DEG_LAT * Math.max(0.0001, Math.cos((lat * Math.PI) / 180));
}

/** Project a coordinate into the viewBox. */
export function project(point: LatLng, viewport: MapViewport) {
  return {
    x: MAP_VIEW.width / 2 + (point.lng - viewport.centre.lng) * kmPerDegreeLng(viewport.centre.lat) * viewport.pixelsPerKm,
    y: MAP_VIEW.height / 2 - (point.lat - viewport.centre.lat) * KM_PER_DEG_LAT * viewport.pixelsPerKm,
  };
}

/**
 * Move the viewport by a number of SVG units; positive x looks east, positive
 * y looks north. Returning a new viewport keeps every overlay (pins, radius and
 * the reader's position) on the same transform.
 */
export function shiftViewport(viewport: MapViewport, dx: number, dy: number): MapViewport {
  return {
    pixelsPerKm: viewport.pixelsPerKm,
    centre: {
      lat: clamp(
        viewport.centre.lat + dy / (KM_PER_DEG_LAT * viewport.pixelsPerKm),
        -85,
        85,
      ),
      lng: clamp(
        viewport.centre.lng + dx / (kmPerDegreeLng(viewport.centre.lat) * viewport.pixelsPerKm),
        -180,
        180,
      ),
    },
  };
}

/**
 * Once a position is known, the chosen radius is the subject of the map: a 1 km
 * circle and a 4 km circle need different scales. `sqrt` lets the circle grow
 * when the range widens without letting the largest range overwhelm the panel.
 *
 * Without a position the directory itself is the subject, so the viewport
 * frames every church that has a usable coordinate instead of showing an empty
 * neighbourhood around a guessed centre.
 */
export function viewportFor({ myLocation, centre, radiusKm, churches, zoom }: ViewportInput): MapViewport {
  if (isValidCoordinate(myLocation)) {
    return { centre: myLocation, pixelsPerKm: (150 / Math.sqrt(Math.max(1, radiusKm))) * zoom };
  }

  const points = churches.filter((point) => isValidCoordinate(point));
  if (points.length === 0) {
    return { centre: isValidCoordinate(centre) ? centre : { lat: 0, lng: 0 }, pixelsPerKm: 0.12 * zoom };
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const spanX = (Math.max(...lngs) - Math.min(...lngs)) * kmPerDegreeLng(midLat);
  const spanY = (Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG_LAT;
  const fitX = (MAP_VIEW.width * 0.66) / Math.max(spanX, 0.5);
  const fitY = (MAP_VIEW.height * 0.62) / Math.max(spanY, 0.5);

  return {
    centre: { lat: midLat, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
    pixelsPerKm: clamp(Math.min(fitX, fitY), 0.015, 40) * zoom,
  };
}
