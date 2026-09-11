"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Calc, Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { SelectField } from "@/components/select-field";
import { IL_APARTMENT_LEVELS, IL_CITIES, IL_MACHSAN_LOCATIONS, IL_PARKING, IL_SELLER_TYPES, PRICE_PER_METER_NOTE, feet, isSecondHand, nis, parseJsonList, parseMirpasot, pricePerMeter, sqft, usdFmt, usdPerSqft } from "@/lib/israel";
import { Directions, MirpasotFields } from "@/components/mirpasot-fields";
import type { FxRate } from "@/lib/fx";

/** Floors as dropdowns: 0 is the ground floor (קומת קרקע), then 1 to 100. */
const FLOORS = Array.from({ length: 101 }, (_, k) => String(k));
const STORIES = Array.from({ length: 100 }, (_, k) => String(k + 1));

export type IlApartmentForm = Partial<{
  name: string; projectId: string | null; street: string | null; city: string | null; neighborhood: string | null; rooms: number | null; completionDate: string | null; floor: number | null; totalFloors: number | null; buildingUnits: number | null;
  internalSqm: number | null; mirpesetSqm: number | null; mirpesetCount: number | null; mirpasot: string | null; levels: number | null; ceilingCms: string | null; ceilingCm: number | null; machsanSqm: number | null; machsanLocation: string | null; parkingSpots: string | null; direction: string | null; mirpesetDirection: string | null; mamad: boolean;
  priceNis: number | null; sellerType: string | null; renovationYear: number | null; description: string | null;
}>;

/** The apartment ticket, laid out like a deal ticket: one straight column of fields with the conversions computed beside them. */
export function ApartmentForm({ a = {}, fx, projects = [], action, autosave = false, submitLabel = "Create apartment" }: { a?: IlApartmentForm; fx: FxRate | null; projects?: { id: string; name: string; city: string | null }[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [internal, setInternal] = useState<number | null>(a.internalSqm ?? null);
  const [mirpeset, setMirpeset] = useState<number | null>(a.mirpesetSqm ?? null);
  const [ceiling, setCeiling] = useState<number | null>(a.ceilingCm ?? null);
  const [levels, setLevels] = useState(a.levels ? String(a.levels) : "");
  const levelCount = Number(levels) > 1 ? Number(levels) : 1;
  const [levelCeilings, setLevelCeilings] = useState<(number | null)[]>(() => parseJsonList(a.ceilingCms).map((x) => (x === "" ? null : Number(x))));
  const setLevelCeiling = (k: number, v: number | null) =>
    setLevelCeilings((cur) => {
      const next = [...cur];
      while (next.length < levelCount) next.push(null);
      next[k] = v;
      return next;
    });
  const LEVEL = ["Lower level", "Middle level", "Upper level"];
  const levelName = (k: number) => (levelCount === 2 ? ["Lower level", "Upper level"][k] : LEVEL[k]) ?? `Level ${k + 1}`;
  const [machsan, setMachsan] = useState<number | null>(a.machsanSqm ?? null);
  const [price, setPrice] = useState<number | null>(a.priceNis ?? null);
  const [sellerType, setSellerType] = useState(a.sellerType ?? "");
  const perSqft = usdPerSqft(price, internal, mirpeset, fx?.ilsPerUsd);
  const ppm = pricePerMeter(price, internal, mirpeset);
  const usd = (v: number | null) => (v != null && fx ? usdFmt(v / fx.ilsPerUsd) : null);
  const fxNote = fx ? `at ₪${fx.ilsPerUsd.toFixed(3)} per $ (ECB, ${fx.date})` : "exchange rate unavailable right now";
  const dash = "—";
  const dirs = parseJsonList(a.direction);
  const mDirs = parseJsonList(a.mirpesetDirection);

  const body = (
    <>
      <Group title="Apartment">
        <Row label="Name">
          <Text name="name" value={a.name} placeholder="Rehavia Gardens, Apt 12" />
        </Row>
        <Row label="Project" hint="The building or development this apartment is in. Projects are listed under Projects.">
          <SelectField name="projectId" defaultValue={a.projectId ?? ""}>
            <option value="">No project</option>
            {projects.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name}
                {pr.city ? ` · ${pr.city}` : ""}
              </option>
            ))}
          </SelectField>
        </Row>
        <Row label="Building address">
          <Text name="street" value={a.street} placeholder="Ramban 12" />
        </Row>
        <Row label="City">
          <input name="city" defaultValue={a.city ?? ""} className="input" list="il-cities" />
          <datalist id="il-cities">{IL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Row>
        <Row label="Neighborhood">
          <Text name="neighborhood" value={a.neighborhood} />
        </Row>
        <Row label="Rooms">
          <NumberInput name="rooms" defaultValue={a.rooms} />
        </Row>
        <Row label="Year of construction / expected date of delivery" hint="Month and year for a new build, e.g. 06/2027. Year alone for an existing building.">
          <Text name="completionDate" value={a.completionDate} placeholder="06/2027" />
        </Row>
        <Row label="Apartment floors (levels)" hint="One for a regular apartment. Two or three for a duplex or triplex; each level then gets its own ceiling height.">
          <Select name="levels" value={levels} options={IL_APARTMENT_LEVELS} blank="1" onChange={setLevels} />
        </Row>
        <Row label={levelCount > 1 ? "Lowest floor" : "Apartment floor"} hint={levelCount > 1 ? `The apartment spans this floor and the ${levelCount - 1} above it.` : undefined}>
          <Select name="floor" value={a.floor == null ? "" : String(a.floor)} options={FLOORS} />
        </Row>
        <Row label="Building stories">
          <Select name="totalFloors" value={a.totalFloors == null ? "" : String(a.totalFloors)} options={STORIES} />
        </Row>
        <Row label="Total building units">
          <NumberInput name="buildingUnits" defaultValue={a.buildingUnits} decimals={false} />
        </Row>
        <Row label="Apartment direction">
          <Directions name="direction" chosen={dirs} />
        </Row>
        <Row label="Mamad">
          <Select name="mamad" value={a.mamad == null ? "" : a.mamad ? "Yes" : "No"} options={["Yes", "No"]} />
        </Row>
        <Row label="Seller type">
          <Select name="sellerType" value={sellerType} options={IL_SELLER_TYPES} onChange={setSellerType} />
        </Row>
        {isSecondHand(sellerType) && (
          <Row label="Year of renovation" hint="Leave blank if never renovated.">
            <NumberInput name="renovationYear" defaultValue={a.renovationYear} decimals={false} />
          </Row>
        )}
      </Group>

      <Group title="Size">
        <Row label="Internal m²">
          <NumberInput name="internalSqm" defaultValue={a.internalSqm} onValue={setInternal} />
        </Row>
        <Calc label="Internal square feet" value={internal != null ? sqft(internal) : dash} />
        <MirpasotFields count={a.mirpesetCount} sqm={a.mirpesetSqm} directions={mDirs} mirpasot={parseMirpasot(a.mirpasot)} onTotal={setMirpeset} />
        {levelCount > 1 ? (
          Array.from({ length: levelCount }, (_, k) => (
            <div key={k} className="contents">
              <Row label={`${levelName(k)} ceiling (cm)`}>
                <NumberInput name="ceilingCm" defaultValue={levelCeilings[k] ?? (k === 0 ? a.ceilingCm : null)} onValue={(v) => setLevelCeiling(k, v)} />
              </Row>
              <Calc label={`${levelName(k)} ceiling in feet`} value={(levelCeilings[k] ?? (k === 0 ? a.ceilingCm : null)) != null ? feet(levelCeilings[k] ?? a.ceilingCm) : dash} />
            </div>
          ))
        ) : (
          <>
            <Row label="Ceiling height (cm)">
              <NumberInput name="ceilingCm" defaultValue={a.ceilingCm} onValue={setCeiling} />
            </Row>
            <Calc label="Ceiling height in feet" value={ceiling != null ? feet(ceiling) : dash} />
          </>
        )}
        <Row label="Parking spots">
          <Select name="parkingSpots" value={a.parkingSpots ?? ""} options={IL_PARKING} />
        </Row>
        <Row label="Machsan size (m²)">
          <NumberInput name="machsanSqm" defaultValue={a.machsanSqm} onValue={setMachsan} />
        </Row>
        <Calc label="Machsan square feet" value={machsan != null ? sqft(machsan) : dash} />
        <Row label="Machsan location">
          <Select name="machsanLocation" value={a.machsanLocation ?? ""} options={IL_MACHSAN_LOCATIONS} />
        </Row>
      </Group>

      <Group title="Pricing">
        <Row label="Asking price">
          <NumberInput name="priceNis" defaultValue={a.priceNis} decimals={false} onValue={setPrice} prefix="₪" />
        </Row>
        <Calc label="Asking price in dollars" value={usd(price) ?? dash} hint={fxNote} />
        <Calc label="Price per meter" value={ppm != null ? nis(ppm) : dash} hint={PRICE_PER_METER_NOTE} />
        <Calc label="Dollars per square foot" value={perSqft != null ? `$${perSqft.toLocaleString("en-US")}` : dash} hint={`asking price in dollars ÷ square feet (internal + ⅓ of the mirpeset), ${fxNote}`} />
      </Group>

      <Group title="Notes">
        <Row label="Description">
          <textarea name="description" rows={4} defaultValue={a.description ?? ""} className="input" />
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
