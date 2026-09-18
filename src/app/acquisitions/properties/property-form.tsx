"use client";

import { useState } from "react";
import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Select, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { AQ_STAGES, aqStageTone, parseJsonList } from "@/lib/acquisitions";

type Pr = Partial<{ address: string; neighborhood: string | null; city: string | null; state: string | null; stages: string; callBackAt: Date | string | null; dealStage: string | null; askingPrice: number | null; units: number | null; squareFeet: number | null; assetType: string | null; notes: string | null }>;

const toDateInput = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");

/**
 * A property in RJL Acquisitions. Stage is a set of tokens (Deal, Call me back, Not interested, No answer): ticking
 * Call me back asks for the date, and that date puts the property in the dashboard's Call Me Back window; ticking
 * Deal puts it in the pipeline at the stage picked here.
 */
export function AqPropertyForm({ p = {}, dealStages, action, autosave = false, submitLabel = "Create property" }: { p?: Pr; dealStages: string[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const [stages, setStages] = useState<string[]>(parseJsonList(p.stages));
  const toggle = (r: string) => setStages((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const callBack = stages.includes("Call me back");
  const deal = stages.includes("Deal");
  const body = (
    <>
      <Group title="Stage">
        <Row label="Where it stands" hint="Tick what applies. Call me back needs a date; Deal opens the pipeline stage.">
          <div className="flex flex-wrap gap-1.5 py-1">
            {AQ_STAGES.map((r) => {
              const on = stages.includes(r);
              return (
                <label key={r} className={`chip cursor-pointer text-[11px] ${on ? aqStageTone(r) : "border border-dashed border-line bg-transparent text-muted hover:text-ink"}`}>
                  <input type="checkbox" name="stages" value={r} checked={on} onChange={() => toggle(r)} className="sr-only" />
                  {r}
                </label>
              );
            })}
          </div>
        </Row>
        {callBack && (
          <Row label="Call back on" hint="The property shows in the dashboard's Call Me Back window on this day, with the numbers to dial, until dismissed.">
            <input type="date" name="callBackAt" defaultValue={toDateInput(p.callBackAt)} required className="input" />
          </Row>
        )}
        {deal && (
          <Row label="Pipeline stage">
            <Select name="dealStage" value={p.dealStage && dealStages.includes(p.dealStage) ? p.dealStage : dealStages[0]} options={dealStages} noBlank />
          </Row>
        )}
      </Group>
      <Group title="Property">
        <Row label="Address">
          <Text name="address" value={p.address} placeholder="123 Main St" />
        </Row>
        <Row label="Neighborhood">
          <Text name="neighborhood" value={p.neighborhood} />
        </Row>
        <Row label="City">
          <Text name="city" value={p.city} />
        </Row>
        <Row label="State">
          <Text name="state" value={p.state} placeholder="NY" />
        </Row>
        <Row label="Asset type">
          <Select name="assetType" value={p.assetType ?? ""} options={["Multifamily", "Retail", "Industrial", "Office", "Mixed Use", "Land", "Hospitality", "Other"]} />
        </Row>
        <Row label="Asking price">
          <NumberInput name="askingPrice" defaultValue={p.askingPrice} decimals={false} prefix="$" />
        </Row>
        <Row label="Units">
          <NumberInput name="units" defaultValue={p.units} decimals={false} />
        </Row>
        <Row label="Square feet">
          <NumberInput name="squareFeet" defaultValue={p.squareFeet} decimals={false} />
        </Row>
      </Group>
      <Group title="Notes">
        <Row label="Notes">
          <textarea name="notes" rows={3} defaultValue={p.notes ?? ""} className="input" />
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
