"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { SelectField } from "@/components/select-field";
import { IL_ROLES, ilRoleColor, parseJsonList } from "@/lib/israel";

type Ct = Partial<{ firstName: string | null; lastName: string | null; email: string | null; phone: string | null; companyId: string | null; roles: string; language: string | null; budgetMinNis: number | null; budgetMaxNis: number | null; wantsCities: string | null; wantsRooms: string | null; notes: string | null }>;

/** A contact in RJL Israel. The first thing on the form is what they are: buyer, seller, or a sales agent (usually the people at companies). */
export function IlContactForm({ c = {}, companies, action, autosave = false, submitLabel = "Create contact" }: { c?: Ct; companies: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [roles, setRoles] = useState<string[]>(parseJsonList(c.roles));
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const body = (
    <>
      <Group title="Roles">
        <Row label="This contact is a" hint="A person at a company carries the company's roles as well.">
          <div className="flex flex-wrap gap-1.5 py-1">
            {IL_ROLES.map((r) => {
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
          <Text name="phone" value={c.phone} placeholder="+972 5x xxx xxxx" />
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
        <Row label="Language">
          <Select name="language" value={c.language ?? ""} options={["English", "Hebrew", "French", "Russian", "Spanish"]} />
        </Row>
      </Group>
      {roles.includes("Buyer") && (
        <Group title="What the buyer wants">
          <Row label="Budget from">
            <NumberInput name="budgetMinNis" defaultValue={c.budgetMinNis} decimals={false} prefix="₪" />
          </Row>
          <Row label="Budget to">
            <NumberInput name="budgetMaxNis" defaultValue={c.budgetMaxNis} decimals={false} prefix="₪" />
          </Row>
          <Row label="Cities">
            <Text name="wantsCities" value={c.wantsCities} placeholder="Jerusalem, Ra'anana" />
          </Row>
          <Row label="Rooms">
            <Text name="wantsRooms" value={c.wantsRooms} placeholder="4 to 5" />
          </Row>
        </Group>
      )}
      <Group title="Notes">
        <Row label="Notes">
          <textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" />
        </Row>
      </Group>
    </>
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
