"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ApartmentForm } from "../apartments/apartment-form";
import { HouseForm } from "../houses/house-form";
import { IlProjectForm } from "../projects/project-form";
import { updateApartment, updateHouse, updateIlProject } from "../actions";
import { queueApprove, queueMissing, queueTicketData, type QueueKind, type QueueTicket } from "../queue-actions";

/**
 * The "N needed" chip on a row of The Que and the panel it opens (Jonathan, Oct 16, 2026): the ticket's own form, in a
 * drawer over the list, with the Required Items List fields starred red. Every change autosaves; the count follows;
 * Approve lights up when nothing required is blank and sends the ticket into the system without leaving the page.
 */
export function FillDrawer({ kind, id, title, missing: initial }: { kind: QueueKind; id: string; title: string; missing: string[] }) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(initial);
  const [data, setData] = useState<QueueTicket | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    queueTicketData(kind, id).then((d) => { setData(d); if (d) setMissing(d.missing); }).finally(() => setLoading(false));
  }, [open, data, kind, id]);

  // the red asterisks: on the label of every form row whose field answers a Required Items List item (kept up as rows appear and vanish)
  useEffect(() => {
    if (!open || !data || !panel.current) return;
    const root = panel.current;
    const mark = () => {
      for (const n of data.requiredNames) {
        const els = root.querySelectorAll<HTMLElement>(n.endsWith(":") ? `[name^="${n}"]` : `[name="${n}"]`);
        for (const el of els) {
          const row = el.closest<HTMLElement>("div.border-b, div.py-2\\.5") ?? el.parentElement?.parentElement;
          const label = row?.querySelector<HTMLElement>(":scope > div:first-child");
          if (label && !label.querySelector(".req-star")) { const s = document.createElement("span"); s.className = "req-star ml-0.5 text-red-600"; s.textContent = " *"; label.appendChild(s); }
        }
      }
    };
    mark();
    const obs = new MutationObserver(() => mark());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const save = async (fd: FormData) => {
    if (kind === "apartments") await updateApartment(id, fd);
    else if (kind === "houses") await updateHouse(id, fd);
    else await updateIlProject(id, fd);
    setMissing(await queueMissing(kind, id));
  };
  const approve = () =>
    start(async () => {
      setError(null);
      const r = await queueApprove(kind, id);
      if (!r.ok) { setError(r.reason); setMissing(r.missing); return; }
      setDone(true);
      setOpen(false);
      router.refresh();
    });

  if (done) return <span className="chip bg-emerald-100 text-[11px] text-emerald-900">In the system</span>;
  const chip = missing.length === 0 ? <span className="chip bg-emerald-100 text-[11px] text-emerald-900">Complete · approve</span> : <span className="chip bg-amber-100 text-[11px] text-amber-900">{missing.length} needed</span>;
  return (
    <>
      <button type="button" className="inline-flex items-center" title={missing.length ? `Still needed: ${missing.join(", ")}. Click to fill in.` : "Nothing missing. Click to approve."} onClick={() => setOpen(true)}>
        {chip}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div ref={panel} className="flex h-full w-[560px] max-w-full flex-col border-l border-line bg-paper shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {missing.length ? <>{missing.length} required item{missing.length === 1 ? "" : "s"} still blank <span className="text-red-600">*</span></> : "Everything required is filled in."}
                  {" · "}
                  <Link href={`/israel/${kind}/${id}`} className="text-sky-700 hover:underline">open the ticket</Link>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={pending || missing.length > 0} title={missing.length ? `Fill in: ${missing.join(", ")}` : "Into the system"} onClick={approve}>
                  {pending ? "Approving…" : "Approve"}
                </button>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setOpen(false)} title="Close (Esc)">Close</button>
              </div>
            </div>
            {error && <div className="border-b border-line bg-red-50 px-5 py-2 text-xs text-red-700">{error}</div>}
            {missing.length > 0 && (
              <div className="border-b border-line bg-cream px-5 py-2 text-xs">
                <span className="font-medium">Still needed:</span> {missing.join(" · ")}
              </div>
            )}
            {data?.elsewhere.length ? (
              <div className="border-b border-line px-5 py-2 text-xs text-muted">
                Set on the ticket page, not here: {data.elsewhere.join(", ")}. <Link href={`/israel/${kind}/${id}`} className="text-sky-700 hover:underline">Open it</Link>.
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto px-5 py-3 text-sm [&_[data-calc]]:hidden [&_[data-hint]]:hidden">{/* calculated rows and field hints left out: only what can be typed (Jonathan, Oct 16, 2026) */}
              {loading || !data ? (
                <div className="py-8 text-center text-muted">{loading ? "Loading the ticket…" : "Could not load the ticket."}</div>
              ) : kind === "apartments" ? (
                <ApartmentForm a={data.row as never} fx={data.fx} projects={data.projects} action={save} autosave />
              ) : kind === "houses" ? (
                <HouseForm h={data.row as never} fx={data.fx} projects={data.projects} action={save} autosave />
              ) : (
                <IlProjectForm p={data.row as never} developers={data.developers} action={save} autosave />
              )}
            </div>
            <div className="border-t border-line px-5 py-2 text-[11px] text-muted"><span className="text-red-600">*</span> required to approve; every change saves on its own.</div>
          </div>
        </div>
      )}
    </>
  );
}
