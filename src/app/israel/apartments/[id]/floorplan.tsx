"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The big middle window of an apartment ticket: the floorplan, open as soon as the ticket opens.
 * Images show inline, PDFs in a viewer. Drop a file or pick one to replace it.
 */
export function FloorplanWindow({ apartmentId, kind = "apartments", endpoint, title = "Floorplan", compact = false, has, type, name, version }: { apartmentId: string; kind?: "apartments" | "houses"; endpoint?: string; title?: string; compact?: boolean; has: boolean; type: string | null; name: string | null; version: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = endpoint ?? `/api/israel/${kind}/${apartmentId}/floorplan`;
  const src = `${base}?v=${version}`;

  const upload = (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const r = await fetch(base, { method: "POST", body: fd });
      if (!r.ok) setError((await r.text()) || "Upload failed.");
      router.refresh();
    });
  };
  const remove = () =>
    start(async () => {
      await fetch(base, { method: "DELETE" });
      router.refresh();
    });

  return (
    <div
      className={`card flex flex-col ${compact ? "min-h-[320px]" : "min-h-[70vh]"} ${drag ? "ring-2 ring-sky-600" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) upload(f);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2">
        <div className="shrink-0 text-sm font-semibold">{title}</div>
        {name && <span className="min-w-0 flex-1 truncate text-xs text-muted" title={name}>{name}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          {has && (
            <a href={src} target="_blank" className="btn-secondary px-2 py-1 text-xs">
              Open
            </a>
          )}
          <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : has ? "Replace" : "Upload"}
          </button>
          {has && (
            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
      </div>
      {error && <div className="border-b border-line px-4 py-2 text-xs text-red-400">{error}</div>}
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {!has ? (
          <div className="text-center text-sm text-muted">
            No {title.toLowerCase()} yet.
            <br />
            Drop {title === "Brochure" ? "the PDF" : "an image or PDF"} here, or click Upload.
          </div>
        ) : type === "application/pdf" ? (
          <iframe src={src} title={title} className={`${compact ? "h-full min-h-[280px]" : "h-[70vh]"} w-full rounded-md border border-line bg-white`} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={title} className={`${compact ? "max-h-full" : "max-h-[75vh]"} w-auto max-w-full rounded-md`} />
        )}
      </div>
    </div>
  );
}
