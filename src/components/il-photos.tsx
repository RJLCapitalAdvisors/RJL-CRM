"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

/**
 * Pictures of a unit or project: renderings and photos, above the floorplan. Drop files or pick several at once;
 * click one to open it full size; the x on a picture removes it. Stored on the ticket (IlPhoto), served by
 * /api/israel/photos/[id]. The Send page can attach them.
 */
export function PhotosWindow({ kind, id, photos }: { kind: "apartments" | "houses" | "projects"; id: string; photos: { id: string; name: string }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      setError("Pictures only (JPG, PNG, WebP).");
      return;
    }
    setError(null);
    const fd = new FormData();
    for (const f of list) fd.append("files", f);
    start(async () => {
      const r = await fetch(`/api/israel/${kind}/${id}/photos`, { method: "POST", body: fd });
      if (!r.ok) setError((await r.text()) || "Upload failed.");
      router.refresh();
    });
  };
  const remove = (photoId: string) =>
    start(async () => {
      await fetch(`/api/israel/photos/${photoId}`, { method: "DELETE" });
      router.refresh();
    });
  return (
    <div
      className={`card ${drag ? "ring-2 ring-sky-600" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">Pictures</div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted">{photos.length ? `${photos.length} ${photos.length === 1 ? "picture" : "pictures"}` : "renderings and photos"}</span>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : "Add pictures"}
          </button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
      </div>
      {error && <div className="px-4 py-2 text-xs text-red-700">{error}</div>}
      {photos.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">Drop renderings and photos here, or click Add pictures.</div>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4">
          {photos.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-md border border-line bg-cream">
              <a href={`/api/israel/photos/${p.id}`} target="_blank" title={p.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/israel/photos/${p.id}`} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
              </a>
              <button type="button" onClick={() => confirm("Remove this picture?") && remove(p.id)} className="absolute right-1 top-1 hidden rounded-full bg-white/90 p-0.5 text-ink shadow group-hover:block" title="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
