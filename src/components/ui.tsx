import Link from "next/link";
import { Search } from "lucide-react";
import { parseList, roleColor } from "@/lib/taxonomy";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line bg-paper px-8 py-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
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
        <input name="q" defaultValue={q} placeholder={placeholder} className="input w-72 pl-8" />
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
    <div className="flex items-center justify-between px-8 py-3 text-sm text-muted">
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
