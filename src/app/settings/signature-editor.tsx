"use client";

import { useRef, useState } from "react";

/** Paste-your-Outlook-signature box: rich paste, saved as HTML. */
export function SignatureEditor({ userId, initialHtml, action }: { userId: string; initialHtml: string; action: (fd: FormData) => void | Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(initialHtml);
  const [saved, setSaved] = useState(false);
  return (
    <form
      action={async (fd) => {
        fd.set("signatureHtml", ref.current?.innerHTML ?? "");
        await action(fd);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }}
      className="space-y-3"
    >
      <input type="hidden" name="userId" value={userId} />
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => setHtml((e.target as HTMLDivElement).innerHTML)}
        className="input min-h-[120px] whitespace-normal"
        style={{ fontFamily: "Calibri, Arial, sans-serif", fontSize: "11pt" }}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
      <div className="flex items-center gap-3">
        <button className="btn-soft" type="submit">
          Save signature
        </button>
        {!html && <span className="text-sm text-muted">Empty: paste your Outlook signature here.</span>}
        {saved && <span className="text-sm text-muted">Saved.</span>}
      </div>
    </form>
  );
}
