"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload } from "lucide-react";

/** Drop or choose a Terakotta export; it is read whole on the server and the review page opens. */
export function Uploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setBusy(file.name);
    const fd = new FormData();
    fd.set("file", file);
    try {
      const res = await fetch("/api/acquisitions/import", { method: "POST", body: fd });
      const r = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !r.id) throw new Error(r.error ?? "The upload failed.");
      router.push(`/acquisitions/ask/import/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files[0]);
      }}
      onClick={() => input.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${over ? "border-sky-600 bg-sky-50" : "border-line bg-paper hover:border-sky-400"}`}
    >
      <input ref={input} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      {busy ? (
        <>
          <FileSpreadsheet className="h-7 w-7 animate-pulse text-sky-700" />
          <div className="text-sm font-medium">Reading {busy}…</div>
          <div className="text-xs text-muted">Every row, folded into properties.</div>
        </>
      ) : (
        <>
          <Upload className="h-7 w-7 text-sky-700" />
          <div className="text-sm font-medium">Drop a Terakotta call export here, or click to choose it</div>
          <div className="text-xs text-muted">.csv or .xlsx, any size. Nothing is written to the CRM until you review it and click Import.</div>
        </>
      )}
      {error && <div className="mt-2 rounded bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</div>}
    </div>
  );
}
