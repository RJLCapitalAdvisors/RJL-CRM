"use client";

import { useState } from "react";
import { BlastEditor, type BlastCopy } from "@/components/blast-editor";
import { saveBlastCopyAction } from "../actions";

/** The blast's email on its own page: edit in place, check it as a reader, test it, save. */
export function BlastCopyEditor({ campaignId, subject, bodyHtml, sendTo, from, me }: { campaignId: string; subject: string; bodyHtml: string; sendTo: string; from: string; me: string | null }) {
  const [copy, setCopy] = useState<BlastCopy>({ subject, bodyHtml });
  return <BlastEditor copy={copy} onChange={setCopy} onSave={(c) => saveBlastCopyAction(campaignId, c)} sendTo={sendTo} from={from} me={me} />;
}
