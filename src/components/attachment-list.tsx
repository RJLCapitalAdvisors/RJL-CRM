"use client";

import { useState, useTransition } from "react";
import { FileSpreadsheet, FileText, File as FileIcon, Presentation, FileImage, BookOpen, Trash2 } from "lucide-react";

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
 * With onDelete, each file (not the FAQ, which is built from Questions answered) gets a delete button that asks first (Oct 27, 2026).
 */
export function AttachmentList({ files, onDelete }: { files: AttachmentRow[]; onDelete?: (fileId: string) => Promise<void> }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  return (
    <>
      {files.filter((f) => !gone.has(f.id)).map((f) => {
        const abs = typeof window !== "undefined" ? new URL(f.url, window.location.origin).toString() : f.url;
        return (
          <div key={f.id} className="group flex items-center hover:bg-cream">
          <a
            href={f.url}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("DownloadURL", `${mimeFor(f.name)}:${f.name}:${abs}`);
              e.dataTransfer.setData("text/uri-list", abs);
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="flex min-w-0 flex-1 cursor-grab items-center gap-2 py-2 pl-4 pr-2 text-sm active:cursor-grabbing"
            title="Click to download, or drag into an Outlook email"
          >
            {iconFor(f.name, f.kind)}
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 text-xs text-muted">
              {size(f.size)}
              {f.date ? ` · ${f.date}` : ""}
            </span>
          </a>
          {onDelete && f.kind !== "faq" ? (
            <button
              type="button"
              disabled={pending}
              className="mr-2 shrink-0 rounded p-1 text-muted opacity-0 hover:bg-paper hover:text-red-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
              title="Delete this file from the ticket (the email it came on stays in the mailbox)"
              aria-label={`Delete ${f.name}`}
              onClick={() => {
                if (!window.confirm(`Delete ${f.name} from this ticket?

It also leaves the Send page's files. The email it came on stays in the mailbox.`)) return;
                setGone((g) => new Set(g).add(f.id));
                start(async () => {
                  try {
                    await onDelete(f.id);
                  } catch {
                    setGone((g) => { const n = new Set(g); n.delete(f.id); return n; });
                    window.alert(`${f.name} could not be deleted. Try again.`);
                  }
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="w-2 shrink-0" />
          )}
          </div>
        );
      })}
    </>
  );
}
