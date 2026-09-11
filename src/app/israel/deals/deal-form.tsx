"use client";

import { AutoSaveForm } from "@/components/autosave-form";
import { Group, Row, Text } from "@/components/form-rows";
import { NumberInput } from "@/components/number-input";
import { SelectField } from "@/components/select-field";

type Opt = { id: string; label: string };
type Deal = Partial<{ name: string; apartmentId: string | null; buyerContactId: string | null; agentContactId: string | null; offerNis: number | null; agreedPriceNis: number | null; expectedClose: string | null; lostReason: string | null; description: string | null; stage: string }>;

/** A deal in the RJL Israel funnel: which apartment, which buyer, which agent, the numbers, the timing. */
export function IlDealForm({ d = {}, apartments, buyers, agents, action, autosave = false, submitLabel = "Create deal" }: { d?: Deal; apartments: Opt[]; buyers: Opt[]; agents: Opt[]; action: (fd: FormData) => void | Promise<void>; autosave?: boolean; submitLabel?: string }) {
  const pick = (name: string, value: string | null | undefined, opts: Opt[], blank: string) => (
    <SelectField name={name} defaultValue={value ?? ""} className="input">
      <option value="">{blank}</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </SelectField>
  );
  const body = (
    <>
      <Group title="Deal">
        <Row label="Name" hint="Leave blank to name it after the buyer and the apartment.">
          <Text name="name" value={d.name} placeholder="Sarah Goldberg · Rehavia Gardens, Apt 12" />
        </Row>
        <Row label="Apartment">{pick("apartmentId", d.apartmentId, apartments, "Pick an apartment")}</Row>
        <Row label="Buyer">{pick("buyerContactId", d.buyerContactId, buyers, "Pick a buyer (contacts marked Buyer)")}</Row>
        <Row label="Broker">{pick("agentContactId", d.agentContactId, agents, "Pick an agent (contacts marked Broker)")}</Row>
      </Group>
      <Group title="Numbers and timing">
        <Row label="Offer">
          <NumberInput name="offerNis" defaultValue={d.offerNis} decimals={false} prefix="₪" />
        </Row>
        <Row label="Agreed price">
          <NumberInput name="agreedPriceNis" defaultValue={d.agreedPriceNis} decimals={false} prefix="₪" />
        </Row>
        <Row label="Expected close" hint="e.g. March 2027 or Q1 2027">
          <Text name="expectedClose" value={d.expectedClose} />
        </Row>
        {d.stage === "Lost" && (
          <Row label="Why it died">
            <Text name="lostReason" value={d.lostReason} />
          </Row>
        )}
      </Group>
      <Group title="Notes">
        <Row label="Description">
          <textarea name="description" rows={4} defaultValue={d.description ?? ""} className="input" />
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
