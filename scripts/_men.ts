import "dotenv/config";
import { prisma } from "../src/lib/db";
import { detectMentionedDeals } from "../src/lib/mentions";
import { refreshMomentum } from "../src/lib/momentum";
import { quietIntros } from "../src/lib/intros";
(async () => {
  const t = Date.now();
  const r = await detectMentionedDeals();
  console.log(`mention scan: ${r.threads} threads read in ${Math.round((Date.now() - t) / 1000)}s; new Deal Mentioned tickets: ${r.created.length}`);
  for (const c of r.created) console.log("  +", c);
  const m = await refreshMomentum();
  console.log("momentum:", m);
  const mentioned = await prisma.momentum.findMany({ where: { kind: "MENTIONED", status: "OPEN" } });
  console.log("MENTIONED open:", mentioned.map((x) => `${x.party}: ${x.summary}`).join(" | "));
  const qi = await quietIntros();
  console.log("intros shown:", qi.length, "| includes UFUND | Citivest:", qi.some((i) => /UFUND \| Citivest/i.test(i.subject)));
  await prisma.$disconnect();
})();
