import { parseJsonList, parseMirpasot, pricePerMeter, yearOf } from "@/lib/israel";

/**
 * What a project's units say about the project, as ranges. Every box fills itself from the apartments and houses
 * filed under the project, so the project ticket gets smarter as listings come in. Nothing here is typed by hand.
 */
export type Unit = {
  kind: "apartment" | "house";
  rooms: number | null;
  internalSqm: number | null;
  mirpesetSqm: number | null;
  mirpasot: string | null;
  priceNis: number | null;
  apartmentType?: string | null;
  floor?: number | null;
  floors?: number | null;
  ceilingCm?: number | null;
  ceilingCms?: string | null;
  parkingSpots: string | null;
  sellerType: string | null;
  completionDate: string | null;
  mamad: boolean | null;
  direction?: string | null;
  levels?: number | null;
  machsanSqm?: number | null;
  pendingApproval?: boolean;
};

export type Range = { min: number; max: number; n: number };
const range = (vals: (number | null | undefined)[]): Range | null => {
  const nums = vals.filter((v): v is number => typeof v === "number" && !isNaN(v));
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums), n: nums.length } : null;
};
const counts = (vals: (string | null | undefined)[]) => {
  const m = new Map<string, number>();
  for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function projectRanges(units: Unit[]) {
  const live = units.filter((u) => !u.pendingApproval);
  const ceilings = live.flatMap((u) => [u.ceilingCm ?? null, ...parseJsonList(u.ceilingCms).map((x) => (x === "" ? null : Number(x)))]);
  const sukka = live.flatMap((u) => parseMirpasot(u.mirpasot).map((m) => m.sukka));
  const years = live.map((u) => yearOf(u.completionDate));
  return {
    units: live.length,
    apartments: live.filter((u) => u.kind === "apartment").length,
    houses: live.filter((u) => u.kind === "house").length,
    pending: units.length - live.length,
    rooms: range(live.map((u) => u.rooms)),
    internalSqm: range(live.map((u) => u.internalSqm)),
    mirpesetSqm: range(live.map((u) => u.mirpesetSqm)),
    priceNis: range(live.map((u) => u.priceNis)),
    ppm: range(live.map((u) => pricePerMeter(u.priceNis, u.internalSqm, u.mirpesetSqm))),
    priceByRooms: priceByRooms(live),
    floor: range(live.map((u) => u.floor ?? null)),
    ceilingCm: range(ceilings),
    years: range(years),
    parking: counts(live.map((u) => u.parkingSpots)),
    sellerTypes: counts(live.map((u) => u.sellerType)),
    directions: counts(live.flatMap((u) => parseJsonList(u.direction))),
    mamad: live.filter((u) => u.mamad).length,
    sukkaYes: sukka.filter((s) => s === "Yes").length,
    sukkaPartial: sukka.filter((s) => s === "Partial").length,
    duplexes: live.filter((u) => (u.levels ?? 1) > 1).length,
    withMachsan: live.filter((u) => (u.machsanSqm ?? 0) > 0).length,
    deliveries: counts(live.map((u) => u.completionDate)),
  };
}

/**
 * The asking price the way Jonathan quotes a project (Sep 17): "3 rooms starting at X - until 6 room penthouses
 * starting at Y". The cheapest unit at the fewest rooms, then the cheapest at the most rooms, called penthouses when
 * every unit at that size is one. One size only: "4 rooms starting at X".
 */
export function priceByRooms(units: Unit[]): { minRooms: number; minFrom: number; maxRooms: number; maxFrom: number; maxPenthouse: boolean } | null {
  const priced = units.filter((u) => u.rooms != null && u.priceNis != null) as (Unit & { rooms: number; priceNis: number })[];
  if (!priced.length) return null;
  const byRooms = new Map<number, (typeof priced)[number][]>();
  for (const u of priced) byRooms.set(u.rooms, [...(byRooms.get(u.rooms) ?? []), u]);
  const sizes = [...byRooms.keys()].sort((a, b) => a - b);
  const lo = sizes[0], hi = sizes[sizes.length - 1];
  const from = (n: number) => Math.min(...byRooms.get(n)!.map((u) => u.priceNis));
  const top = byRooms.get(hi)!;
  return { minRooms: lo, minFrom: from(lo), maxRooms: hi, maxFrom: from(hi), maxPenthouse: top.every((u) => /penthouse/i.test(u.apartmentType ?? "")) };
}

export function priceRangeLine(r: ReturnType<typeof priceByRooms>, fmt: (n: number) => string): string | null {
  if (!r) return null;
  const roomsWord = (n: number) => (n === 1 ? "1 room" : `${n} rooms`);
  if (r.minRooms === r.maxRooms) return `${roomsWord(r.minRooms)} starting at ${fmt(r.minFrom)}`;
  const top = r.maxPenthouse ? `${r.maxRooms} room penthouses` : roomsWord(r.maxRooms);
  return `${roomsWord(r.minRooms)} starting at ${fmt(r.minFrom)} - until ${top} starting at ${fmt(r.maxFrom)}`;
}
