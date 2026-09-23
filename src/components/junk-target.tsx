"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { junkAqPhone, junkAqProperty } from "@/app/acquisitions/junk-actions";

type Target =
  | { kind: "property"; propertyId: string; label: string }
  | { kind: "phone"; contactId: string; field: string; phone: string; label?: string };

/**
 * Right-click to send something to junk (Shawn, Sep 23, 2026). Wraps a property name or a phone number: the context
 * menu offers "Send to junk", a confirm step explains what will happen, and only then the server action runs. A
 * property goes whole to Settings > Junk Properties (restorable); a phone number leaves the contact and lands in
 * Settings > Junk Phone Numbers, and is never written onto a contact again. `phoneOf` lets the wrapper decide the
 * number at click time (an input's value, the line under the caret in a bulleted list).
 */
export function JunkTarget({ target, phoneOf, children, className, block = false }: { target: Target; phoneOf?: (e: React.MouseEvent) => string | null; children: ReactNode; className?: string; block?: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number; phone: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ phone: string | null } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  const onContextMenu = (e: React.MouseEvent) => {
    let phone: string | null = null;
    if (target.kind === "phone") {
      phone = phoneOf ? phoneOf(e) : target.phone;
      if (!phone || !/\d{6,}/.test(phone)) return; // nothing under the pointer worth junking: the browser's own menu
    }
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, phone });
  };
  const what = target.kind === "property" ? `the property “${target.label}”` : `the number ${confirm?.phone ?? ""}`;
  const go = async () => {
    setBusy(true);
    setError(null);
    const r = target.kind === "property" ? await junkAqProperty(target.propertyId, reason || null) : await junkAqPhone(target.contactId, target.field, confirm?.phone ?? "", reason || null);
    setBusy(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setConfirm(null);
    setReason("");
    if (r.redirect) router.push(r.redirect);
    else router.refresh();
  };
  return (
    <>
      <span ref={ref} onContextMenu={onContextMenu} className={`${block ? "block" : "contents"} ${className ?? ""}`} title={target.kind === "property" ? "Right-click to send this property to junk" : undefined}>
        {children}
      </span>
      {menu && (
        <div className="fixed z-[90] min-w-[200px] rounded-md border border-line bg-paper py-1 text-sm shadow-lg" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 60) }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-700 hover:bg-cream" onClick={() => { setConfirm({ phone: menu.phone }); setMenu(null); }}>
            <Trash2 className="h-3.5 w-3.5" />
            {target.kind === "property" ? "Send this property to junk…" : `Send ${menu.phone} to junk…`}
          </button>
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="card w-full max-w-md p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold">Send {target.kind === "property" ? "this property" : "this number"} to junk?</div>
            <p className="mt-2 text-ink-soft">
              {target.kind === "property"
                ? `“${target.label}” leaves the Properties list, the map and the pipeline with everything on its card, and sits under Settings > Junk Properties, where it can be restored or removed for good.`
                : `${confirm.phone} is taken off this contact and kept under Settings > Junk Phone Numbers. It will not be written onto any contact again, by hand or by an import. Other numbers on the contact stay.`}
            </p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional): wrong number, sold, duplicate…" className="input mt-3 w-full" />
            {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => setConfirm(null)}>
                Keep it
              </button>
              <button type="button" className="btn-primary bg-red-700 px-3 py-1.5 text-xs hover:bg-red-800" disabled={busy} onClick={go}>
                {busy ? "Sending…" : `Yes, junk ${what}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The phone number under the caret of a bulleted textarea (one number per line), or of a single input. */
export function phoneUnderPointer(e: React.MouseEvent): string | null {
  const el = e.target as HTMLElement;
  if (el instanceof HTMLInputElement) return el.value.trim() || null;
  if (el instanceof HTMLTextAreaElement) {
    const pos = el.selectionStart ?? 0;
    const lines = el.value.split("\n");
    let at = 0;
    for (const line of lines) {
      if (pos <= at + line.length) return line.replace(/^\s*[•\-*]\s*/, "").trim() || null;
      at += line.length + 1;
    }
    return lines[lines.length - 1]?.replace(/^\s*[•\-*]\s*/, "").trim() || null;
  }
  return el.textContent?.trim() || null;
}
