"use client";

import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Locate,
  MapPin,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { distanceKm, formatDistance, isValidCoordinate, type LatLng, type RadiusKm } from "@/lib/geo";
import type { Church } from "@/lib/types";
import { MAP_VIEW, project, shiftViewport, viewportFor } from "./projection";

/** Where the map looks before the reader has shared a location. */
export const FALLBACK_CENTRE: LatLng = { lat: -1.2921, lng: 36.8219 };

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.3;
const PAN_STEP = 90;

const clampPercent = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The directory names its fields `latitude`/`longitude`; the map works in `lat`/`lng`. */
function coordinatesOf(church: Church): LatLng | null {
  const point = { lat: church.latitude, lng: church.longitude };
  return isValidCoordinate(point) ? point : null;
}

type ChurchMapProps = {
  churches: Church[];
  centre: LatLng;
  radiusKm: RadiusKm;
  /** The reader's own position, once they have shared it. */
  myLocation: LatLng | null;
  selectedChurch: Church | null;
  /** `null` when the reader dismisses the map's preview card. */
  onSelectChurch: (church: Church | null) => void;
  /** Omitted in fullscreen, where the Back button replaces it. */
  onOpenFullscreen?: () => void;
  className?: string;
};

/**
 * A self-contained map: a gridded SVG surface with HTML pins plotted from
 * latitude/longitude. There is no tile layer, script loader or API key, so this
 * component makes no network request and cannot fail because a key is missing.
 */
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
  // Pattern ids must be unique when the inline and fullscreen maps coexist.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [popup, setPopup] = useState<{ id: string | null; dismissed: boolean }>({ id: null, dismissed: false });
  const drag = useRef<{ clientX: number; clientY: number; width: number; height: number } | null>(null);

  // Primitives as dependencies: the page rebuilds `centre` on every render.
  const centreLat = centre.lat;
  const centreLng = centre.lng;
  const myLat = isValidCoordinate(myLocation) ? myLocation.lat : null;
  const myLng = isValidCoordinate(myLocation) ? myLocation.lng : null;
  const myPointForDistance = myLat !== null && myLng !== null ? { lat: myLat, lng: myLng } : null;
  const fitKey = `${centreLat}:${centreLng}:${radiusKm}:${myLat}:${myLng}`;

  // A real change of search refocuses the map; a mere re-render does not fight
  // the reader's own panning. Adjusting during render keeps the refocus in the
  // same paint as the radius change.
  const [previousFit, setPreviousFit] = useState(fitKey);
  if (fitKey !== previousFit) {
    setPreviousFit(fitKey);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }

  const base = useMemo(
    () =>
      viewportFor({
        centre: { lat: centreLat, lng: centreLng },
        myLocation: myLat !== null && myLng !== null ? { lat: myLat, lng: myLng } : null,
        radiusKm,
        churches: churches.map(coordinatesOf).filter((point): point is LatLng => point !== null),
        zoom,
      }),
    [centreLat, centreLng, myLat, myLng, radiusKm, churches, zoom],
  );
  const viewport = useMemo(() => shiftViewport(base, pan.x, pan.y), [base, pan.x, pan.y]);

  const plotted = useMemo(
    () =>
      churches
        .map((church) => ({ church, coordinates: coordinatesOf(church) }))
        .filter((entry): entry is { church: Church; coordinates: LatLng } => entry.coordinates !== null)
        .map(({ church, coordinates }) => ({ church, point: project(coordinates, viewport) }))
        .filter(
          ({ point }) =>
            point.x >= -80 && point.x <= MAP_VIEW.width + 80 && point.y >= -80 && point.y <= MAP_VIEW.height + 80,
        ),
    [churches, viewport],
  );

  const myPoint = myPointForDistance ? project(myPointForDistance, viewport) : null;
  const selectedCoordinates = selectedChurch ? coordinatesOf(selectedChurch) : null;
  const selectedPoint = selectedCoordinates ? project(selectedCoordinates, viewport) : null;
  const selectedId = selectedChurch?.id ?? null;

  // Dismissing the preview must not change the page's selection: the detail
  // panel stays with the chosen church, only the little card closes.
  if (popup.id !== selectedId) setPopup({ id: selectedId, dismissed: false });
  const showPopup = selectedId !== null && !popup.dismissed && selectedPoint !== null;

  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  /**
   * Drag support, guarded end to end: `currentTarget` is checked as an Element
   * before any DOM call, and a zero-sized box never becomes a divisor. No
   * IntersectionObserver or ResizeObserver is involved, so there is no null
   * observer target to leak into a React effect.
   */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!(event.currentTarget instanceof Element)) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    drag.current = { clientX: event.clientX, clientY: event.clientY, width: rect.width, height: rect.height };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = ((event.clientX - start.clientX) / start.width) * MAP_VIEW.width;
    const dy = ((event.clientY - start.clientY) / start.height) * MAP_VIEW.height;
    setPan({ x: -dx, y: dy });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (
      event.currentTarget instanceof Element &&
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="region"
      aria-label="Interactive church map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`relative isolate cursor-grab overflow-hidden rounded-[24px] border border-line bg-surface shadow-soft active:cursor-grabbing ${className}`}
    >
      <svg
        viewBox={`0 0 ${MAP_VIEW.width} ${MAP_VIEW.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full"
      >
        <defs>
          <pattern id={`${uid}-minor`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--line)" strokeWidth="1" opacity="0.4" />
          </pattern>
          <pattern id={`${uid}-major`} width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 200 0 L 0 0 0 200" fill="none" stroke="var(--line)" strokeWidth="1.5" opacity="0.65" />
          </pattern>
          <radialGradient id={`${uid}-glow`} cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="var(--surface)" />
            <stop offset="100%" stopColor="var(--canvas)" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${uid}-glow)`} />
        <rect width="100%" height="100%" fill={`url(#${uid}-minor)`} />
        <rect width="100%" height="100%" fill={`url(#${uid}-major)`} />
        {/* Soft contour lines suggest terrain without pretending to be street data. */}
        <g fill="none" stroke="var(--line)" strokeWidth="1.5" opacity="0.5">
          <path d="M -60 120 C 150 60 260 220 470 150 S 810 80 1060 150" />
          <path d="M -60 250 C 180 190 320 330 520 260 S 860 190 1060 270" />
          <path d="M -60 400 C 160 350 300 470 520 410 S 840 350 1060 420" />
          <path d="M -60 540 C 190 490 340 590 560 530 S 880 480 1060 540" />
        </g>
      </svg>

      {/*
        The radius is an HTML circle rather than an SVG one: `aspect-square`
        keeps it genuinely round even though the SVG grid stretches to fill the
        panel. Its size is a percentage of the same viewBox the pins use.
      */}
      {myPoint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[5] aspect-square rounded-full border border-dashed border-sage/60 bg-sage-soft/30"
          style={{
            left: `${(myPoint.x / MAP_VIEW.width) * 100}%`,
            top: `${(myPoint.y / MAP_VIEW.height) * 100}%`,
            width: `${(radiusKm * viewport.pixelsPerKm * 100) / MAP_VIEW.width}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ) : null}

      {myPoint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{
            left: `${(myPoint.x / MAP_VIEW.width) * 100}%`,
            top: `${(myPoint.y / MAP_VIEW.height) * 100}%`,
          }}
        >
          <span className="absolute size-5 animate-ping rounded-full bg-terracotta/25" />
          <span className="relative size-3 rounded-full border-2 border-white bg-terracotta shadow-lift" />
        </div>
      ) : null}

      {plotted.map(({ church, point }) => {
        const isSelected = church.id === selectedId;
        return (
          <button
            key={church.id}
            type="button"
            aria-label={`Show ${church.name}`}
            aria-pressed={isSelected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setPopup({ id: church.id, dismissed: false });
              onSelectChurch(church);
            }}
            className="absolute z-20 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 transition-transform hover:z-30 hover:scale-105 focus-visible:z-30 focus-visible:outline-none"
            style={{
              left: `${(point.x / MAP_VIEW.width) * 100}%`,
              top: `${(point.y / MAP_VIEW.height) * 100}%`,
            }}
          >
            <span
              className={`grid size-8 place-items-center rounded-full border-2 border-surface shadow-lift ${
                isSelected ? "scale-110 bg-sage text-white ring-4 ring-sage/25" : "bg-gold text-white"
              }`}
            >
              <MapPin size={16} />
            </span>
            <span
              className={`max-w-[9rem] truncate rounded-lg px-2 py-1 text-[10px] font-bold shadow-soft ${
                isSelected ? "bg-ink-fill text-white" : "bg-surface/95 text-ink"
              }`}
            >
              {church.name}
            </span>
          </button>
        );
      })}

      {showPopup && selectedChurch ? (
        <div
          className="absolute z-40 w-[15rem] rounded-2xl border border-line bg-surface/95 p-3.5 shadow-lift backdrop-blur"
          style={{
            left: `${clampPercent((selectedPoint.x / MAP_VIEW.width) * 100, 14, 84)}%`,
            top: `${clampPercent((selectedPoint.y / MAP_VIEW.height) * 100 + 6, 8, 74)}%`,
            transform: "translate(-50%, 0)",
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-ink">{selectedChurch.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted">
                <MapPin size={11} className="shrink-0 text-sage" /> {selectedChurch.location}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close church preview"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setPopup({ id: selectedId, dismissed: true })}
              className="grid size-6 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-soft hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
          <p className="mt-2 border-t border-line pt-2 text-[11px] font-semibold text-ink-soft">{selectedChurch.service}</p>
          {myPointForDistance && selectedCoordinates ? (
            <p className="mt-1 text-[10px] text-ink-muted">
              {formatDistance(distanceKm(myPointForDistance, selectedCoordinates))} from you
            </p>
          ) : null}
        </div>
      ) : null}

      {plotted.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[15] grid place-items-center p-6">
          <span className="inline-flex max-w-[16rem] flex-col items-center gap-2 rounded-2xl border border-line bg-surface/95 px-5 py-4 text-center text-sm text-ink-muted shadow-soft">
            <MapPin size={17} className="text-sage" />
            No churches to plot in this view. Widen the range or clear your filters.
          </span>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-soft backdrop-blur">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Church map</p>
          <p className="mt-0.5 text-xs font-semibold text-ink">
            {plotted.length} {plotted.length === 1 ? "church" : "churches"} plotted
          </p>
        </div>
        {onOpenFullscreen ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onOpenFullscreen}
            className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface/95 px-3 text-xs font-semibold text-ink shadow-soft backdrop-blur transition hover:border-sage/50"
          >
            <Maximize2 size={14} /> Open map
          </button>
        ) : null}
      </div>

      <div className="absolute bottom-3 right-3 z-30 flex flex-col items-end gap-2">
        <div className="grid grid-cols-3 gap-0.5 rounded-xl border border-line bg-surface/95 p-1 shadow-soft backdrop-blur">
          <span />
          <MapControl label="Pan north" onClick={() => setPan((current) => ({ ...current, y: current.y + PAN_STEP }))}>
            <ChevronUp size={15} />
          </MapControl>
          <span />
          <MapControl label="Pan west" onClick={() => setPan((current) => ({ ...current, x: current.x - PAN_STEP }))}>
            <ChevronLeft size={15} />
          </MapControl>
          <MapControl label="Recentre map" onClick={resetView}>
            <Crosshair size={14} />
          </MapControl>
          <MapControl label="Pan east" onClick={() => setPan((current) => ({ ...current, x: current.x + PAN_STEP }))}>
            <ChevronRight size={15} />
          </MapControl>
          <span />
          <MapControl label="Pan south" onClick={() => setPan((current) => ({ ...current, y: current.y - PAN_STEP }))}>
            <ChevronDown size={15} />
          </MapControl>
          <span />
        </div>
        <div className="flex gap-0.5 rounded-xl border border-line bg-surface/95 p-1 shadow-soft backdrop-blur">
          <MapControl
            label="Zoom in"
            onClick={() => setZoom((current) => Math.min(ZOOM_MAX, current * ZOOM_STEP))}
          >
            <Plus size={15} />
          </MapControl>
          <MapControl
            label="Zoom out"
            onClick={() => setZoom((current) => Math.max(ZOOM_MIN, current / ZOOM_STEP))}
          >
            <Minus size={15} />
          </MapControl>
        </div>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 z-30 max-w-[15rem] rounded-xl border border-line bg-surface/95 px-3 py-2 text-[11px] leading-4 text-ink-muted shadow-soft backdrop-blur">
        <Locate size={12} className="mr-1 inline text-sage" />
        {myPoint
          ? `Search area · ${radiusKm} km radius`
          : "Drag to explore · tap a pin for details"}
      </p>
    </div>
  );
}

function MapControl({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
    >
      {children}
    </button>
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
          className="h-full rounded-none border-0 shadow-none"
        />
      </div>
    </div>
  );
}
