"use client";

import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { IL_CITIES, IL_COMPANY_KINDS } from "@/lib/israel";

type Co = Partial<{ name: string; kind: string | null; city: string | null; website: string | null; phone: string | null; notes: string | null }>;

export function IlCompanyForm({ c = {}, action, autosave = false, submitLabel = "Create company" }: { c?: Co; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const body = (
    <Group title="Company">
      <Row label="Name">
        <Text name="name" value={c.name} placeholder="Harel Development Ltd." />
      </Row>
      <Row label="Kind">
        <Select name="kind" value={c.kind ?? ""} options={IL_COMPANY_KINDS} />
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
