"use client";

import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { SelectField } from "@/components/select-field";
import { IL_CITIES } from "@/lib/israel";

type Proj = Partial<{ name: string; developerId: string | null; street: string | null; city: string | null; neighborhood: string | null; totalUnits: number | null; parkingSpaces: number | null; stories: number | null; completionDate: string | null; description: string | null }>;

/** A whole project: the building or development, not one apartment in it. */
export function IlProjectForm({ p = {}, developers, action, autosave = false, submitLabel = "Create project" }: { p?: Proj; developers: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const body = (
    <>
      <Group title="Project">
        <Row label="Name">
          <Text name="name" value={p.name} placeholder="Rehavia Gardens" />
        </Row>
        <Row label="Developer">
          <SelectField name="developerId" defaultValue={p.developerId ?? ""}>
            <option value="">No developer</option>
            {developers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        </Row>
        <Row label="Address">
          <Text name="street" value={p.street} placeholder="Ramban 12" />
        </Row>
        <Row label="City">
          <input name="city" defaultValue={p.city ?? ""} className="input" list="il-cities-pr" />
          <datalist id="il-cities-pr">{IL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Row>
        <Row label="Neighborhood">
          <Text name="neighborhood" value={p.neighborhood} />
        </Row>
      </Group>
      <Group title="Building">
        <Row label="Total units">
          <NumberInput name="totalUnits" defaultValue={p.totalUnits} decimals={false} />
        </Row>
        <Row label="Total parking spaces">
          <NumberInput name="parkingSpaces" defaultValue={p.parkingSpaces} decimals={false} />
        </Row>
        <Row label="Total stories">
          <NumberInput name="stories" defaultValue={p.stories} decimals={false} />
        </Row>
        <Row label="Year of construction / expected date of delivery" hint="Month and year for a new build, e.g. 06/2027.">
          <Text name="completionDate" value={p.completionDate} placeholder="06/2027" />
        </Row>
      </Group>
      <Group title="Notes">
        <Row label="Description">
          <textarea name="description" rows={4} defaultValue={p.description ?? ""} className="input" />
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
