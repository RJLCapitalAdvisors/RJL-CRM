"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The big middle window of an apartment ticket: the floorplan, open as soon as the ticket opens.
 * Images show inline, PDFs in a viewer. Drop a file or pick one to replace it.
 */
export function FloorplanWindow({ apartmentId, has, type, name, version }: { apartmentId: string; has: boolean; type: string | null; name: string | null; version: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = `/api/israel/apartments/${apartmentId}/floorplan?v=${version}`;

  const upload = (file: File) => {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const r = await fetch(`/api/israel/apartments/${apartmentId}/floorplan`, { method: "POST", body: fd });
      if (!r.ok) setError((await r.text()) || "Upload failed.");
      router.refresh();
    });
  };
  const remove = () =>
    start(async () => {
      await fetch(`/api/israel/apartments/${apartmentId}/floorplan`, { method: "DELETE" });
      router.refresh();
    });

  return (
    <div
      className={`card flex min-h-[70vh] flex-col ${drag ? "ring-2 ring-sky-600" : ""}`}
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
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">Floorplan</div>
        <div className="flex items-center gap-2 text-xs">
          {name && <span className="max-w-[240px] truncate text-muted">{name}</span>}
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
            No floorplan yet.
            <br />
            Drop an image or PDF here, or click Upload.
          </div>
        ) : type === "application/pdf" ? (
          <iframe src={src} title="Floorplan" className="h-[70vh] w-full rounded-md border border-line bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Floorplan" className="max-h-[75vh] w-auto max-w-full rounded-md" />
        )}
      </div>
    </div>
  );
}
