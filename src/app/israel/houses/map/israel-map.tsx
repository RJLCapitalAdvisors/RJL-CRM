"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type * as Leaflet from "leaflet";
import { Circle as CircleIcon, MousePointer2, Hand, X, ExternalLink } from "lucide-react";
import type { MapUnit } from "@/lib/il-map";

const MAX_COMPARE = 5;
const nis = (n: number | null | undefined) => (n == null ? "" : `₪${Math.round(n).toLocaleString("en-US")}`);
const sqm = (n: number | null | undefined) => (n == null ? "" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} m²`);
const KIND: Record<MapUnit["kind"], string> = { apartments: "Apartment", houses: "House", projects: "Project" };
const COLOR: Record<MapUnit["kind"], string> = { apartments: "#1d4ed8", houses: "#047857", projects: "#7c3aed" };

type Tool = "pan" | "circle" | "pick";

/** One pin per place: the units that share a location are grouped so a building with several apartments is one pin with a count. */
function groupByPlace(units: MapUnit[]) {
  const m = new Map<string, MapUnit[]>();
  for (const u of units) {
    const k = `${u.lat.toFixed(5)},${u.lng.toFixed(5)}`;
    m.set(k, [...(m.get(k) ?? []), u]);
  }
  return [...m.values()];
}

const popupHtml = (group: MapUnit[]) =>
  `<div style="min-width:220px;font:12px/1.4 system-ui">` +
  group
    .map(
      (u) =>
        `<div style="padding:4px 0;border-bottom:1px solid #eee"><a href="${u.href}" style="font-weight:600;color:#1d4ed8;text-decoration:none">${u.name.replace(/</g, "&lt;")}</a> <span style="color:#666">${KIND[u.kind]}</span>` +
        (u.kind === "projects"
          ? `<div style="color:#444">${[u.street, u.neighborhood, u.city].filter(Boolean).join(", ")}</div>`
          : `<div style="color:#444">${[u.internalSqm != null ? `${sqm(u.internalSqm)} internal` : null, u.mirpesetSqm != null ? `${sqm(u.mirpesetSqm)} mirpeset` : null, u.ppm != null ? `${nis(u.ppm)} / m²` : null].filter(Boolean).join(" · ") || "sizes not on the ticket"}</div>`) +
        `</div>`,
    )
    .join("") +
  `</div>`;

/**
 * The map itself (Leaflet on OpenStreetMap's own tiles, no key needed; a Google Maps key would let the base map switch). Pins group the
 * units at one address; hovering shows each unit's internal size, mirpeset size and price per metre. The toolbar on
 * the right: pan, circle an area (press and drag) to list every unit inside, or pick pins to compare. The panel under
 * the toolbar holds the list; tick up to five of one kind and open the side-by-side comparer.
 */
export function IsraelMap({ units }: { units: MapUnit[] }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const circleRef = useRef<Leaflet.Circle | null>(null);
  const toolRef = useRef<Tool>("pan");
  const [tool, setToolState] = useState<Tool>("pan");
  const [inCircle, setInCircle] = useState<MapUnit[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const groups = useMemo(() => groupByPlace(units), [units]);
  const byId = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units]);
  const setTool = (t: Tool) => {
    toolRef.current = t;
    setToolState(t);
    const map = mapRef.current;
    if (map) {
      if (t === "circle") map.dragging.disable();
      else map.dragging.enable();
      const c = map.getContainer();
      c.style.cursor = t === "circle" ? "crosshair" : t === "pick" ? "pointer" : "";
    }
  };
  const togglePick = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id]));
  const pickRef = useRef(togglePick);
  pickRef.current = togglePick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")) as typeof Leaflet;
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { center: [31.7, 35.0], zoom: 8, zoomControl: true });
      mapRef.current = map;
      // OpenStreetMap's own tiles: no key, no account (CARTO's styled tiles started asking for one, Sep 22)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      for (const g of groups) {
        const kinds = [...new Set(g.map((u) => u.kind))];
        const color = kinds.length === 1 ? COLOR[kinds[0]] : "#0f172a";
        const icon = L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24], html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 11px system-ui">${g.length > 1 ? g.length : ""}</span></div>` });
        const marker = L.marker([g[0].lat, g[0].lng], { icon }).addTo(layer);
        marker.bindPopup(popupHtml(g), { closeButton: false, autoPan: false });
        marker.on("mouseover", () => marker.openPopup());
        marker.on("mouseout", () => {
          setTimeout(() => {
            const p = marker.getPopup()?.getElement();
            if (p && p.matches(":hover")) return;
            marker.closePopup();
          }, 250);
        });
        marker.on("click", () => {
          if (toolRef.current === "pick") for (const u of g) if (u.kind !== "projects") pickRef.current(u.id);
        });
      }
      if (groups.length) map.fitBounds(L.latLngBounds(groups.map((g) => [g[0].lat, g[0].lng] as [number, number])).pad(0.2), { maxZoom: 14 });
      // circle an area: press, drag, release
      let center: Leaflet.LatLng | null = null;
      map.on("mousedown", (e: Leaflet.LeafletMouseEvent) => {
        if (toolRef.current !== "circle") return;
        center = e.latlng;
        circleRef.current?.remove();
        circleRef.current = L.circle(center, { radius: 1, color: "#1d4ed8", weight: 2, fillOpacity: 0.08 }).addTo(map);
      });
      map.on("mousemove", (e: Leaflet.LeafletMouseEvent) => {
        if (toolRef.current !== "circle" || !center || !circleRef.current) return;
        circleRef.current.setRadius(Math.max(20, map.distance(center, e.latlng)));
      });
      const finish = () => {
        if (toolRef.current !== "circle" || !center || !circleRef.current) return;
        const c = center, r = circleRef.current.getRadius();
        center = null;
        setInCircle(units.filter((u) => map.distance(c, L.latLng(u.lat, u.lng)) <= r));
      };
      map.on("mouseup", finish);
      map.on("mouseout", finish);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearCircle = () => {
    circleRef.current?.remove();
    circleRef.current = null;
    setInCircle(null);
  };
  const listed = inCircle ?? picked.map((id) => byId[id]).filter(Boolean);
  const pickedUnits = picked.map((id) => byId[id]).filter(Boolean);
  const kinds = [...new Set(pickedUnits.map((u) => u.kind))];
  const compareHref = kinds.length === 1 && pickedUnits.length >= 2 ? `/israel/${kinds[0]}/compare?ids=${picked.join(",")}` : null;

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading the map…</div>}
      {/* toolbar */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1 rounded-lg border border-line bg-paper p-1 shadow-lg">
        {(
          [
            { t: "pan", icon: Hand, label: "Move around" },
            { t: "circle", icon: CircleIcon, label: "Circle an area: press and drag" },
            { t: "pick", icon: MousePointer2, label: "Pick pins to compare" },
          ] as { t: Tool; icon: typeof Hand; label: string }[]
        ).map((b) => (
          <button key={b.t} type="button" title={b.label} onClick={() => setTool(b.t)} className={`flex h-9 w-9 items-center justify-center rounded-md ${tool === b.t ? "bg-ink text-white" : "hover:bg-cream"}`}>
            <b.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      {/* legend */}
      <div className="absolute bottom-6 right-3 z-[1000] flex gap-3 rounded-md border border-line bg-paper/90 px-3 py-1.5 text-[11px] text-muted">
        {(Object.keys(COLOR) as MapUnit["kind"][]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} /> {KIND[k]}s
          </span>
        ))}
      </div>
      {/* the list: what is in the circle, or what has been picked */}
      {(inCircle || picked.length > 0) && (
        <div className="absolute right-14 top-3 z-[1000] flex max-h-[calc(100%-4rem)] w-80 flex-col overflow-hidden rounded-lg border border-line bg-paper shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm">
            <div className="font-semibold">{inCircle ? `${inCircle.length} in the circle` : `${picked.length} picked`}</div>
            <div className="flex items-center gap-2 text-xs">
              {inCircle && (
                <button type="button" className="text-muted hover:underline" onClick={clearCircle}>
                  Clear circle
                </button>
              )}
              {picked.length > 0 && (
                <button type="button" className="text-muted hover:underline" onClick={() => setPicked([])}>
                  Clear picks
                </button>
              )}
              <button type="button" className="text-muted hover:text-ink" onClick={() => { clearCircle(); setPicked([]); }} title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto text-sm">
            {listed.map((u) => (
              <li key={u.id} className="flex items-start gap-2 px-3 py-2">
                {u.kind !== "projects" && <input type="checkbox" className="mt-1 h-4 w-4 accent-sky-600" checked={picked.includes(u.id)} disabled={!picked.includes(u.id) && picked.length >= MAX_COMPARE} onChange={() => togglePick(u.id)} title="Pick for comparison" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <Link href={u.href} className="truncate font-medium hover:underline">
                      {u.name}
                    </Link>
                    <span className="shrink-0 rounded-full px-1.5 text-[10px] text-white" style={{ background: COLOR[u.kind] }}>
                      {KIND[u.kind]}
                    </span>
                  </div>
                  <div className="text-xs text-muted">{u.kind === "projects" ? [u.street, u.neighborhood, u.city].filter(Boolean).join(", ") : [u.internalSqm != null ? `${sqm(u.internalSqm)} internal` : null, u.mirpesetSqm != null ? `${sqm(u.mirpesetSqm)} mirpeset` : null, u.ppm != null ? `${nis(u.ppm)} / m²` : null, nis(u.priceNis) || null].filter(Boolean).join(" · ") || [u.neighborhood, u.city].filter(Boolean).join(", ")}</div>
                </div>
                <button type="button" title="Show on the map" className="text-muted hover:text-sky-700" onClick={() => mapRef.current?.setView([u.lat, u.lng], Math.max(mapRef.current.getZoom(), 16))}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {listed.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No units in that circle. Draw a wider one.</li>}
          </ul>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs">
            <span className="text-muted">{picked.length === 0 ? `Tick up to ${MAX_COMPARE} of one kind to compare.` : kinds.length > 1 ? "Pick apartments or houses, not both." : `${picked.length} of ${MAX_COMPARE} picked.`}</span>
            {compareHref ? (
              <Link href={compareHref} className="btn-primary px-3 py-1 text-xs">
                Compare {picked.length}
              </Link>
            ) : (
              <span className="btn-primary cursor-not-allowed px-3 py-1 text-xs opacity-40">Compare</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
