"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { AQ_ASSET_TYPES, parseJsonList } from "@/lib/acquisitions";
import { US_STATES } from "@/lib/taxonomy";

type Pr = Partial<{
  address: string;
  city: string | null;
  state: string | null;
  county: string | null;
  businessName: string | null;
  assetType: string | null;
  parcelId: string | null;
  acreage: number | null;
  squareFeet: number | null;
  yearBuilt: number | null;
  lastSaleDate: Date | string | null;
  lastSalePrice: number | null;
  assessedValue: number | null;
  zoning: string | null;
  category: string | null;
  googleRating: number | null;
  reviewCount: number | null;
  reportUrl: string | null;
  sourceList: string | null;
  stages: string;
  dealStage: string | null;
}>;

const toDateInput = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const STATE_CODES = Object.keys(US_STATES);
const maps = (q: string | null | undefined) => (q?.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null);

function AddressInput({ name, value, placeholder }: { name: string; value?: string | null; placeholder?: string }) {
  const [v, setV] = useState(value ?? "");
  const href = maps(v);
  return (
    <div className="flex items-center gap-2">
      <input name={name} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="input flex-1" autoComplete="street-address" />
      {href && (
        <a href={href} target="_blank" className="shrink-0 text-xs text-sky-700 hover:underline" title="Open in Google Maps">
          Maps
        </a>
      )}
    </div>
  );
}

function UrlInput({ name, value }: { name: string; value?: string | null }) {
  const [v, setV] = useState(value ?? "");
  const href = v.trim() ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null;
  return (
    <div className="flex items-center gap-2">
      <input name={name} value={v} onChange={(e) => setV(e.target.value)} placeholder="https://…" className="input flex-1" />
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-sky-700 hover:underline">
          Open
        </a>
      )}
    </div>
  );
}

/**
 * The left side of a property ticket (Sep 22, 2026): the property itself, the physical facts and last sale, the call
 * list's extra columns (Oct 5, 2026: assessed value, zoning, category, Google rating and reviews, the property report
 * link, the source list), and whether it is an active deal on the Deals board (the Deal tick and its stage). A
 * potential deal is sent to the Deals Pipeline list with the token in the header. The people (owners, operators) are
 * contact cards linked on the right; calls, notes and transcripts are tracked on them.
 */
export function AqPropertyForm({ p = {}, dealStages, action, autosave = false, submitLabel = "Create property" }: { p?: Pr; dealStages: string[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [deal, setDeal] = useState(parseJsonList(p.stages).includes("Deal"));
  const body = (
    <>
      <Group title="Property">
        <Row label="Property Address" hint="Street address. The map on the right follows it.">
          <AddressInput name="address" value={p.address} placeholder="1234 Bedford Avenue" />
        </Row>
        <Row label="City">
          <Text name="city" value={p.city} />
        </Row>
        <Row label="State">
          <Select name="state" value={p.state ?? ""} options={STATE_CODES} blank="—" />
        </Row>
        <Row label="County">
          <Text name="county" value={p.county} placeholder="Kings" />
        </Row>
        <Row label="Current Business Name" hint="The business operating there today.">
          <Text name="businessName" value={p.businessName} />
        </Row>
        <Row label="Category" hint="What kind of business: Auto repair, Tire shop, Oil change…">
          <Text name="category" value={p.category} placeholder="Auto repair" />
        </Row>
        <Row label="Asset Type">
          <Select name="assetType" value={(AQ_ASSET_TYPES as readonly string[]).includes(p.assetType ?? "") ? p.assetType! : ""} options={AQ_ASSET_TYPES} blank="—" />
        </Row>
        <Row label="Parcel ID">
          <Text name="parcelId" value={p.parcelId} />
        </Row>
        <Row label="Zoning">
          <Text name="zoning" value={p.zoning} placeholder="B-2" />
        </Row>
      </Group>
      <Group title="Physical and last sale">
        <Row label="Acreage">
          <NumberInput name="acreage" defaultValue={p.acreage} />
        </Row>
        <Row label="Gross SF">
          <NumberInput name="squareFeet" defaultValue={p.squareFeet} decimals={false} />
        </Row>
        <Row label="Year Built">
          <input name="yearBuilt" type="number" min={1700} max={2100} defaultValue={p.yearBuilt ?? ""} className="input w-32" placeholder="1965" />
        </Row>
        <Row label="Last Sale Date">
          <input type="date" name="lastSaleDate" defaultValue={toDateInput(p.lastSaleDate)} className="input" />
        </Row>
        <Row label="Last Sale Price">
          <NumberInput name="lastSalePrice" defaultValue={p.lastSalePrice} decimals={false} prefix="$" />
        </Row>
        <Row label="Assessed Value">
          <NumberInput name="assessedValue" defaultValue={p.assessedValue} decimals={false} prefix="$" />
        </Row>
      </Group>
      <Group title="Online and source">
        <Row label="Google Rating" hint="0 to 5.">
          <input name="googleRating" type="number" min={0} max={5} step={0.1} defaultValue={p.googleRating ?? ""} className="input w-32" placeholder="4.3" />
        </Row>
        <Row label="# Reviews">
          <input name="reviewCount" type="number" min={0} defaultValue={p.reviewCount ?? ""} className="input w-32" />
        </Row>
        <Row label="Property Report Link">
          <UrlInput name="reportUrl" value={p.reportUrl} />
        </Row>
        <Row label="Source List" hint="The export this property came from.">
          <Text name="sourceList" value={p.sourceList} placeholder="Brick TK Export 9-26" />
        </Row>
      </Group>
      <Group title="Deals board">
        <Row label="Active deal" hint="Tick when this property is a deal; it sits on the Deals board in the stage below. A potential deal is sent to the Deals Pipeline list with the token above.">
          <label className="inline-flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" name="deal" value="1" checked={deal} onChange={(e) => setDeal(e.target.checked)} className="h-4 w-4 accent-ink" />
            Deal
          </label>
        </Row>
        {deal && (
          <Row label="Deal stage">
            <Select name="dealStage" value={p.dealStage && dealStages.includes(p.dealStage) ? p.dealStage : dealStages[0]} options={dealStages} noBlank />
          </Row>
        )}
      </Group>
    </>
  );
  if (autosave) return <AutoSaveForm action={action}>{body}</AutoSaveForm>;
  return (
    <form action={action} className="space-y-4">
      {body}
      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </form>
  );
}
