"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Text } from "@/components/form-rows";
import { SelectField } from "@/components/select-field";
import { AQ_ROLES, aqRoleColor, parseJsonList } from "@/lib/acquisitions";

type Ct = Partial<{ firstName: string | null; lastName: string | null; email: string | null; phone: string | null; companyId: string | null; roles: string; notes: string | null }>;

/** A contact in RJL Acquisitions: seller, operator or buyer (a person at a company carries the company's roles too), then the person. */
export function AqContactForm({ c = {}, companies, action, autosave = false, submitLabel = "Create contact" }: { c?: Ct; companies: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [roles, setRoles] = useState<string[]>(parseJsonList(c.roles));
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const body = (
    <>
      <Group title="Role">
        <Row label="This contact is a" hint="A person at a company carries the company's roles as well.">
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
      <Group title="Contact">
        <Row label="First name">
          <Text name="firstName" value={c.firstName} />
        </Row>
        <Row label="Last name">
          <Text name="lastName" value={c.lastName} />
        </Row>
        <Row label="Email">
          <input name="email" type="email" defaultValue={c.email ?? ""} className="input" />
        </Row>
        <Row label="Phone">
          <Text name="phone" value={c.phone} placeholder="(212) 555-0100" />
        </Row>
        <Row label="Company">
          <SelectField name="companyId" defaultValue={c.companyId ?? ""} className="input">
            <option value="">None</option>
            {companies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name}
              </option>
            ))}
          </SelectField>
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
