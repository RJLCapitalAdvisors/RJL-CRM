"use client";

import type { AnchorHTMLAttributes, DragEvent, ReactNode } from "react";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
  txt: "text/plain",
};
export const mimeFor = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** A file type can be told from its ending; a name without one gets the type's own (a floorplan saved as "Floorplan" with type application/pdf drags out as Floorplan.pdf). */
export const dragName = (name: string, type?: string | null) => {
  const clean = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "file";
  if (/\.[a-z0-9]{2,5}$/i.test(clean) || !type) return clean;
  const ext = Object.entries(MIME).find(([, m]) => m === type)?.[0];
  return ext ? `${clean}.${ext}` : clean;
};

/**
 * Every file in the CRM drags out of the browser like an attachment out of Outlook (Jonathan, Nov 25, 2026): onto the desktop,
 * into a folder, or into an email being written. Chrome and Edge take the file from the "DownloadURL" drag type
 * (mime:name:absolute link) and fetch it as the signed-in person; other browsers get the link.
 */
export function startFileDrag(e: DragEvent<HTMLElement>, name: string, url: string, type?: string | null) {
  const abs = new URL(url, window.location.origin).toString();
  const file = dragName(name, type);
  e.dataTransfer.setData("DownloadURL", `${type || mimeFor(file)}:${file}:${abs}`);
  e.dataTransfer.setData("text/uri-list", abs);
  e.dataTransfer.effectAllowed = "copy";
}

/** Spread on whatever shows a file: `<a href={url} {...fileDrag(name, url)}>`. */
export const fileDrag = (name: string, url: string, type?: string | null) => ({
  draggable: true,
  onDragStart: (e: DragEvent<HTMLElement>) => startFileDrag(e, name, url, type),
});

/** A link to a file that also drags out as the file; for pages rendered on the server, which cannot carry a drag handler themselves. */
export function DragFileLink({ name, url, type, children, ...rest }: { name: string; url: string; type?: string | null; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "draggable" | "onDragStart">) {
  return (
    <a href={url} {...rest} {...fileDrag(name, url, type)}>
      {children}
    </a>
  );
}
