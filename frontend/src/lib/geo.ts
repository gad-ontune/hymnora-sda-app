/**
 * The arithmetic behind "churches near me".
 *
 * Kept out of the map component and out of the page so it can be tested without a
 * browser: a distance is a fact about two points on a sphere, and a range filter
 * that quietly hides a church inside the range the user asked for is a bug the
 * map cannot show you.
 *
 * The radius is a real distance, not a zoom level. That distinction is the whole
 * point of the file — a map that "shows 2 km" by setting `zoom: 13` is really
 * saying whatever that zoom happens to cover at the equator, which is a different
 * number at every latitude, and badly wrong at the poles.
 */

export const EARTH_RADIUS_KM = 6371;

/** The ranges a reader may pick, in kilometres. */
export const RADIUS_CHOICES = [1, 2, 3, 4] as const;
export type RadiusKm = (typeof RADIUS_CHOICES)[number];
export const DEFAULT_RADIUS_KM: RadiusKm = 1;

export type LatLng = { lat: number; lng: number };

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres between two points. */
export function distanceKm(from: LatLng, to: LatLng): number {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isValidCoordinate(point: LatLng | null | undefined): point is LatLng {
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

/** `420 m` under a kilometre, `2.4 km` under a hundred, `313 km` above. */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/**
 * The latitude/longitude rectangle a radius cuts out around a centre.
 *
 * Used to fit the map: a 1 km circle and a 4 km circle are the same circle at
 * four different sizes, and the map has to shrink or grow to whichever the reader
 * picked. One degree of latitude is a constant 111.32 km; a degree of longitude
 * shrinks towards the poles by `cos(latitude)`, which is why a radius in km is
 * *not* a fixed number of degrees of longitude anywhere except the equator.
 */
export function radiusBounds(centre: LatLng, radiusKm: number): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const latDelta = radiusKm / 111.32;
  // Near the poles `cos(latitude)` collapses and a longitude "degree" covers no
  // ground at all, so dividing by it would be a division by ~0. The clamp keeps
  // the box finite: past about 89.5° a radius genuinely wraps the globe, and the
  // honest answer is "the whole world", not a number that goes to infinity.
  const cos = Math.max(0.0001, Math.cos(toRad(centre.lat)));
  const lngDelta = Math.min(180, radiusKm / (111.32 * cos));
  return {
    north: Math.min(90, centre.lat + latDelta),
    south: Math.max(-90, centre.lat - latDelta),
    east: Math.min(180, centre.lng + lngDelta),
    west: Math.max(-180, centre.lng - lngDelta),
  };
}

/**
 * The Google Maps zoom that frames `radiusKm` around `centre`.
 *
 * The offered ranges get consecutive zoom levels, one per choice. A logarithm
 * cannot do this: 1 km to 4 km is exactly two octaves, so rounding one out
 * lands 3 km and 4 km on the same level and the last step of the control does
 * nothing the reader can see. Handing each choice its own level is what makes
 * widening the range feel like a real distance rather than a label.
 *
 * Any other radius — the circle can be given one the control does not offer —
 * is interpolated between the levels that bracket it, so the mapping stays
 * continuous and monotonic outside the offered set.
 */
export function zoomForRadius(radiusKm: number): number {
  const smallest = RADIUS_CHOICES[0];
  const largest = RADIUS_CHOICES[RADIUS_CHOICES.length - 1];
  // The level that frames the tightest range, and one level per step wider.
  const tightestZoom = 15;
  const levelOf = (km: number) => tightestZoom - RADIUS_CHOICES.indexOf(km as RadiusKm);

  let zoom: number;
  const offered = RADIUS_CHOICES.find((km) => km === radiusKm);
  if (offered !== undefined) {
    zoom = levelOf(offered);
  } else if (radiusKm <= smallest) {
    zoom = tightestZoom;
  } else if (radiusKm >= largest) {
    // Past the widest choice, keep doubling the span per doubling of the
    // radius so an out-of-range circle is still framed rather than clipped.
    zoom = levelOf(largest) - Math.log2(radiusKm / largest);
  } else {
    // Between two offered choices, walk the levels in proportion.
    const lower = [...RADIUS_CHOICES].reverse().find((km) => km <= radiusKm) as number;
    const upper = RADIUS_CHOICES.find((km) => km >= radiusKm) as number;
    zoom = levelOf(lower) + (levelOf(upper) - levelOf(lower)) * ((radiusKm - lower) / (upper - lower));
  }

  return Math.max(2, Math.min(19, Math.floor(zoom)));
}

/** The circles and pins are plotted relative to this box. */
export type MapFit = { centre: LatLng; zoom: number; radiusKm: number };

export function fitToRadius(centre: LatLng, radiusKm: number): MapFit {
  return { centre, zoom: zoomForRadius(radiusKm), radiusKm };
}

/** Sorts nearest-first and keeps only what falls inside the radius. */
export function withinRadius<T extends LatLng>(
  centre: LatLng,
  radiusKm: number,
  points: readonly T[],
): (T & { distanceKm: number })[] {
  return points
    .filter((point) => isValidCoordinate(point))
    .map((point) => ({ ...point, distanceKm: distanceKm(centre, point) }))
    .filter((point) => point.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
