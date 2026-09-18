import Link from "next/link";
import { Search } from "lucide-react";
import { parseList, roleColor } from "@/lib/taxonomy";

/** The strip at the top of every page, kept to one line so the window below gets the room (Jonathan, Sep 18, 2026). `compact` is accepted for older callers and changes nothing. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; compact?: boolean }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line bg-paper px-6 py-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 [&_.btn-primary]:py-1 [&_.btn-primary]:text-xs [&_.btn-secondary]:py-1 [&_.btn-secondary]:text-xs">{actions}</div>}
    </div>
  );
}

export function RoleChips({ roles }: { roles: string | string[] }) {
  const list = Array.isArray(roles) ? roles : parseList(roles);
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((r) => (
        <span key={r} className={`chip ${roleColor(r)}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

export function Chips({ items, tone = "bg-cream text-ink", max }: { items: string | string[]; tone?: string; max?: number }) {
  const list = Array.isArray(items) ? items : parseList(items);
  if (!list.length) return <span className="text-muted">—</span>;
  const shown = max ? list.slice(0, max) : list;
  const rest = list.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1" title={list.join(", ")}>
      {shown.map((r) => (
        <span key={r} className={`chip border border-line ${tone}`}>
          {r}
        </span>
      ))}
      {rest > 0 && <span className="chip text-muted">+{rest}</span>}
    </span>
  );
}

export function SearchForm({
  action,
  q,
  placeholder,
  children,
}: {
  action: string;
  q: string;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
        <input name="q" defaultValue={q} placeholder={placeholder} className="input w-72 py-1.5 pl-8 text-sm" />
      </div>
      {children}
      <button className="btn-secondary" type="submit">
        Search
      </button>
    </form>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  makeHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  makeHref: (p: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between px-6 py-1 text-xs text-muted [&_.btn-secondary]:py-0.5 [&_.btn-secondary]:text-xs">
      <div>
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </div>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className="btn-secondary" href={makeHref(page - 1)}>
            Previous
          </Link>
        ) : (
          <span className="btn-secondary opacity-40">Previous</span>
        )}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link className="btn-secondary" href={makeHref(page + 1)}>
            Next
          </Link>
        ) : (
          <span className="btn-secondary opacity-40">Next</span>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{children ?? <span className="text-muted">—</span>}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</div>;
}
