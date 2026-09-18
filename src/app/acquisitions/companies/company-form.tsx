"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Text } from "@/components/form-rows";
import { AQ_ROLES, aqRoleColor, parseJsonList } from "@/lib/acquisitions";

type Co = Partial<{ name: string; roles: string; city: string | null; state: string | null; website: string | null; phone: string | null; notes: string | null }>;

/** A company in RJL Acquisitions: seller, operator or buyer first (its roles flow to its people), then the firm. */
export function AqCompanyForm({ c = {}, action, autosave = false, submitLabel = "Create company" }: { c?: Co; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [roles, setRoles] = useState<string[]>(parseJsonList(c.roles));
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const body = (
    <>
      <Group title="Role">
        <Row label="This company is a" hint="Everyone at the company carries these roles.">
          <div className="flex flex-wrap gap-1.5 py-1">
            {AQ_ROLES.map((r) => {
              const on = roles.includes(r);
              return (
                <label key={r} className={`chip cursor-pointer text-[11px] ${on ? aqRoleColor(r) : "border border-dashed border-line bg-transparent text-muted hover:text-ink"}`}>
                  <input type="checkbox" name="roles" value={r} checked={on} onChange={() => toggle(r)} className="sr-only" />
                  {r}
                </label>
              );
            })}
          </div>
        </Row>
      </Group>
      <Group title="Company">
        <Row label="Name">
          <Text name="name" value={c.name} placeholder="Company name" />
        </Row>
        <Row label="Website" hint="The logo comes from the website's domain.">
          <Text name="website" value={c.website} placeholder="https://example.com" />
        </Row>
        <Row label="Phone">
          <Text name="phone" value={c.phone} />
        </Row>
        <Row label="City">
          <Text name="city" value={c.city} />
        </Row>
        <Row label="State">
          <Text name="state" value={c.state} placeholder="NY" />
        </Row>
      </Group>
      <Group title="Notes">
        <Row label="Notes">
          <textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" />
        </Row>
      </Group>
    </>
  );
  if (autosave) return <AutoSaveForm action={action}>{body}</AutoSaveForm>;
  return (
    <form action={action} className="space-y-4">
      {body}
      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </form>
  );
}
