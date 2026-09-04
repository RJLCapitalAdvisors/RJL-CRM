"use client";

import { useState } from "react";

/** Company logo from its email/web domain (Google favicon service), falling back to an initial. */
export function CompanyLogo({ domain, name, size = 20 }: { domain: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  if (!domain || failed) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded bg-sky text-[10px] font-semibold text-ink" style={{ width: size, height: size }} aria-hidden>
        {initial}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded bg-white object-contain"
      onError={() => setFailed(true)}
    />
  );
}
