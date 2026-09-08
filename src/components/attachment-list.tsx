"use client";

import { FileSpreadsheet, FileText, File as FileIcon, Presentation, FileImage, BookOpen } from "lucide-react";

export type AttachmentRow = { id: string; name: string; size: number; date: string; url: string; kind?: "faq" };

const iconFor = (name: string, kind?: string) => {
  if (kind === "faq") return <BookOpen className="h-4 w-4 shrink-0 text-sky-600" />;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xlsm", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />;
  if (ext === "pdf") return <FileText className="h-4 w-4 shrink-0 text-red-700" />;
  if (["ppt", "pptx"].includes(ext)) return <Presentation className="h-4 w-4 shrink-0 text-orange-600" />;
  if (["png", "jpg", "jpeg", "gif"].includes(ext)) return <FileImage className="h-4 w-4 shrink-0 text-muted" />;
  return <FileIcon className="h-4 w-4 shrink-0 text-muted" />;
};
const mimeFor = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }[ext] ?? "application/octet-stream";
};
const size = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n > 0 ? `${Math.max(1, Math.round(n / 1000))} KB` : "");

/**
 * Deal attachments with a type icon each. Every row is a download link and can be dragged straight out of
 * the browser into an Outlook email (Chrome/Edge hand the file over via the DownloadURL drag type).
 */
export function AttachmentList({ files }: { files: AttachmentRow[] }) {
  return (
    <>
      {files.map((f) => {
        const abs = typeof window !== "undefined" ? new URL(f.url, window.location.origin).toString() : f.url;
        return (
          <a
            key={f.id}
            href={f.url}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("DownloadURL", `${mimeFor(f.name)}:${f.name}:${abs}`);
              e.dataTransfer.setData("text/uri-list", abs);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="flex cursor-grab items-center gap-2 px-4 py-2 text-sm hover:bg-cream active:cursor-grabbing"
            title="Click to download, or drag into an Outlook email"
          >
            {iconFor(f.name, f.kind)}
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 text-xs text-muted">
              {size(f.size)}
              {f.date ? ` · ${f.date}` : ""}
            </span>
          </a>
        );
      })}
    </>
  );
}
