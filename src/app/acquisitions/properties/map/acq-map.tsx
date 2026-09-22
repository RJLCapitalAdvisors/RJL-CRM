"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Search, X } from "lucide-react";
import type { AqMapPin } from "@/lib/aq-map";
import { aqStageTone } from "@/lib/acquisitions";

const esc = (s: string) => s.replace(/</g, "&lt;");
const popupHtml = (p: AqMapPin) =>
  `<div style="min-width:220px;font:12px/1.45 system-ui"><a href="${p.href}" style="font-weight:600;color:#1e3a8a;text-decoration:none">${esc(p.address)}</a>` +
  `<div style="color:#444">${esc([p.businessName, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "))}</div>` +
  (p.ownerName || p.ownerEntity ? `<div style="color:#444">Owner: ${esc([p.ownerName, p.ownerEntity].filter(Boolean).join(", "))}${p.primaryPhone ? ` · ${esc(p.primaryPhone)}` : ""}</div>` : "") +
  (p.operatorName || p.operatorEntity ? `<div style="color:#444">Operator: ${esc([p.operatorName, p.operatorEntity].filter(Boolean).join(", "))}</div>` : "") +
  (p.callResult ? `<div style="color:#666">${esc(p.callResult)}</div>` : "") +
  `</div>`;

/**
 * The Acquisitions map: pins for every property. The panel on the right narrows them to one contact, one company or
 * one operator (the filters stack), and the address box drops a marker for any address so you can see where it sits
 * relative to the properties left on the map. Leaflet on OpenStreetMap tiles until a Google Maps key is in Vercel.
 */
export function AcqMap({ pins, googleKey }: { pins: AqMapPin[]; googleKey: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const searchRef = useRef<Leaflet.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [operator, setOperator] = useState("");
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const contacts = useMemo(() => [...new Map(pins.flatMap((p) => p.contacts).map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name)), [pins]);
  const companies = useMemo(() => [...new Map(pins.flatMap((p) => p.companies).map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name)), [pins]);
  const operators = useMemo(() => [...new Set(pins.map((p) => p.operatorEntity || p.operatorName || p.businessName).filter((x): x is string => Boolean(x)))].sort(), [pins]);
  const shown = useMemo(
    () => pins.filter((p) => (!contact || p.contacts.some((c) => c.id === contact)) && (!company || p.companies.some((c) => c.id === company)) && (!operator || [p.operatorEntity, p.operatorName, p.businessName].includes(operator))),
    [pins, contact, company, operator],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")) as typeof Leaflet;
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { center: [40.7, -73.95], zoom: 10 });
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // redraw the pins whenever the filters change
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    for (const p of shown) {
      const color = p.callResult === "Deal" ? "#0f172a" : p.callResult === "Callback" ? "#b45309" : p.callResult === "Not interested" || p.callResult === "Wrong number" ? "#9f1239" : "#1e3a8a";
      const icon = L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -22], html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>` });
      const m = L.marker([p.lat, p.lng], { icon }).addTo(layer);
      m.bindPopup(popupHtml(p), { closeButton: false, autoPan: false });
      m.on("mouseover", () => m.openPopup());
      m.on("mouseout", () => setTimeout(() => { const e = m.getPopup()?.getElement(); if (!(e && e.matches(":hover"))) m.closePopup(); }, 250));
      m.on("click", () => { window.location.href = p.href; });
    }
    const pts: [number, number][] = [...shown.map((p) => [p.lat, p.lng] as [number, number]), ...(found ? [[found.lat, found.lng] as [number, number]] : [])];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
  }, [shown, ready, found]);

  const search = async () => {
    const q = address.trim();
    const L = LRef.current, map = mapRef.current;
    if (!q || !L || !map) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
      const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      const hit = j[0];
      if (!hit) {
        setSearchError("That address was not found. Try adding the city and state.");
        return;
      }
      const lat = Number(hit.lat), lng = Number(hit.lon);
      searchRef.current?.remove();
      const icon = L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 30], html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#dc2626;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 13px system-ui">★</span></div>` });
      searchRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map).bindPopup(`<div style="font:12px system-ui"><b>Searched:</b> ${esc(hit.display_name)}</div>`);
      setFound({ label: hit.display_name, lat, lng });
    } catch {
      setSearchError("The address lookup did not answer. Try again in a moment.");
    } finally {
      setSearching(false);
    }
  };
  const clearSearch = () => {
    searchRef.current?.remove();
    searchRef.current = null;
    setFound(null);
    setAddress("");
  };
  const distanceMiles = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const nearest = found ? [...shown].map((p) => ({ p, d: distanceMiles(found, p) })).sort((a, b) => a.d - b.d).slice(0, 8) : [];

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading the map…</div>}
      <div className="absolute right-3 top-3 z-[1000] flex max-h-[calc(100%-1.5rem)] w-80 flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-paper p-3 text-sm shadow-lg">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Show properties</div>
        <label className="block">
          <span className="label">Contact</span>
          <select value={contact} onChange={(e) => setContact(e.target.value)} className="input py-1 text-sm">
            <option value="">Anyone</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Company</span>
          <select value={company} onChange={(e) => setCompany(e.target.value)} className="input py-1 text-sm">
            <option value="">Any company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Operator</span>
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className="input py-1 text-sm">
            <option value="">Any operator</option>
            {operators.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {shown.length} of {pins.length} on the map
          </span>
          {(contact || company || operator) && (
            <button type="button" className="hover:underline" onClick={() => { setContact(""); setCompany(""); setOperator(""); }}>
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-1 border-t border-line pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Find an address</div>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Brooklyn, NY" className="input flex-1 py-1 text-sm" />
          <button type="submit" disabled={searching || !address.trim()} className="btn-primary px-2 py-1" title="Drop a marker at this address">
            <Search className="h-4 w-4" />
          </button>
        </form>
        {searchError && <div className="text-xs text-red-700">{searchError}</div>}
        {found && (
          <div className="rounded-md border border-line bg-cream-50 p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-red-700">★ {found.label.split(",").slice(0, 3).join(",")}</div>
                <div className="text-muted">The filters stay on; these are the closest of the properties shown.</div>
              </div>
              <button type="button" onClick={clearSearch} className="text-muted hover:text-ink" title="Remove the marker">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-1 divide-y divide-line">
              {nearest.map(({ p, d }) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1">
                  <a href={p.href} className="min-w-0 truncate hover:underline">
                    {p.address}
                    {p.operatorEntity || p.businessName ? <span className="text-muted"> · {p.operatorEntity ?? p.businessName}</span> : null}
                  </a>
                  <span className="shrink-0 tabular-nums text-muted">{d < 10 ? d.toFixed(1) : Math.round(d)} mi</span>
                </li>
              ))}
              {nearest.length === 0 && <li className="py-1 text-muted">No properties on the map to compare with.</li>}
            </ul>
          </div>
        )}
        {!googleKey && <div className="mt-1 text-[11px] text-muted">On OpenStreetMap until a Google Maps key is added to Vercel.</div>}
        <div className="flex flex-wrap gap-1 pt-1">
          {["Deal", "Callback", "Not interested", "No answer"].map((s) => (
            <span key={s} className={`chip text-[10px] ${aqStageTone(s)}`}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
