"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { BulletTextarea } from "@/components/bullet-textarea";
import { AQ_ASSET_TYPES, AQ_STAGES, lines, parseJsonList } from "@/lib/acquisitions";
import { US_STATES } from "@/lib/taxonomy";

type Pr = Partial<{
  address: string;
  city: string | null;
  state: string | null;
  businessName: string | null;
  assetType: string | null;
  parcelId: string | null;
  ownerEntity: string | null;
  ownerName: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  otherPhones: string | null;
  primaryEmail: string | null;
  emails: string | null;
  ownerMailingAddress: string | null;
  operatorEntity: string | null;
  operatorName: string | null;
  operatorPhone: string | null;
  operatorSecondaryPhone: string | null;
  operatorOtherPhones: string | null;
  operatorEmail: string | null;
  operatorEmails: string | null;
  operatorMailingAddress: string | null;
  acreage: number | null;
  squareFeet: number | null;
  yearBuilt: number | null;
  lastSaleDate: Date | string | null;
  lastSalePrice: number | null;
  lastCallDate: Date | string | null;
  stages: string;
  callBackAt: Date | string | null;
  followUpAt: Date | string | null;
  dealStage: string | null;
}>;

const toDateInput = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const STATE_CODES = Object.keys(US_STATES);
const maps = (q: string | null | undefined) => (q?.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null);

/** An address box with an Open in Google Maps link beside it. */
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

/**
 * The left side of a property ticket in RJL Acquisitions, in Jonathan's order (Sep 18, 2026): the property, the
 * owner and every way to reach them, the physical facts and last sale, then the call: Last Call Date, Call Result
 * (Callback asks for a target date that feeds the dashboard's Call Me Back window and the Follow Up Date; Wrong
 * number asks which number to drop), Follow Up Date. Call Notes and Transcripts are cards under this, newest on top.
 */
export function AqPropertyForm({ p = {}, dealStages, action, autosave = false, submitLabel = "Create property" }: { p?: Pr; dealStages: string[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const stages = parseJsonList(p.stages);
  const [result, setResult] = useState<string>(stages.find((s) => (AQ_STAGES as readonly string[]).includes(s)) ?? "");
  const [target, setTarget] = useState(toDateInput(p.callBackAt));
  const [followUp, setFollowUp] = useState(toDateInput(p.followUpAt ?? p.callBackAt));
  const [followUpTouched, setFollowUpTouched] = useState(Boolean(p.followUpAt && p.callBackAt && toDateInput(p.followUpAt) !== toDateInput(p.callBackAt)));
  const [owner, setOwner] = useState((p.ownerEntity ?? "").replace(/\s+LLC$/i, ""));
  const [phones, setPhones] = useState({ primary: p.primaryPhone ?? "", secondary: p.secondaryPhone ?? "" });
  const [others, setOthers] = useState(p.otherPhones ?? "");
  const [opPhones, setOpPhones] = useState({ primary: p.operatorPhone ?? "", secondary: p.operatorSecondaryPhone ?? "" });
  const [opOthers, setOpOthers] = useState(p.operatorOtherPhones ?? "");
  const numbers = [phones.primary, phones.secondary, ...lines(others), opPhones.primary, opPhones.secondary, ...lines(opOthers)].map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
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
        <Row label="Current Business Name" hint="The business operating there today.">
          <Text name="businessName" value={p.businessName} />
        </Row>
        <Row label="Asset Type">
          <Select name="assetType" value={(AQ_ASSET_TYPES as readonly string[]).includes(p.assetType ?? "") ? p.assetType! : ""} options={AQ_ASSET_TYPES} blank="—" />
        </Row>
        <Row label="Parcel ID">
          <Text name="parcelId" value={p.parcelId} />
        </Row>
      </Group>
      <Group title="Owner">
        <Row label="Property Owner" hint="The entity on title. LLC is added for you.">
          <div className="input flex items-center gap-1 p-0 pl-3">
            <input name="ownerEntity" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="1234 Bedford Avenue" className="min-w-0 flex-1 border-0 bg-transparent py-2 outline-none" />
            <span className="rounded-r-md border-l border-line bg-cream px-2 py-2 text-xs text-muted">LLC</span>
          </div>
        </Row>
        <Row label="Owner Name">
          <Text name="ownerName" value={p.ownerName} placeholder="The person behind the LLC" />
        </Row>
        <Row label="Primary Phone">
          <input name="primaryPhone" type="tel" value={phones.primary} onChange={(e) => setPhones((c) => ({ ...c, primary: e.target.value }))} placeholder="(718) 555-0100" className="input" />
        </Row>
        <Row label="Secondary Phone">
          <input name="secondaryPhone" type="tel" value={phones.secondary} onChange={(e) => setPhones((c) => ({ ...c, secondary: e.target.value }))} className="input" />
        </Row>
        <Row label="Other Phones" hint="One per line.">
          <div onInput={(e) => setOthers((e.currentTarget.querySelector("input[type=hidden]") as HTMLInputElement | null)?.value ?? "")}>
            <BulletTextarea name="otherPhones" value={p.otherPhones} placeholder="• (718) 555-0101" />
          </div>
        </Row>
        <Row label="Primary Email">
          <input name="primaryEmail" type="email" defaultValue={p.primaryEmail ?? ""} className="input" />
        </Row>
        <Row label="Email" hint="From public record. One per line.">
          <BulletTextarea name="emails" value={p.emails} placeholder="• owner@example.com" />
        </Row>
        <Row label="Owner Mailing Address">
          <AddressInput name="ownerMailingAddress" value={p.ownerMailingAddress} placeholder="Street, city, state, zip" />
        </Row>
        <div className="px-1 text-[11px] text-muted">The owner becomes a contact with the role Owner (and the entity a company); phones and emails flow onto it.</div>
      </Group>
      <Group title="Operator">
        <Row label="Operator Company" hint="The business running at the property; the Current Business Name if left blank.">
          <Text name="operatorEntity" value={p.operatorEntity} placeholder={p.businessName ?? "The business at the property"} />
        </Row>
        <Row label="Operator Name">
          <Text name="operatorName" value={p.operatorName} placeholder="The person running the business" />
        </Row>
        <Row label="Primary Phone">
          <input name="operatorPhone" type="tel" value={opPhones.primary} onChange={(e) => setOpPhones((c) => ({ ...c, primary: e.target.value }))} className="input" />
        </Row>
        <Row label="Secondary Phone">
          <input name="operatorSecondaryPhone" type="tel" value={opPhones.secondary} onChange={(e) => setOpPhones((c) => ({ ...c, secondary: e.target.value }))} className="input" />
        </Row>
        <Row label="Other Phones" hint="One per line.">
          <div onInput={(e) => setOpOthers((e.currentTarget.querySelector("input[type=hidden]") as HTMLInputElement | null)?.value ?? "")}>
            <BulletTextarea name="operatorOtherPhones" value={p.operatorOtherPhones} placeholder="• (718) 555-0102" />
          </div>
        </Row>
        <Row label="Primary Email">
          <input name="operatorEmail" type="email" defaultValue={p.operatorEmail ?? ""} className="input" />
        </Row>
        <Row label="Email" hint="One per line.">
          <BulletTextarea name="operatorEmails" value={p.operatorEmails} placeholder="• operator@example.com" />
        </Row>
        <Row label="Operator Mailing Address">
          <AddressInput name="operatorMailingAddress" value={p.operatorMailingAddress} placeholder="Street, city, state, zip" />
        </Row>
        <div className="px-1 text-[11px] text-muted">The operator becomes a contact with the role Operator (and the business a company).</div>
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
      </Group>
      <Group title="Call">
        <Row label="Last Call Date">
          <input type="date" name="lastCallDate" defaultValue={toDateInput(p.lastCallDate)} className="input" />
        </Row>
        <Row label="Call Result" hint="Callback asks for the date to call; Deal puts the property in the pipeline; Wrong number drops a number.">
          <Select name="callResult" value={result} options={AQ_STAGES} blank="—" onChange={setResult} />
        </Row>
        {result === "Callback" && (
          <Row label="Callback target" hint="The dashboard's Call Me Back window shows this property from that day, with the numbers, until dismissed.">
            <input
              type="date"
              name="callBackAt"
              required
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                if (!followUpTouched) setFollowUp(e.target.value);
              }}
              className="input"
            />
          </Row>
        )}
        {result === "Wrong number" && (
          <Row label="Which number" hint="Removed from this property and from any linked contact carrying it.">
            <Select name="deletePhone" value="" options={numbers} blank={numbers.length ? "Pick the wrong number" : "No numbers on file"} />
          </Row>
        )}
        {result === "Deal" && (
          <Row label="Pipeline stage">
            <Select name="dealStage" value={p.dealStage && dealStages.includes(p.dealStage) ? p.dealStage : dealStages[0]} options={dealStages} noBlank />
          </Row>
        )}
        <Row label="Follow Up Date" hint="Filled from the callback target; type over it to change.">
          <input
            type="date"
            name="followUpAt"
            value={followUp}
            onChange={(e) => {
              setFollowUp(e.target.value);
              setFollowUpTouched(true);
            }}
            className="input"
          />
        </Row>
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
