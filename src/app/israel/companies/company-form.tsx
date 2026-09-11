"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Text } from "@/components/form-rows";
import { IL_CITIES, IL_COMPANY_ROLES, ilRoleColor, parseJsonList } from "@/lib/israel";

type Co = Partial<{ name: string; roles: string; city: string | null; website: string | null; phone: string | null; notes: string | null }>;

/** Company fields. Roles are tokens: tick what the firm is; they flow to the firm's contacts. */
export function IlCompanyForm({ c = {}, action, autosave = false, submitLabel = "Create company" }: { c?: Co; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [roles, setRoles] = useState<string[]>(() => parseJsonList(c.roles ?? "[]"));
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const body = (
    <Group title="Company">
      <Row label="Name">
        <Text name="name" value={c.name} placeholder="Harel Development Ltd." />
      </Row>
      <Row label="Roles">
        <div className="flex flex-wrap gap-1.5 py-1">
          {IL_COMPANY_ROLES.map((r) => {
            const on = roles.includes(r);
            return (
              <label key={r} className={`chip cursor-pointer text-[11px] ${on ? ilRoleColor(r) : "border border-dashed border-line bg-transparent text-muted hover:text-ink"}`}>
                <input type="checkbox" name="roles" value={r} checked={on} onChange={() => toggle(r)} className="sr-only" />
                {r}
              </label>
            );
          })}
        </div>
      </Row>
      <Row label="City">
        <input name="city" defaultValue={c.city ?? ""} className="input" list="il-cities-co" />
        <datalist id="il-cities-co">{IL_CITIES.map((x) => <option key={x} value={x} />)}</datalist>
      </Row>
      <Row label="Website">
        <Text name="website" value={c.website} placeholder="https://" />
      </Row>
      <Row label="Phone">
        <Text name="phone" value={c.phone} placeholder="+972 2 xxx xxxx" />
      </Row>
      <Row label="Notes">
        <textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" />
      </Row>
    </Group>
  );
  if (autosave) return <AutoSaveForm action={action}>{body}</AutoSaveForm>;
  return (
    <form action={action}>
      {body}
      <button type="submit" className="btn-primary mt-4">
        {submitLabel}
      </button>
    </form>
  );
}
