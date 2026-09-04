/*
  Seed the "Capital Spotlight" blast template, rebuilt from the HubSpot marketing email
  "Large LP Fund Aggressively Looking For Shopping Center Exposure" (test send 2026-09-04).
  The copy is starter content: edit it per campaign in the campaign's "Edit template copy" panel.
  Re-runnable: updates the template if it already exists.
*/
import "dotenv/config";
import { prisma } from "../src/lib/db";

const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const name = "Capital Spotlight (blast)";
const subject = "Large LP Fund Aggressively Looking For Shopping Center Exposure";
const preheader = "Eager to deploy capital. Checks $7-30MM";

const bodyHtml = `<!-- Preheader (shows in inbox preview) -->
<div style="display:none;font-size:1px;color:#f6f9fc;line-height:1px;max-height:0;overflow:hidden">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc;padding:24px 0;font-family:Helvetica,Arial,sans-serif;color:#1a2321">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e2d3;border-radius:12px;overflow:hidden">
      <tr><td style="padding:0"><img src="${base}/email/logo-header.png" width="600" alt="RJL Capital Advisors" style="display:block;width:100%;max-width:600px;height:auto"></td></tr>
      <tr><td style="padding:28px 40px 8px">
        <div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#5b8bbf">CAPITAL SPOTLIGHT</div>
        <h1 style="margin:8px 0 16px;font-size:24px;line-height:1.25;color:#1a2321">Large LP Fund Looking for Shopping Center Exposure</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">RJL Capital Advisors is helping a repeat client ($70MM of business to date) deploy JV equity alongside established sponsors in retail (shopping centers).</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">The opportunity arises from an internal mandate shift that's pushing the fund to rebalance more aggressively towards cash-flowing retail.</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55">If you are working on a shopping center acquisition and would be open to meeting such a capital source, please reach out by replying to this email.</p>
      </td></tr>
      <tr><td style="padding:0 40px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fa;border-radius:8px">
          <tr><td style="padding:18px 22px">
            <div style="font-size:13px;letter-spacing:1px;font-weight:bold;color:#1a2321;margin-bottom:8px">MORE DETAILS</div>
            <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">
              <li>Check sizes: $7-30MM</li>
              <li>Market: Nationwide</li>
              <li>Cashflow sensitive. Day 1 cashflow a big plus</li>
              <li>Some credit tenancy helps. No need for a grocer anchor</li>
              <li>Fully discretionary</li>
            </ul>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 40px 28px;font-size:14px;line-height:1.6">
        <p style="margin:0">Best,<br>{{sender.name}}<br>RJL Capital Advisors</p>
      </td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid #e6e2d3;background:#f6f9fc;font-size:12px;line-height:1.6;color:#6b716e">
        <img src="${base}/email/logo-footer.png" width="160" alt="RJL Capital Advisors" style="display:block;width:160px;height:auto;margin-bottom:10px">
        <a href="mailto:info@rjlcapadvisors.com" style="color:#5b8bbf">info@rjlcapadvisors.com</a> · D: 516.604.3636 | C: 516.220.0477<br>
        RJL Capital Advisors, 9 Park Place, Third Floor, Great Neck, NY 11021<br>
        <a href="{{unsubscribeUrl}}" style="color:#6b716e">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;

(async () => {
  const existing = await prisma.emailTemplate.findFirst({ where: { name } });
  if (existing) {
    await prisma.emailTemplate.update({ where: { id: existing.id }, data: { subject, bodyHtml, kind: "BLAST" } });
    console.log("updated", name);
  } else {
    await prisma.emailTemplate.create({ data: { name, subject, bodyHtml, kind: "BLAST" } });
    console.log("added", name);
  }
  await prisma.$disconnect();
})();
