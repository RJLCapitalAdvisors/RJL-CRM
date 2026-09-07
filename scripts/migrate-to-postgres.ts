/**
 * One-time move of all data from the local SQLite file (prisma/dev.db) to the hosted Postgres
 * database in DATABASE_URL. Re-runnable: rows that already exist are skipped.
 *   npm run migrate:postgres
 */
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { Prisma, PrismaClient } from "@prisma/client";

const SQLITE = process.env.SQLITE_PATH ?? "prisma/dev.db";
// parents before children
const ORDER = ["User", "Company", "Contact", "InvestorCriteria", "EmailTemplate", "Deal", "DealInvestor", "DealAction", "Campaign", "CampaignRecipient", "Activity", "CriteriaProposal", "DealIntake", "Todo"];

async function main() {
  const pg = new PrismaClient();
  const lite = new DatabaseSync(SQLITE, { readOnly: true });
  const models = Prisma.dmmf.datamodel.models;
  for (const name of ORDER) {
    const model = models.find((m) => m.name === name);
    if (!model) throw new Error(`model ${name} not in schema`);
    const scalar = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
    const rows = lite.prepare(`select ${scalar.map((f) => `"${f.name}"`).join(", ")} from "${name}"`).all() as Record<string, unknown>[];
    const converted = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const f of scalar) {
        let v = r[f.name];
        if (v === null || v === undefined) {
          out[f.name] = null;
          continue;
        }
        if (f.type === "DateTime") v = new Date(typeof v === "number" ? v : String(v));
        else if (f.type === "Boolean") v = v === 1 || v === true || v === "1";
        else if (f.type === "Int") v = Number(v);
        else if (f.type === "Float" || f.type === "Decimal") v = Number(v);
        else if (f.type === "BigInt") v = BigInt(v as number);
        out[f.name] = v;
      }
      return out;
    });
    const delegate = (pg as unknown as Record<string, { createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }> }>)[name.charAt(0).toLowerCase() + name.slice(1)];
    let inserted = 0;
    for (let i = 0; i < converted.length; i += 500) {
      const r = await delegate.createMany({ data: converted.slice(i, i + 500), skipDuplicates: true });
      inserted += r.count;
    }
    console.log(`${name.padEnd(18)} sqlite ${String(rows.length).padStart(6)}  inserted ${String(inserted).padStart(6)}`);
  }
  await pg.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
