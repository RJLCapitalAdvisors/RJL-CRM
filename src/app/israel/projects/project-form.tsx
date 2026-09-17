"use client";

import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { SelectField } from "@/components/select-field";
import { IL_CITIES } from "@/lib/israel";

/** 1 to 100, so a story count is picked, never mistyped (Jonathan, Sep 17). */
const STORIES = Array.from({ length: 100 }, (_, i) => String(i + 1));
/** "06/2027" or "2027" on the ticket -> "2027-06" / "2027-01" for the month picker. */
const toMonthInput = (v: string | null | undefined) => {
  if (!v) return "";
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (m) return v;
  const my = v.match(/(\d{1,2})\s*\/\s*((?:19|20)\d{2})/);
  if (my) return `${my[2]}-${my[1].padStart(2, "0")}`;
  const y = v.match(/(?:19|20)\d{2}/);
  return y ? `${y[0]}-01` : "";
};

type Proj = Partial<{ doorman: string | null; pool: string | null; name: string; developerId: string | null; street: string | null; city: string | null; neighborhood: string | null; totalUnits: number | null; parkingSpaces: number | null; stories: number | null; completionDate: string | null; description: string | null }>;

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
          <Select name="stories" value={p.stories != null ? String(p.stories) : ""} options={STORIES} />
        </Row>
        <Row label="Doorman" hint="A doorman or reception in the building.">
          <Select name="doorman" value={p.doorman ?? ""} options={["Yes", "No"]} />
        </Row>
        <Row label="Project pool" hint="A shared pool in the project. A private pool on a unit is asked on the unit.">
          <Select name="pool" value={p.pool ?? ""} options={["Yes", "No"]} />
        </Row>
        <Row label="Year of construction / expected date of delivery" hint="Pick the month and year; the day does not matter.">
          <input type="month" name="completionDate" defaultValue={toMonthInput(p.completionDate)} className="input" />
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
