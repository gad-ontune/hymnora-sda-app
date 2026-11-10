"use client";

import { useMemo, useState } from "react";
import { Locate, MapPin, Maximize2, X } from "lucide-react";
import { GoogleMap, useJsApiLoader, Marker, Circle, InfoWindow } from "@react-google-maps/api";
import type { Church } from "@/lib/types";
import { fitToRadius, isValidCoordinate, type LatLng, type RadiusKm } from "@/lib/geo";

/** Where the map looks before the reader has shared a location. */
export const FALLBACK_CENTRE: LatLng = { lat: -1.2921, lng: 36.8219 };

/**
 * One loader id for every map in the app.
 *
 * `LoadScript` deletes `window.google` and the script tag when it unmounts, then
 * injects a fresh one on the next mount. With two maps on this page (inline and
 * fullscreen) that happens while the other map is still alive: Google's script
 * re-registers its custom elements and React's DOM bookkeeping is left pointing
 * at nodes the script replaced. The result is an uncaught `insertBefore` /
 * `removeChild` error and the next client-side navigation crashes.
 *
 * `useJsApiLoader` shares one loader for the whole page and keeps it alive after
 * unmount, so navigating away from Churches and back does not reload the script.
 */
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const GOOGLE_MAPS_LOADER_ID = "hymnora-google-maps";

/**
 * Paints in the app's own palette so the map is part of the page rather than a
 * satellite photo pasted onto it. The road hierarchy is kept — a map with no
 * roads is a picture of a map.
 */
const mapStyles = [
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e8e0ce" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f4efe4" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#d9cfbb" }, { weight: 1 }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#b68935" }, { visibility: "simplified" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#d9cfbb" }] },
  { featureType: "administrative", elementType: "labels.text.fill", stylers: [{ color: "#4b473d" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#4b473d" }] },
];

/** Gold for a church, sage for the one picked, terracotta for the reader. */
const pinSvg = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${fill}" stroke="#1f1e19" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#1f1e19"/></svg>`,
  )}`;

const ME_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#a34a32" stroke="#ffffff" stroke-width="3"/></svg>`,
  );

type ChurchMapProps = {
  churches: Church[];
  centre: LatLng;
  radiusKm: RadiusKm;
  /** The reader's own position, once they have shared it. */
  myLocation: LatLng | null;
  selectedChurch: Church | null;
  /** `null` when the reader dismisses the map's info window. */
  onSelectChurch: (church: Church | null) => void;
  /** Opens the map over the whole screen. */
  onOpenFullscreen: () => void;
  className?: string;
};

export function ChurchMap({
  churches,
  centre,
  radiusKm,
  myLocation,
  selectedChurch,
  onSelectChurch,
  onOpenFullscreen,
  className = "h-[320px] sm:h-[380px]",
}: ChurchMapProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  /**
   * The map is told to re-centre when the *fit* changes, not when the centre
   * object does: `centre` is rebuilt on every render, and a map that pans on
   * every render fights the reader the moment they try to drag it away from
   * their own position. `fitToRadius` collapses the pair into a comparable value
   * that only moves when the radius or the location really changed. The
   * lat/lng are pulled out first so the memo depends on primitives, not the
   * freshly-built centre object.
   */
  const centreLat = centre.lat;
  const centreLng = centre.lng;
  const fit = useMemo(() => fitToRadius({ lat: centreLat, lng: centreLng }, radiusKm), [centreLat, centreLng, radiusKm]);
  /**
   * The fit is applied as a state adjustment during render (guarded by the
   * previous value) rather than an effect: the map must move in the same paint
   * that the range changes, and a render-time adjustment avoids the extra
   * visible frame an effect's setState would produce.
   */
  const [view, setView] = useState(fit);
  const [previousFit, setPreviousFit] = useState(fit);
  if (fit !== previousFit) {
    setPreviousFit(fit);
    setView(fit);
  }

  const centrePoint = isValidCoordinate(myLocation) ? myLocation : centre;
  const plotted = churches.filter((church) => Number.isFinite(church.latitude) && Number.isFinite(church.longitude));

  return (
    <div className={`relative overflow-hidden rounded-[24px] border border-line bg-surface shadow-soft ${className}`}>
      <div className="absolute inset-0">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={{ width: "100%", height: "100%" }}
            center={view.centre}
            zoom={view.zoom}
            onIdle={() => undefined}
            options={{
              styles: mapStyles,
              disableDefaultUI: true,
              zoomControl: true,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
              // Scroll-zoom off so a reader scrolling the page over the map does
              // not get trapped in it; the ± control and pinch still work.
              scrollwheel: false,
              clickableIcons: false,
            }}
          >
            {/*
              The radius the reader chose, drawn. Without it a "2 km" label is a
              claim the reader has to take on trust; with it the claim is visible,
              and changing the range visibly redraws the circle.
            */}
            <Circle
              center={centrePoint}
              radius={radiusKm * 1000}
              options={{
                fillColor: "#49624c",
                fillOpacity: 0.08,
                strokeColor: "#49624c",
                strokeOpacity: 0.55,
                strokeWeight: 1.5,
                clickable: false,
              }}
            />

            {isValidCoordinate(myLocation) ? (
              <Marker
                position={myLocation}
                title="Your location"
                zIndex={20}
                icon={{ url: ME_SVG, scaledSize: new window.google.maps.Size(22, 22), anchor: new window.google.maps.Point(11, 11) }}
              />
            ) : null}

            {plotted.map((church) => (
              <Marker
                key={church.id}
                position={{ lat: church.latitude, lng: church.longitude }}
                title={church.name}
                zIndex={selectedChurch?.id === church.id ? 15 : 10}
                onClick={() => onSelectChurch(church)}
                icon={{
                  url: pinSvg(selectedChurch?.id === church.id ? "#49624c" : "#b68935"),
                  scaledSize: new window.google.maps.Size(selectedChurch?.id === church.id ? 34 : 26, selectedChurch?.id === church.id ? 34 : 26),
                  anchor: new window.google.maps.Point(
                    (selectedChurch?.id === church.id ? 34 : 26) / 2,
                    (selectedChurch?.id === church.id ? 34 : 26) / 2,
                  ),
                }}
              />
            ))}

            {selectedChurch &&
            Number.isFinite(selectedChurch.latitude) &&
            Number.isFinite(selectedChurch.longitude) ? (
              <InfoWindow
                position={{ lat: selectedChurch.latitude, lng: selectedChurch.longitude }}
                onCloseClick={() => onSelectChurch(null)}
                options={{ maxWidth: 240 }}
              >
                <div className="font-sans p-1 text-ink">
                  <p className="font-display text-sm font-semibold">{selectedChurch.name}</p>
                  <p className="text-xs text-ink-muted">{selectedChurch.location}</p>
                  <p className="text-xs text-ink-muted">{selectedChurch.service}</p>
                </div>
              </InfoWindow>
            ) : null}
          </GoogleMap>
        ) : null}
      </div>

      {/*
        The fullscreen button and its Back button live here rather than inside
        the Google map, so they keep the app's own styling and stay above the
        map's own controls.
      */}
      <button
        type="button"
        onClick={onOpenFullscreen}
        className="absolute right-3 top-3 z-10 inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface/95 px-3 text-xs font-semibold text-ink shadow-soft backdrop-blur transition hover:border-sage/50"
      >
        <Maximize2 size={14} /> Open map
      </button>

      {loadError ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface/90 p-6 text-center text-sm text-ink-muted">
          <span className="inline-flex max-w-[18rem] flex-col items-center gap-2">
            <MapPin size={17} className="text-sage" />
            The map could not be loaded right now. You can still browse the churches in the list.
          </span>
        </div>
      ) : !isLoaded ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-surface/80 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-2">
            <MapPin size={15} className="animate-pulse" /> Loading the map…
          </span>
        </div>
      ) : null}

      {!isValidCoordinate(myLocation) ? (
        <p className="absolute bottom-3 left-3 z-10 max-w-[16rem] rounded-xl border border-line bg-surface/95 px-3 py-2 text-[11px] leading-4 text-ink-muted shadow-soft backdrop-blur">
          <Locate size={12} className="mr-1 inline text-sage" />
          Showing Nairobi. Use “My location” to search around you.
        </p>
      ) : null}
    </div>
  );
}

/** The same map at full height, with a Back button that returns to the page. */
export function ChurchMapFullscreen({
  churches,
  centre,
  radiusKm,
  myLocation,
  selectedChurch,
  onSelectChurch,
  onBack,
}: Omit<ChurchMapProps, "onOpenFullscreen" | "className"> & { onBack: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-canvas">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-canvas px-4 text-sm font-semibold text-ink transition hover:border-sage/50"
        >
          <X size={16} /> Back
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-ink">
          {selectedChurch ? selectedChurch.name : `Churches within ${radiusKm} km`}
        </p>
        <span className="w-[5.5rem]" />
      </div>
      <div className="min-h-0 flex-1">
        <ChurchMap
          churches={churches}
          centre={centre}
          radiusKm={radiusKm}
          myLocation={myLocation}
          selectedChurch={selectedChurch}
          onSelectChurch={onSelectChurch}
          onOpenFullscreen={() => undefined}
          className="h-full rounded-none border-0 shadow-none"
        />
      </div>
    </div>
  );
}
