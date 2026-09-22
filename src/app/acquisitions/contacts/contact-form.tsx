"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { SelectField } from "@/components/select-field";
import { BulletTextarea } from "@/components/bullet-textarea";
import { AQ_OPERATOR_STATUSES, AQ_ROLES, AQ_STAGES, aqRoleColor, lines, parseJsonList } from "@/lib/acquisitions";

type Ct = Partial<{
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emails: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  otherPhones: string | null;
  mailingAddress: string | null;
  companyId: string | null;
  roles: string;
  notes: string | null;
  operatorBrandName: string | null;
  website: string | null;
  operatorEntityName: string | null;
  directoryOperatorName: string | null;
  storePhone: string | null;
  directoryOperatorPhone: string | null;
  operatorTotalLocations: number | null;
  operatorPipelineStatus: string | null;
  lastCallDate: Date | string | null;
  callResult: string | null;
  callBackAt: Date | string | null;
  followUpAt: Date | string | null;
}>;

const toDateInput = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const maps = (q: string | null | undefined) => (q?.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null);

/**
 * A contact in RJL Acquisitions (Sep 22, 2026): the role first (Owner, Operator, Buyer), then every way to reach the
 * person, the operator details when the role Operator is on, and the call: Last Call Date, Call Result (Callback
 * asks for the target date that feeds the dashboard's Call Me Back window and the Follow Up Date; Wrong number asks
 * which number to drop), Follow Up Date. Call Notes and Transcripts are cards under this on the contact page.
 */
export function AqContactForm({ c = {}, companies, propertyId, action, autosave = false, submitLabel = "Create contact" }: { c?: Ct; companies: { id: string; name: string }[]; propertyId?: string | null; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [roles, setRoles] = useState<string[]>(parseJsonList(c.roles));
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const operator = roles.includes("Operator");
  const [phones, setPhones] = useState({ primary: c.phone ?? "", secondary: c.secondaryPhone ?? "", store: c.storePhone ?? "", directory: c.directoryOperatorPhone ?? "" });
  const [others, setOthers] = useState(c.otherPhones ?? "");
  const [result, setResult] = useState(c.callResult ?? "");
  const [target, setTarget] = useState(toDateInput(c.callBackAt));
  const [followUp, setFollowUp] = useState(toDateInput(c.followUpAt ?? c.callBackAt));
  const [followUpTouched, setFollowUpTouched] = useState(Boolean(c.followUpAt && c.callBackAt && toDateInput(c.followUpAt) !== toDateInput(c.callBackAt)));
  const [mailing, setMailing] = useState(c.mailingAddress ?? "");
  const numbers = [phones.primary, phones.secondary, ...lines(others), phones.store, phones.directory].map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  const body = (
    <>
      {propertyId && <input type="hidden" name="propertyId" value={propertyId} />}
      <Group title="Role">
        <Row label="This contact is a" hint="Owner of the real estate, operator of the business at it, or a buyer. A person at a company carries the company's roles as well.">
          <div className="flex flex-wrap gap-1.5 py-1">
            {AQ_ROLES.map((r) => {
              const on = roles.includes(r);
              return (
                <label key={r} className={`chip cursor-pointer text-[11px] ${on ? aqRoleColor(r) : "border border-dashed border-line bg-transparent text-muted hover:text-ink"}`}>
                  <input type="checkbox" name="roles" value={r} checked={on} onChange={() => toggle(r)} className="sr-only" />
                  {r}
                </label>
              );
            })}
          </div>
        </Row>
      </Group>
      <Group title="Contact">
        <Row label="First name">
          <Text name="firstName" value={c.firstName} />
        </Row>
        <Row label="Last name">
          <Text name="lastName" value={c.lastName} />
        </Row>
        <Row label="Company" hint="The owner's entity (the LLC) or the operator's business. New company from the Companies page.">
          <SelectField name="companyId" defaultValue={c.companyId ?? ""} className="input">
            <option value="">None</option>
            {companies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name}
              </option>
            ))}
          </SelectField>
        </Row>
        <Row label="Primary Phone">
          <input name="phone" type="tel" value={phones.primary} onChange={(e) => setPhones((p) => ({ ...p, primary: e.target.value }))} placeholder="(718) 555-0100" className="input" />
        </Row>
        <Row label="Secondary Phone">
          <input name="secondaryPhone" type="tel" value={phones.secondary} onChange={(e) => setPhones((p) => ({ ...p, secondary: e.target.value }))} className="input" />
        </Row>
        <Row label="Other Phones" hint="One per line.">
          <div onInput={(e) => setOthers((e.currentTarget.querySelector("input[type=hidden]") as HTMLInputElement | null)?.value ?? "")}>
            <BulletTextarea name="otherPhones" value={c.otherPhones} placeholder="• (718) 555-0101" />
          </div>
        </Row>
        <Row label="Primary Email">
          <input name="email" type="email" defaultValue={c.email ?? ""} className="input" />
        </Row>
        <Row label="Email" hint="Other emails, from public record. One per line.">
          <BulletTextarea name="emails" value={c.emails} placeholder="• owner@example.com" />
        </Row>
        <Row label="Mailing Address">
          <div className="flex items-center gap-2">
            <input name="mailingAddress" value={mailing} onChange={(e) => setMailing(e.target.value)} placeholder="Street, city, state, zip" className="input flex-1" />
            {maps(mailing) && (
              <a href={maps(mailing)!} target="_blank" className="shrink-0 text-xs text-sky-700 hover:underline">
                Maps
              </a>
            )}
          </div>
        </Row>
      </Group>
      {operator && (
        <Group title="Operator details">
          <Row label="Operator Brand Name">
            <Text name="operatorBrandName" value={c.operatorBrandName} placeholder="The name on the sign" />
          </Row>
          <Row label="Website">
            <Text name="website" value={c.website} placeholder="https://example.com" />
          </Row>
          <Row label="Operator Entity Name">
            <Text name="operatorEntityName" value={c.operatorEntityName} placeholder="The legal entity" />
          </Row>
          <Row label="Directory Operator Name">
            <Text name="directoryOperatorName" value={c.directoryOperatorName} />
          </Row>
          <Row label="Store Phone" hint="The store's public number, as on Google.">
            <input name="storePhone" type="tel" value={phones.store} onChange={(e) => setPhones((p) => ({ ...p, store: e.target.value }))} className="input" />
          </Row>
          <Row label="Directory Operator Phone">
            <input name="directoryOperatorPhone" type="tel" value={phones.directory} onChange={(e) => setPhones((p) => ({ ...p, directory: e.target.value }))} className="input" />
          </Row>
          <Row label="Operator Total Locations">
            <input name="operatorTotalLocations" type="number" min={0} defaultValue={c.operatorTotalLocations ?? ""} className="input w-32" />
          </Row>
          <Row label="Operator Pipeline Status">
            <Select name="operatorPipelineStatus" value={(AQ_OPERATOR_STATUSES as readonly string[]).includes(c.operatorPipelineStatus ?? "") ? c.operatorPipelineStatus! : ""} options={AQ_OPERATOR_STATUSES} blank="—" />
          </Row>
        </Group>
      )}
      <Group title="Call">
        <Row label="Last Call Date">
          <input type="date" name="lastCallDate" defaultValue={toDateInput(c.lastCallDate)} className="input" />
        </Row>
        <Row label="Call Result" hint="Callback asks for the date to call; Wrong number drops a number.">
          <Select name="callResult" value={result} options={AQ_STAGES} blank="—" onChange={setResult} />
        </Row>
        {result === "Callback" && (
          <Row label="Callback target" hint="The dashboard's Call Me Back window shows this person from that day, with the numbers, until dismissed.">
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
          <Row label="Which number" hint="Removed from this contact.">
            <Select name="deletePhone" value="" options={numbers} blank={numbers.length ? "Pick the wrong number" : "No numbers on file"} />
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
      <Group title="Notes">
        <Row label="Notes">
          <textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className="input" />
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
