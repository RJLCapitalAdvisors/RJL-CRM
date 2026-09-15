"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IL_ROLES } from "@/lib/israel";

type C = { id: string; name: string; email: string; roles: string[]; company: string | null; wants: string };

/** Step one of a send: the contact list, buyers ticked first. Search, filter by role, tick people, go on. */
export function IlRecipientPicker({ kind, id, contacts }: { kind: string; id: string; contacts: C[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [roles, setRoles] = useState<string[]>(["Buyer"]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(contacts.filter((c) => c.roles.includes("Buyer")).map((c) => c.id)));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts.filter((c) => (!roles.length || c.roles.some((r) => roles.includes(r))) && (!needle || `${c.name} ${c.email} ${c.company ?? ""} ${c.wants}`.toLowerCase().includes(needle)));
  }, [contacts, q, roles]);
  const toggleRole = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const toggle = (cid: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((c) => chosen.has(c.id));
  const setAllShown = (on: boolean) =>
    setChosen((cur) => {
      const next = new Set(cur);
      for (const c of shown) if (on) next.add(c.id);
      else next.delete(c.id);
      return next;
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, company, what they want" className="input w-80" />
        <div className="flex flex-wrap gap-1">
          {IL_ROLES.map((r) => (
            <button key={r} type="button" onClick={() => toggleRole(r)} className={`chip text-[11px] ${roles.includes(r) ? "bg-ink text-paper" : "bg-cream hover:bg-sky/40"}`}>
              {r}
            </button>
          ))}
          {roles.length > 0 && (
            <button type="button" onClick={() => setRoles([])} className="chip bg-cream text-[11px] text-muted hover:bg-sky/40">
              Everyone
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-muted">
            {chosen.size} chosen · {shown.length} shown
          </span>
          <button type="button" disabled={!chosen.size} onClick={() => router.push(`/israel/send/${kind}/${id}/compose?to=${[...chosen].join(",")}`)} className="btn-primary disabled:opacity-50">
            Next: the email
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-paper">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th className="w-8">
                <input type="checkbox" checked={allShown} onChange={(e) => setAllShown(e.target.checked)} className="accent-ink" title="Everyone shown" />
              </th>
              <th>Person</th>
              <th>Email</th>
              <th>Roles</th>
              <th>Company</th>
              <th>Looking for</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-sky/20" onClick={() => toggle(c.id)}>
                <td>
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} className="accent-ink" />
                </td>
                <td className="font-medium">{c.name}</td>
                <td className="text-xs text-muted">{c.email}</td>
                <td className="text-xs">{c.roles.join(", ")}</td>
                <td className="text-xs text-muted">{c.company ?? ""}</td>
                <td className="text-xs text-muted">{c.wants}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Nobody matches. Clear the search or widen the roles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
