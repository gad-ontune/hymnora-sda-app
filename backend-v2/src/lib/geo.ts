const EARTH_RADIUS_KM = 6371;

export type LatLng = { latitude: number; longitude: number };

/** Great-circle distance in kilometres. */
export function distanceKm(from: LatLng, to: LatLng): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Kilometres per degree of latitude — the scale factor that turns the degrees in
 * this file's equirectangular approximation into a distance.
 *
 * The expression below compares squared *degrees* against a squared *radius in
 * kilometres*, so it has to be divided by this squared. Dividing by anything
 * else — Earth's circumference, as it once did — shrinks the searched box to a
 * fraction of the radius asked for, and the church a user requested "within 3
 * km" is then quietly left out of the results.
 */
const KM_PER_DEGREE = 111.32;

/** Formats a distance the way the frontend shows it: `2.4 km`, `312 km`, `1,204 km`. */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/** Builds a SQL snippet for radius filtering plus a computed `distance_km` column. */
export function radiusFilter(lat: number, lng: number, radiusKm: number): { sql: string; params: (number | string)[] } {
  const sql = `((? - latitude) * (? - latitude) + ((? - longitude) * cos(radians(?)) * (? - longitude) * cos(radians(?))))`;
  return {
    // Squared degrees on the left, squared kilometres on the right: the scale
    // factor between them is (km per degree)², and it has to be applied in full
    // or the box is smaller than the radius the caller asked for.
    sql: `(${sql}) <= (? * ? / ${KM_PER_DEGREE * KM_PER_DEGREE})`,
    params: [lat, lat, lng, lat, lng, lat, radiusKm, radiusKm],
  };
}
