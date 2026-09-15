"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Calc, Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { MirpasotFields } from "@/components/mirpasot-fields";
import { SelectField } from "@/components/select-field";
import { ACRES_PER_SQM, IL_CITIES, IL_HOUSE_TYPES, IL_PARKING, IL_SELLER_TYPES, PRICE_PER_METER_NOTE, feet, isSecondHand, nis, parseJsonList, parseMirpasot, pricePerMeter, sqft, usdFmt, usdPerSqft } from "@/lib/israel";
import type { FxRate } from "@/lib/fx";

export type IlHouseForm = Partial<{
  name: string; houseType: string | null; projectId: string | null; street: string | null; city: string | null; neighborhood: string | null; rooms: number | null; floors: number | null; ceilingCms: string | null; completionDate: string | null;
  internalSqm: number | null; mirpesetSqm: number | null; mirpesetCount: number | null; mirpesetDirection: string | null; mirpasot: string | null; migrashSqm: number | null; pool: string | null; poolSqm: number | null; parkingSpots: string | null; mamad: boolean; priceNis: number | null; sellerType: string | null; renovationYear: number | null; description: string | null;
}>;

const FLOOR_NAMES = ["Ground floor", "First floor", "Second floor", "Third floor", "Fourth floor", "Fifth floor", "Sixth floor", "Seventh floor"];
const floorName = (i: number) => FLOOR_NAMES[i] ?? `Floor ${i + 1}`;

/**
 * The house ticket. Same shape as the apartment ticket, with the house-only fields: how many floors (miflasim) and a
 * ceiling height for each of them, and the migrash (plot) in m² shown in dunam and acres beside it.
 */
export function HouseForm({ h = {}, fx, projects = [], action, autosave = false, submitLabel = "Create house" }: { h?: IlHouseForm; fx: FxRate | null; projects?: { id: string; name: string; city: string | null }[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [internal, setInternal] = useState<number | null>(h.internalSqm ?? null);
  const [mirpeset, setMirpeset] = useState<number | null>(h.mirpesetSqm ?? null);
  const [migrash, setMigrash] = useState<number | null>(h.migrashSqm ?? null);
  const [floors, setFloors] = useState<number | null>(h.floors ?? null);
  const [ceilings, setCeilings] = useState<(number | null)[]>(() => parseJsonList(h.ceilingCms).map((x) => (x === "" ? null : Number(x))));
  const [price, setPrice] = useState<number | null>(h.priceNis ?? null);
  const [sellerType, setSellerType] = useState(h.sellerType ?? "");
  const [pool, setPool] = useState(h.pool ?? "");
  const perSqft = usdPerSqft(price, internal, mirpeset, fx?.ilsPerUsd);
  const ppm = pricePerMeter(price, internal, mirpeset);
  const usd = (v: number | null) => (v != null && fx ? usdFmt(v / fx.ilsPerUsd) : null);
  const fxNote = fx ? `at ₪${fx.ilsPerUsd.toFixed(3)} per $ (ECB, ${fx.date})` : "exchange rate unavailable right now";
  const dash = "—";
  const floorCount = Math.min(Math.max(Math.trunc(floors ?? 0), 0), 8);
  const setCeiling = (i: number, v: number | null) =>
    setCeilings((cur) => {
      const next = [...cur];
      while (next.length < floorCount) next.push(null);
      next[i] = v;
      return next;
    });

  const body = (
    <>
      <Group title="House">
        <Row label="Name">
          <Text name="name" value={h.name} placeholder="Katamon cottage, HaPalmach 8" />
        </Row>
        <Row label="House type">
          <Select name="houseType" value={h.houseType ?? ""} options={IL_HOUSE_TYPES} />
        </Row>
        <Row label="Project" hint="The development this house is part of, if any. Its facts flow up to the project.">
          <SelectField name="projectId" defaultValue={h.projectId ?? ""}>
            <option value="">No project</option>
            {projects.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
                {pr.city ? ` · ${pr.city}` : ""}
              </option>
            ))}
          </SelectField>
        </Row>
        <Row label="City">
          <input name="city" defaultValue={h.city ?? ""} className="input" list="il-cities-house" />
          <datalist id="il-cities-house">{IL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Row>
        <Row label="Neighborhood">
          <Text name="neighborhood" value={h.neighborhood} />
        </Row>
        <Row label="Address">
          <Text name="street" value={h.street} placeholder="HaPalmach 8" />
        </Row>
        <Row label="Rooms">
          <NumberInput name="rooms" defaultValue={h.rooms} />
        </Row>
        <Row label="How many floors (miflasim)" hint="Pick the number of floors and a ceiling height appears for each.">
          <NumberInput name="floors" defaultValue={h.floors} decimals={false} onValue={setFloors} />
        </Row>
        {Array.from({ length: floorCount }, (_, i) => (
          <div key={i} className="contents">
            <Row label={`${floorName(i)} ceiling (cm)`}>
              <NumberInput name="ceilingCm" defaultValue={ceilings[i] ?? null} onValue={(v) => setCeiling(i, v)} />
            </Row>
            <Calc label={`${floorName(i)} ceiling in feet`} value={ceilings[i] != null ? feet(ceilings[i]) : dash} />
          </div>
        ))}
        <Row label="Built or expected delivery" hint="Month and year for a new build, e.g. 06/2027. Year alone for an existing house.">
          <Text name="completionDate" value={h.completionDate} placeholder="06/2027" />
        </Row>
        <Row label="Parking">
          <Select name="parkingSpots" value={h.parkingSpots ?? ""} options={IL_PARKING} />
        </Row>
        <Row label="Seller type">
          <Select name="sellerType" value={sellerType} options={IL_SELLER_TYPES} onChange={setSellerType} />
        </Row>
        {isSecondHand(sellerType) && (
          <Row label="Year of renovation" hint="Leave blank if never renovated.">
            <NumberInput name="renovationYear" defaultValue={h.renovationYear} decimals={false} />
          </Row>
        )}
        <Row label="Mamad">
          <Select name="mamad" value={h.mamad == null ? "" : h.mamad ? "Yes" : "No"} options={["Yes", "No"]} />
        </Row>
      </Group>

      <Group title="Size">
        <Row label="Internal m²">
          <NumberInput name="internalSqm" defaultValue={h.internalSqm} onValue={setInternal} />
        </Row>
        <Calc label="Internal square feet" value={internal != null ? sqft(internal) : dash} />
        <MirpasotFields count={h.mirpesetCount} sqm={h.mirpesetSqm} directions={parseJsonList(h.mirpesetDirection)} mirpasot={parseMirpasot(h.mirpasot)} onTotal={setMirpeset} />
        <Row label="Migrash size (m²)" hint="The plot the house sits on.">
          <NumberInput name="migrashSqm" defaultValue={h.migrashSqm} onValue={setMigrash} />
        </Row>
        <Calc label="Migrash in dunam" value={migrash != null ? `${(migrash / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} dunam` : dash} hint="1 dunam = 1,000 m²" />
        <Calc label="Migrash in acres" value={migrash != null ? `${(migrash * ACRES_PER_SQM).toLocaleString("en-US", { maximumFractionDigits: 3 })} acres` : dash} hint="1 acre = 4,046.86 m²" />
        <Row label="Private pool?">
          <Select name="housePool" value={pool} options={["Yes", "No"]} onChange={setPool} />
        </Row>
        {pool === "Yes" && (
          <Row label="Pool size (m²)">
            <NumberInput name="housePoolSqm" defaultValue={h.poolSqm} />
          </Row>
        )}
      </Group>

      <Group title="Pricing">
        <Row label="Asking price">
          <NumberInput name="priceNis" defaultValue={h.priceNis} decimals={false} onValue={setPrice} prefix="₪" />
        </Row>
        <Calc label="Asking price in dollars" value={usd(price) ?? dash} hint={fxNote} />
        <Calc label="Price per meter in shekels" value={ppm != null ? nis(ppm) : dash} hint={PRICE_PER_METER_NOTE} />
        <Calc label="Dollars per square foot" value={perSqft != null ? `$${perSqft.toLocaleString("en-US")}` : dash} hint={`asking price in dollars ÷ square feet (internal + ⅓ of the mirpeset), ${fxNote}`} />
      </Group>

      <Group title="Notes">
        <Row label="Description">
          <textarea name="description" rows={4} defaultValue={h.description ?? ""} className="input" />
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
