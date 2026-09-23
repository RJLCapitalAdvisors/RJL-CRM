"use client";

import { AutoSaveForm } from "@/components/autosave-form";
import { MultiSelect } from "@/components/multi-select";
import { AddressPicker } from "@/components/address-picker";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { IL_CITIES, toMonthInput, IL_AMENITIES, parseJsonList, developerIdList } from "@/lib/israel";

/** 1 to 100, so a story count is picked, never mistyped (Jonathan, Sep 17). */
const STORIES = Array.from({ length: 100 }, (_, i) => String(i + 1));
type Proj = Partial<{ developerIds: string | null; amenities: string | null; amenitiesNo: string | null; gym: string | null; doorman: string | null; pool: string | null; name: string; developerId: string | null; street: string | null; city: string | null; neighborhood: string | null; totalUnits: number | null; parkingSpaces: number | null; stories: number | null; completionDate: string | null; description: string | null }>;

/** A whole project: the building or development, not one apartment in it. */
export function IlProjectForm({ p = {}, developers, action, autosave = false, submitLabel = "Create project" }: { p?: Proj; developers: { id: string; name: string }[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const body = (
    <>
      <Group title="Project">
        <Row label="Name">
          <Text name="name" value={p.name} placeholder="Rehavia Gardens" />
        </Row>
        <Row label="Developers" hint="Tick every yazam on the project; the first is the lead. Companies with the role Sponsor (Yazam) are offered.">
          <input type="hidden" name="developersSet" value="1" />
          <MultiSelect name="developers" options={developers.map((d) => d.name)} selected={developerIdList(p).map((id) => developers.find((d) => d.id === id)?.name).filter((x): x is string => Boolean(x))} placeholder="No developer yet" />
        </Row>
        <Row label="Address">
          <AddressPicker value={p.street} placeholder="Ramban 12" />
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
        <Row label="Amenities" hint="Yes when the project offers it, No when it does not. An amenity left blank is still asked of the agent. A private pool on a unit is asked on the unit.">
          <input type="hidden" name="amenitiesSet" value="1" />
          <div className="grid gap-x-6 gap-y-1 py-1 sm:grid-cols-2">
            {IL_AMENITIES.map((a) => (
              <label key={a} className="flex items-center justify-between gap-2 text-sm">
                <span>{a}</span>
                <select name={`amenity:${a}`} defaultValue={parseJsonList(p.amenities).includes(a) ? "Yes" : parseJsonList(p.amenitiesNo).includes(a) ? "No" : ""} className="input w-24 py-1 text-xs">
                  <option value="">—</option>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </label>
            ))}
          </div>
        </Row>
        <Row label="Year of construction / expected date of delivery" hint="Pick the month and year; the day does not matter.">
          <input type="month" name="completionDate" defaultValue={toMonthInput(p.completionDate)} className="input" />
          <input type="hidden" name="completionDateOrig" value={p.completionDate ?? ""} />
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
