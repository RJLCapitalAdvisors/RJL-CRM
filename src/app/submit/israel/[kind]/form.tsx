"use client";

import { useRef, useState } from "react";
import { Calc, Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { Directions, MirpasotFields } from "@/components/mirpasot-fields";
import { IL_AMENITIES, IL_APARTMENT_LEVELS, IL_APARTMENT_TYPES, IL_CITIES, IL_HOUSE_TYPES, IL_MACHSAN_LOCATIONS, IL_PARKING, IL_SELLER_TYPES, feet, isGardenApartment, isSecondHand, sqft } from "@/lib/israel";

type Kind = "apartment" | "house" | "project";
const ROOMS = Array.from({ length: 23 }, (_, i) => String(1 + i / 2));
const BATHROOMS = Array.from({ length: 19 }, (_, i) => String(1 + i / 2));
const FLOORS = Array.from({ length: 101 }, (_, k) => String(k));
const STORIES = Array.from({ length: 100 }, (_, k) => String(k + 1));
const FLOOR_NAMES = ["Ground floor", "First floor", "Second floor", "Third floor", "Fourth floor", "Fifth floor", "Sixth floor", "Seventh floor"];
const dash = "—";

/** A file drop zone: click or drag files in; shows what was picked. */
function Drop({ name, label, hint, accept, multiple = false, required = false }: { name: string; label: string; hint: string; accept: string; multiple?: boolean; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const pick = (list: FileList | null) => {
    if (!list || !input.current) return;
    const dt = new DataTransfer();
    const existing = multiple ? Array.from(input.current.files ?? []) : [];
    for (const f of [...existing, ...Array.from(list)]) dt.items.add(f);
    input.current.files = dt.files;
    setNames(Array.from(dt.files).map((f) => f.name));
  };
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="mb-1 text-xs text-muted">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </div>
      <div
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-5 text-center text-sm ${drag ? "border-sky-600 bg-sky-50" : "border-line bg-paper hover:border-sky-600"}`}
      >
        {names.length ? <div className="text-ink">{names.join(", ")}</div> : <div className="text-muted">Drop {multiple ? "files" : "a file"} here or click to choose</div>}
        <div className="mt-1 text-[11px] text-muted">{hint}</div>
      </div>
      <input ref={input} type="file" name={name} accept={accept} multiple={multiple} className="hidden" onChange={(e) => { setNames(Array.from(e.target.files ?? []).map((f) => f.name)); }} />
    </div>
  );
}
const Req = () => <span className="ml-1 text-red-600">*</span>;
const City = ({ id }: { id: string }) => (
  <>
    <input name="city" required className="input" list={id} placeholder="Jerusalem" />
    <datalist id={id}>{IL_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
  </>
);
const Month = ({ name }: { name: string }) => <input type="month" name={name} required className="input" />;

/**
 * The three public forms in one component: the same field names the tickets post, so the submission is read exactly
 * as a ticket is. Every field on the Required Items List is marked and the server refuses a submission with anything
 * on the list blank; the list it sends back is shown at the top.
 */
export function SubmissionForm({ kind, required }: { kind: Kind; required: string[] }) {
  const [state, setState] = useState<{ busy: boolean; missing: string[]; error: string | null; done: { id: string; name: string } | null }>({ busy: false, missing: [], error: null, done: null });
  const [internal, setInternal] = useState<number | null>(null);
  const [mirpeset, setMirpeset] = useState<number | null>(null);
  const [levels, setLevels] = useState("1");
  const [aptType, setAptType] = useState("");
  const [sellerType, setSellerType] = useState("");
  const [pool, setPool] = useState("");
  const [machsan, setMachsan] = useState("");
  const [floors, setFloors] = useState<number | null>(null);
  const [ceiling, setCeiling] = useState<number | null>(null);
  const [migrash, setMigrash] = useState<number | null>(null);
  const levelCount = Number(levels) > 1 ? Number(levels) : 1;
  const floorCount = Math.min(Math.max(Math.trunc(floors ?? 0), 0), 8);
  const garden = isGardenApartment(aptType);
  const noun = kind === "apartment" ? "apartment" : kind === "house" ? "house" : "project";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    setState((s) => ({ ...s, busy: true, error: null, missing: [] }));
    const fd = new FormData(form);
    fd.set("kind", kind);
    try {
      const r = await fetch("/api/submit/israel", { method: "POST", body: fd });
      const j = (await r.json()) as { ok: boolean; id?: string; name?: string; missing?: string[]; error?: string };
      if (j.ok && j.id) {
        setState({ busy: false, missing: [], error: null, done: { id: j.id, name: j.name ?? "" } });
        window.scrollTo({ top: 0 });
      } else {
        setState({ busy: false, missing: j.missing ?? [], error: j.error ?? (j.missing?.length ? "A few things are still missing; please fill them in and submit again." : "Something went wrong."), done: null });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setState((s) => ({ ...s, busy: false, error: "The submission could not be sent. Please check your connection and try again." }));
    }
  };

  if (state.done)
    return (
      <div className="card p-8 text-center">
        <div className="text-xl font-semibold">Thank you</div>
        <p className="mt-2 text-sm text-ink-soft">
          {state.done.name ? <>&ldquo;{state.done.name}&rdquo; has been submitted. </> : "Your submission has been received. "}
          Our team reviews every {noun} and will come back to you.
        </p>
        <button type="button" className="btn-secondary mt-6 px-4" onClick={() => window.location.reload()}>
          Submit another {noun}
        </button>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      {(state.error || state.missing.length > 0) && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-semibold">{state.error ?? "A few things are still missing"}</div>
          {state.missing.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="card p-4 text-xs text-muted">
        <div className="mb-1 font-semibold text-ink">What a complete {noun} submission carries</div>
        <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {required.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      </div>

      <div className="card px-4 py-2">
        <Group title="About you">
          <Row label="Your name">
            <input name="submitterName" required className="input" />
          </Row>
          <Row label="Email">
            <input name="submitterEmail" type="email" required className="input" />
          </Row>
          <Row label="Phone">
            <input name="submitterPhone" type="tel" required className="input" placeholder="05x-xxx-xxxx" />
          </Row>
          <Row label="Company">
            <input name="submitterCompany" className="input" placeholder="Your agency or firm" />
          </Row>
          <Row label="You are the">
            <Select name="submitterRole" value="" options={["Broker", "Developer", "Owner", "Attorney", "Other"]} />
          </Row>
        </Group>
      </div>

      {kind === "project" && (
        <div className="card px-4 py-2">
          <Group title="Project">
            <Row label="Project name">
              <input name="name" required className="input" placeholder="Rehavia Gardens" />
            </Row>
            <Row label="Developer (yazam)" hint="The company building or selling it.">
              <input name="developerName" required className="input" />
            </Row>
            <Row label="Address" hint="Street and house number, enough to find on Google Maps.">
              <input name="street" required className="input" placeholder="Ramban 12" />
            </Row>
            <Row label="City">
              <City id="il-cities-pr" />
            </Row>
            <Row label="Neighborhood">
              <input name="neighborhood" required className="input" />
            </Row>
          </Group>
          <Group title="Building">
            <Row label="Total units in the project">
              <NumberInput name="totalUnits" decimals={false} />
            </Row>
            <Row label="Building stories (floors per building)">
              <Select name="stories" value="" options={STORIES} />
            </Row>
            <Row label="Parking spaces (how many in the project)">
              <NumberInput name="parkingSpaces" decimals={false} />
            </Row>
            <Row label="Parking configuration" hint="Underground or open; one or two per unit.">
              <input name="parkingNote" className="input" />
            </Row>
            <Row label="Amenities" hint="Yes or No for each.">
              <input type="hidden" name="amenitiesSet" value="1" />
              <div className="grid gap-x-6 gap-y-1 py-1 sm:grid-cols-2">
                {IL_AMENITIES.map((a) => (
                  <label key={a} className="flex items-center justify-between gap-2 text-sm">
                    <span>{a}</span>
                    <select name={`amenity:${a}`} required defaultValue="" className="input w-24 py-1 text-xs">
                      <option value="">—</option>
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </label>
                ))}
              </div>
            </Row>
            <Row label="Expected delivery (month and year)">
              <Month name="completionDate" />
            </Row>
            <Row label="Description" hint="Anything else buyers should know.">
              <textarea name="description" rows={4} className="input" />
            </Row>
          </Group>
          <Group title="Files">
            <Drop name="documents" label="Brochure (PDF)" hint="The project brochure; price lists and plans too." accept="application/pdf,.pdf" multiple required />
            <Drop name="photos" label="Renderings and pictures" hint="JPG, PNG or WebP, several at once." accept="image/*" multiple />
          </Group>
        </div>
      )}

      {kind === "apartment" && (
        <div className="card px-4 py-2">
          <Group title="Apartment">
            <Row label="Listing name" hint="The project and unit, e.g. Rehavia Gardens, Apt 12.">
              <input name="name" required className="input" />
            </Row>
            <Row label="Developer (yazam)" hint="The company building or selling it.">
              <input name="developerName" required className="input" />
            </Row>
            <Row label="Project name" hint={sellerType.startsWith("Yad Rishona") ? "A yad rishona apartment is filed under its project." : "The building or development it is in, if any."}>
              <input name="projectName" required={sellerType.startsWith("Yad Rishona")} className="input" />
            </Row>
            <Row label="Building address" hint="Street and house number, enough to find on Google Maps.">
              <input name="street" required className="input" placeholder="Ramban 12" />
            </Row>
            <Row label="City">
              <City id="il-cities-apt" />
            </Row>
            <Row label="Neighborhood">
              <input name="neighborhood" required className="input" />
            </Row>
            <Row label="Apartment type">
              <Select name="apartmentType" value={aptType} options={IL_APARTMENT_TYPES} onChange={setAptType} />
            </Row>
            <Row label="Type / degem" hint="The unit type code on the plans, e.g. UA1, D, PH4 (optional).">
              <Text name="degem" />
            </Row>
            <Row label="Rooms">
              <Select name="rooms" value="" options={ROOMS} />
            </Row>
            <Row label="Bathrooms" hint="Full bathrooms; a toilet room alone counts as a half.">
              <Select name="bathrooms" value="" options={BATHROOMS} />
            </Row>
            <Row label="Year of construction or expected delivery (month and year)">
              <Month name="completionDate" />
            </Row>
            <Row label="Apartment levels" hint="One for a regular apartment; two or three for a duplex or triplex.">
              <Select name="levels" value={levels} options={IL_APARTMENT_LEVELS} noBlank onChange={setLevels} />
            </Row>
            <Row label={levelCount > 1 ? "Lowest floor" : "Apartment floor"} hint="0 is the ground floor.">
              <Select name="floor" value="" options={FLOORS} />
            </Row>
            <Row label="Total stories in the building">
              <Select name="totalFloors" value="" options={STORIES} />
            </Row>
            <Row label="Total units in the building">
              <NumberInput name="buildingUnits" decimals={false} />
            </Row>
            <Row label="Apartment direction" hint="Which way the windows face; tick every direction.">
              <Directions name="direction" chosen={[]} />
            </Row>
            <Row label="Mamad">
              <Select name="mamad" value="" options={["Yes", "No"]} />
            </Row>
            <Row label="Seller type">
              <Select name="sellerType" value={sellerType} options={IL_SELLER_TYPES} onChange={setSellerType} />
            </Row>
            {isSecondHand(sellerType) && (
              <Row label="Year of renovation" hint="Leave blank if never renovated.">
                <NumberInput name="renovationYear" decimals={false} />
              </Row>
            )}
          </Group>
          <Group title="Size">
            <Row label="Internal m²" hint="Without the mirpeset.">
              <NumberInput name="internalSqm" onValue={setInternal} />
            </Row>
            <Calc label="Internal square feet" value={internal != null ? sqft(internal) : dash} />
            <MirpasotFields count={null} sqm={null} directions={[]} mirpasot={[]} onTotal={setMirpeset} noun={garden ? "Garden" : "Mirpeset"} plural={garden ? "gardens" : "mirpasot"} />
            <Row label="Private pool?">
              <Select name="pool" value={pool} options={["Yes", "No"]} onChange={setPool} />
            </Row>
            {pool === "Yes" && (
              <Row label="Pool size (m²)">
                <NumberInput name="poolSqm" />
              </Row>
            )}
            {levelCount > 1 ? (
              Array.from({ length: levelCount }, (_, k) => (
                <Row key={k} label={`${levelCount === 2 ? ["Lower level", "Upper level"][k] : ["Lower level", "Middle level", "Upper level"][k]} ceiling (cm)`}>
                  <NumberInput name="ceilingCm" />
                </Row>
              ))
            ) : (
              <>
                <Row label="Ceiling height (cm)">
                  <NumberInput name="ceilingCm" onValue={setCeiling} />
                </Row>
                <Calc label="Ceiling height in feet" value={ceiling != null ? feet(ceiling) : dash} />
              </>
            )}
            <Row label="Parking spots">
              <Select name="parkingSpots" value="" options={IL_PARKING} />
            </Row>
            <Row label="Parking configuration" hint="Underground or open.">
              <input name="parkingNote" className="input" />
            </Row>
            <Row label="Machsan (storage room)?">
              <Select name="machsan" value={machsan} options={["Yes", "No"]} onChange={setMachsan} />
            </Row>
            {machsan === "Yes" && (
              <>
                <Row label="Machsan size (m²)">
                  <NumberInput name="machsanSqm" />
                </Row>
                <Row label="Machsan location">
                  <Select name="machsanLocation" value="" options={IL_MACHSAN_LOCATIONS} />
                </Row>
              </>
            )}
          </Group>
          <Group title="Pricing">
            <Row label="Asking price (NIS)">
              <NumberInput name="priceNis" decimals={false} prefix="₪" />
            </Row>
            <Row label="Description" hint="Anything else buyers should know.">
              <textarea name="description" rows={4} className="input" />
            </Row>
          </Group>
          <Group title="Files">
            <Drop name="floorplan" label="Floorplan" hint="A picture or PDF of the unit's plan." accept="image/*,application/pdf,.pdf" required />
            <Drop name="photos" label="Pictures" hint="JPG, PNG or WebP, several at once." accept="image/*" multiple />
            <Drop name="documents" label="Other documents" hint="Brochure, price list, specifications (PDF)." accept="application/pdf,.pdf" multiple />
          </Group>
        </div>
      )}

      {kind === "house" && (
        <div className="card px-4 py-2">
          <Group title="House">
            <Row label="Listing name" hint="e.g. Katamon cottage, HaPalmach 8.">
              <input name="name" required className="input" />
            </Row>
            <Row label="House type">
              <Select name="houseType" value="" options={IL_HOUSE_TYPES} />
            </Row>
            <Row label="Developer (yazam)" hint="The company building or selling it; leave blank for a second-hand sale.">
              <input name="developerName" className="input" />
            </Row>
            <Row label="Project name" hint="The development it is part of, if any.">
              <input name="projectName" className="input" />
            </Row>
            <Row label="Address" hint="Street and house number, enough to find on Google Maps.">
              <input name="street" required className="input" placeholder="HaPalmach 8" />
            </Row>
            <Row label="City">
              <City id="il-cities-house" />
            </Row>
            <Row label="Neighborhood">
              <input name="neighborhood" required className="input" />
            </Row>
            <Row label="Rooms">
              <Select name="rooms" value="" options={ROOMS} />
            </Row>
            <Row label="How many floors (miflasim)" hint="A ceiling height appears for each.">
              <NumberInput name="floors" decimals={false} onValue={setFloors} />
            </Row>
            {Array.from({ length: floorCount }, (_, i) => (
              <Row key={i} label={`${FLOOR_NAMES[i] ?? `Floor ${i + 1}`} ceiling (cm)`}>
                <NumberInput name="ceilingCm" />
              </Row>
            ))}
            <Row label="Built or expected delivery (month and year)">
              <Month name="completionDate" />
            </Row>
            <Row label="Parking">
              <Select name="parkingSpots" value="" options={IL_PARKING} />
            </Row>
            <Row label="Parking configuration" hint="Covered or open.">
              <input name="parkingNote" className="input" />
            </Row>
            <Row label="Seller type">
              <Select name="sellerType" value={sellerType} options={IL_SELLER_TYPES} onChange={setSellerType} />
            </Row>
            {isSecondHand(sellerType) && (
              <Row label="Year of renovation" hint="Leave blank if never renovated.">
                <NumberInput name="renovationYear" decimals={false} />
              </Row>
            )}
            <Row label="Mamad">
              <Select name="mamad" value="" options={["Yes", "No"]} />
            </Row>
          </Group>
          <Group title="Size">
            <Row label="Internal m²">
              <NumberInput name="internalSqm" onValue={setInternal} />
            </Row>
            <Calc label="Internal square feet" value={internal != null ? sqft(internal) : dash} />
            <MirpasotFields count={null} sqm={null} directions={[]} mirpasot={[]} onTotal={setMirpeset} />
            <Row label="Migrash (plot) size (m²)">
              <NumberInput name="migrashSqm" onValue={setMigrash} />
            </Row>
            <Calc label="Migrash in dunam" value={migrash != null ? `${(migrash / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} dunam` : dash} hint="1 dunam = 1,000 m²" />
            <Row label="Private pool?">
              <Select name="housePool" value={pool} options={["Yes", "No"]} onChange={setPool} />
            </Row>
            {pool === "Yes" && (
              <Row label="Pool size (m²)">
                <NumberInput name="housePoolSqm" />
              </Row>
            )}
          </Group>
          <Group title="Pricing">
            <Row label="Asking price (NIS)">
              <NumberInput name="priceNis" decimals={false} prefix="₪" />
            </Row>
            <Row label="Description" hint="Anything else buyers should know.">
              <textarea name="description" rows={4} className="input" />
            </Row>
          </Group>
          <Group title="Files">
            <Drop name="floorplan" label="Floorplan" hint="A picture or PDF of the house's plan." accept="image/*,application/pdf,.pdf" required />
            <Drop name="photos" label="Pictures" hint="JPG, PNG or WebP, several at once." accept="image/*" multiple />
            <Drop name="documents" label="Other documents" hint="Brochure, specifications (PDF)." accept="application/pdf,.pdf" multiple />
          </Group>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pb-6">
        <div className="text-[11px] text-muted">
          <Req /> every field on the list above is required; the form will tell you what is still missing. {mirpeset != null ? "" : ""}
        </div>
        <button type="submit" disabled={state.busy} className="btn-primary px-6 py-2">
          {state.busy ? "Sending…" : `Submit ${noun}`}
        </button>
      </div>
    </form>
  );
}
