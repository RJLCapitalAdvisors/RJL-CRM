"use client";

import { useEffect, useRef, useState } from "react";
import { searchCompaniesAction } from "@/app/deals/actions";

type Hit = { id: string; name: string; city: string | null; state: string | null; roles: string };

/**
 * The sponsor on a deal ticket is a company on file, not free text: type a few letters, pick the firm, and the
 * ticket links to it (associations, contacts, email matching all follow). Typing a name that is not on file keeps
 * the text as the sponsor name with no link, and says so.
 */
export function SponsorPicker({ name, companyId, companyName }: { name: string | null | undefined; companyId: string | null | undefined; companyName?: string | null }) {
  const [text, setText] = useState(name ?? companyName ?? "");
  const [picked, setPicked] = useState<string | null>(companyId ?? null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const linked = Boolean(picked) && text.trim() !== "" && (text === (companyName ?? name) || hits.length === 0);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || text.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => searchCompaniesAction(text).then((r) => live && setHits(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, open]);

  return (
    <div ref={box} className="relative">
      <input type="hidden" name="sponsorCompanyId" value={picked ?? ""} />
      <input
        name="sponsorName"
        value={text}
        placeholder="Type a company on file"
        className="input"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setPicked(null); // a new name means a new pick; the old link does not carry over
          setOpen(true);
        }}
      />
      <div className="mt-1 text-[11px] text-muted">{picked ? "Linked to the company on file" : text.trim() ? "Not linked: pick the firm from the list so the ticket ties to it" : ""}</div>
      {open && hits.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-paper shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-cream"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(h.name);
                  setPicked(h.id);
                  setOpen(false);
                  setHits([]);
                  // let the autosave form notice the change
                  setTimeout(() => box.current?.querySelector<HTMLInputElement>('input[name="sponsorName"]')?.dispatchEvent(new Event("input", { bubbles: true })), 0);
                }}
              >
                <span className="font-medium">{h.name}</span>
                <span className="ml-2 text-xs text-muted">{[h.city, h.state].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {linked ? null : null}
    </div>
  );
}
