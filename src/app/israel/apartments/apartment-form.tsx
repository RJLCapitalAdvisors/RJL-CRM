import { Field } from "@/components/record-layout";
import { IL_APARTMENT_TYPES, IL_CITIES, IL_CONDITIONS, IL_DIRECTIONS, parseJsonList } from "@/lib/israel";

type Apt = Partial<{
  name: string; apartmentType: string | null; city: string | null; neighborhood: string | null; street: string | null; projectName: string | null; rooms: number | null; floor: number | null; totalFloors: number | null;
  internalSqm: number | null; mirpesetSqm: number | null; gardenSqm: number | null; direction: string | null; parking: number | null; storage: boolean; elevator: boolean; mamad: boolean; priceNis: number | null;
  builtYear: number | null; completionDate: string | null; condition: string | null; description: string | null; developerId: string | null; agentContactId: string | null; sellerContactId: string | null; source: string | null;
}>;

/** The apartment ticket's fields: what a buyer asks first, in the order they ask it. */
export function ApartmentForm({ a = {}, developers, agents, sellers, action, submitLabel = "Save" }: { a?: Apt; developers: { id: string; name: string }[]; agents: { id: string; name: string }[]; sellers: { id: string; name: string }[]; action: (fd: FormData) => Promise<void>; submitLabel?: string }) {
  const dirs = parseJsonList(a.direction);
  const v = (x: number | null | undefined) => (x == null ? "" : String(x));
  return (
    <form action={action} className="space-y-3">
      <Field label="Name (project or address)" htmlFor="name">
        <input id="name" name="name" defaultValue={a.name ?? ""} className="input" placeholder="e.g. Rehavia Gardens, apt 12" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="apartmentType">
          <select id="apartmentType" name="apartmentType" defaultValue={a.apartmentType ?? ""} className="input">
            <option value="">Not set</option>
            {IL_APARTMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Condition" htmlFor="condition">
          <select id="condition" name="condition" defaultValue={a.condition ?? ""} className="input">
            <option value="">Not set</option>
            {IL_CONDITIONS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" htmlFor="city">
          <input id="city" name="city" defaultValue={a.city ?? ""} className="input" list="il-cities" />
          <datalist id="il-cities">{IL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Neighborhood" htmlFor="neighborhood">
          <input id="neighborhood" name="neighborhood" defaultValue={a.neighborhood ?? ""} className="input" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Street and number" htmlFor="street">
          <input id="street" name="street" defaultValue={a.street ?? ""} className="input" />
        </Field>
        <Field label="Project / building" htmlFor="projectName">
          <input id="projectName" name="projectName" defaultValue={a.projectName ?? ""} className="input" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Rooms" htmlFor="rooms">
          <input id="rooms" name="rooms" type="number" step="0.5" defaultValue={v(a.rooms)} className="input" />
        </Field>
        <Field label="Floor" htmlFor="floor">
          <input id="floor" name="floor" type="number" defaultValue={v(a.floor)} className="input" />
        </Field>
        <Field label="Of floors" htmlFor="totalFloors">
          <input id="totalFloors" name="totalFloors" type="number" defaultValue={v(a.totalFloors)} className="input" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Internal m²" htmlFor="internalSqm">
          <input id="internalSqm" name="internalSqm" type="number" step="0.5" defaultValue={v(a.internalSqm)} className="input" />
        </Field>
        <Field label="Mirpeset m²" htmlFor="mirpesetSqm">
          <input id="mirpesetSqm" name="mirpesetSqm" type="number" step="0.5" defaultValue={v(a.mirpesetSqm)} className="input" />
        </Field>
        <Field label="Garden m²" htmlFor="gardenSqm">
          <input id="gardenSqm" name="gardenSqm" type="number" step="0.5" defaultValue={v(a.gardenSqm)} className="input" />
        </Field>
      </div>
      <Field label="Direction (air directions)">
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          {IL_DIRECTIONS.map((d) => (
            <label key={d} className="flex items-center gap-1.5">
              <input type="checkbox" name="direction" value={d} defaultChecked={dirs.includes(d)} className="accent-ink" /> {d}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Parking spaces" htmlFor="parking">
          <input id="parking" name="parking" type="number" defaultValue={v(a.parking)} className="input" />
        </Field>
        <label className="flex items-end gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="storage" defaultChecked={Boolean(a.storage)} className="accent-ink" /> Storage
        </label>
        <label className="flex items-end gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="elevator" defaultChecked={Boolean(a.elevator)} className="accent-ink" /> Elevator
        </label>
        <label className="flex items-end gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="mamad" defaultChecked={Boolean(a.mamad)} className="accent-ink" /> Mamad
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Asking price (₪)" htmlFor="priceNis">
          <input id="priceNis" name="priceNis" type="number" step="1000" defaultValue={v(a.priceNis)} className="input" />
        </Field>
        <Field label="Year built" htmlFor="builtYear">
          <input id="builtYear" name="builtYear" type="number" defaultValue={v(a.builtYear)} className="input" />
        </Field>
        <Field label="Estimated completion" htmlFor="completionDate">
          <input id="completionDate" name="completionDate" defaultValue={a.completionDate ?? ""} className="input" placeholder="e.g. Q2 2028" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Developer" htmlFor="developerId">
          <select id="developerId" name="developerId" defaultValue={a.developerId ?? ""} className="input">
            <option value="">None</option>
            {developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Agent" htmlFor="agentContactId">
          <select id="agentContactId" name="agentContactId" defaultValue={a.agentContactId ?? ""} className="input">
            <option value="">None</option>
            {agents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Seller" htmlFor="sellerContactId">
          <select id="sellerContactId" name="sellerContactId" defaultValue={a.sellerContactId ?? ""} className="input">
            <option value="">None</option>
            {sellers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Where it came from" htmlFor="source">
        <input id="source" name="source" defaultValue={a.source ?? ""} className="input" placeholder="agent, developer, Yad2, friend…" />
      </Field>
      <Field label="Description" htmlFor="description">
        <textarea id="description" name="description" rows={4} defaultValue={a.description ?? ""} className="input" />
      </Field>
      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </form>
  );
}
