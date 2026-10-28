"use client";

import { useRef, useState } from "react";
import { Eye } from "lucide-react";

const PART = 327_680 * 10; // the same part size the route expects (outreach.ts BROCHURE_PART_BYTES)
const mb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/**
 * The brochure on a reach out (Jonathan, Oct 28, 2026: "the main attachment will be this, so add a place for me to add it to all
 * the emails"): what is on file, a look at it, and a Replace that uploads a new one in parts. One brochure serves every reach
 * out; the file list below ticks it, and every email in the launch carries it.
 */
export function BrochureCard({ brochure }: { brochure: { name: string; size: number; uploadedAt: string; by: string | null } | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const parts = Math.max(1, Math.ceil(file.size / PART));
    try {
      for (let i = 0; i < parts; i++) {
        setBusy(`Uploading ${file.name}: ${Math.round((i / parts) * 100)}%`);
        const chunk = file.slice(i * PART, Math.min((i + 1) * PART, file.size));
        const qs = new URLSearchParams({ part: String(i), parts: String(parts), name: file.name, size: String(file.size), type: file.type || "application/pdf" });
        const res = await fetch(`/api/outreach/brochure?${qs}`, { method: "POST", body: chunk, headers: { "Content-Type": "application/octet-stream" } });
        const j = (await res.json().catch(() => ({ ok: false, error: `upload failed (${res.status})` }))) as { ok: boolean; error?: string; done?: boolean };
        if (!j.ok) throw new Error(j.error ?? "upload failed");
      }
      setBusy("Uploaded. Refreshing the page…");
      window.location.reload(); // the file list below starts from what is on file when the page opens
    } catch (e) {
      setBusy(null);
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="card flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
      <span className="text-xs font-semibold text-sky-600">Brochure</span>
      {brochure ? (
        <>
          <span className="font-medium">{brochure.name}</span>
          <span className="text-xs text-muted">
            {mb(brochure.size)} · added {new Date(brochure.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {brochure.by ? ` by ${brochure.by.split("@")[0]}` : ""}
          </span>
          <a href="/api/outreach/brochure" target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="See the brochure (opens in a new tab)">
            <Eye className="h-3.5 w-3.5" />
          </a>
          <span className="text-xs text-muted">It is ticked in the files below and goes on every email of this reach out.</span>
        </>
      ) : (
        <span className="text-xs text-muted">No brochure on file yet. Add the PDF once; it is attached to every reach-out email from then on.</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {busy && <span className="text-xs text-muted">{busy}</span>}
        {error && <span className="max-w-[320px] text-xs text-red-700">{error}</span>}
        <input ref={input} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={Boolean(busy)} onClick={() => input.current?.click()} title="A PDF up to 25 MB; it replaces the brochure on file for every reach out">
          {brochure ? "Replace brochure" : "Add the brochure"}
        </button>
      </div>
    </div>
  );
}
