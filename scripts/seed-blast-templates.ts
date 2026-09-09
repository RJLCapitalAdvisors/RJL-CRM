import "dotenv/config";
import { prisma } from "../src/lib/db";

/**
 * Blast templates in the house style of the HubSpot newsletters Jonathan sent (see the "Deal Spotlight" sample):
 * header strip, logo, section label, headline, body, three spec blocks, INQUIRE button, contact footer with
 * unsubscribe. Merge fields: {{sender.name}}, {{unsubscribeUrl}}, {{contact.firstName|there}}; a deal's fields
 * when the blast is tied to a deal ({{deal.propertyName}} ...). Run: npx tsx scripts/seed-blast-templates.ts
 */

const BASE = "https://rjl-crm.vercel.app";
const F = "font-family:Helvetica,Arial,sans-serif";
const month = () => new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();

const shell = (inner: string, preheader: string) => `<!-- Preheader (shows in inbox preview) -->
<div style="display:none;font-size:1px;color:#f6f9fc;line-height:1px;max-height:0;overflow:hidden">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc;padding:24px 0;${F};color:#1a2321">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e2d3;border-radius:12px;overflow:hidden">
      <tr><td style="padding:14px 40px 0;font-size:11px;letter-spacing:2px;color:#6b716e">${month()} &bull; RJLCAPADVISORS.COM</td></tr>
      <tr><td style="padding:14px 40px 0"><img src="${BASE}/logo.png" width="180" alt="RJL Capital Advisors" style="display:block;width:180px;height:auto"></td></tr>
${inner}
      <tr><td style="padding:0 40px 28px;font-size:14px;line-height:1.6">
        <p style="margin:0">Best,<br>{{sender.name}}<br>RJL Capital Advisors</p>
      </td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid #e6e2d3;background:#f6f9fc;font-size:12px;line-height:1.6;color:#6b716e">
        <a href="mailto:info@rjlcapadvisors.com" style="color:#5b8bbf">info@rjlcapadvisors.com</a> &middot; D: 516.604.3636 | C: 516.220.0477<br>
        RJL Capital Advisors, 9 Park Place, Third Floor, Great Neck, NY 11021<br>
        <a href="{{unsubscribeUrl}}" style="color:#6b716e">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;

const spec = (label: string, value: string) => `          <tr><td style="padding:14px 22px;border-bottom:1px solid #dfe8f1">
            <div style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#5b8bbf;margin-bottom:4px">${label}</div>
            <div style="font-size:15px;line-height:1.5;color:#1a2321">${value}</div>
          </td></tr>`;

const dealSpotlight = shell(
  `      <tr><td style="padding:28px 40px 8px">
        <div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#5b8bbf">DEAL SPOTLIGHT</div>
        <h1 style="margin:8px 0 16px;font-size:24px;line-height:1.25;color:#1a2321">Experienced Developer Seeking Forward Sale On Class A Industrial Build To Suit</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">RJL Capital Advisors is currently representing an established northeast sponsor that is seeking a partner to enter into a forward sale agreement with on a class A industrial BTS opportunity.</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">The sponsor has a 15 year NNN lease signed with a strong, but non-investment grade tenant, and can begin construction in the next three months. Construction is expected to take 1 year total, and the development yield is around 9%, leaving room for the forward purchase partner to earn strong long-term yield.</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55">Please inquire if you have forward purchase capital for Class A Industrial, and would like to see the opportunity.</p>
      </td></tr>
      <tr><td style="padding:0 40px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fa;border-radius:8px">
${spec("OVERVIEW", "$80MM, 9% Yield")}
${spec("LOCATION", "Davenport, FL")}
${spec("DEAL SPECS", "Class A Industrial build to suit. 9% yield on cost at stabilization. 15 year NNN lease.")}
        </table>
      </td></tr>
      <tr><td style="padding:0 40px 28px" align="left">
        <a href="mailto:jonathan@rjlcapadvisors.com?subject=Inquiry%3A%20Forward%20Purchase%20Class%20A%20Industrial" style="display:inline-block;background:#1a2321;color:#ffffff;text-decoration:none;font-size:13px;letter-spacing:2px;font-weight:bold;padding:12px 26px;border-radius:6px">INQUIRE</a>
      </td></tr>`,
  "Top tier developer looking to forward-sell an industrial deal",
);

const capitalSpotlight = shell(
  `      <tr><td style="padding:28px 40px 8px">
        <div style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#5b8bbf">CAPITAL SPOTLIGHT</div>
        <h1 style="margin:8px 0 16px;font-size:24px;line-height:1.25;color:#1a2321">Large LP Fund Looking for Shopping Center Exposure</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">RJL Capital Advisors is helping a repeat client ($70MM of business to date) deploy JV equity alongside established sponsors in retail (shopping centers).</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55">The opportunity arises from an internal mandate shift that is pushing the fund to rebalance more aggressively towards cash-flowing retail.</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55">If you are working on a shopping center acquisition and would be open to meeting such a capital source, please reach out by replying to this email.</p>
      </td></tr>
      <tr><td style="padding:0 40px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fa;border-radius:8px">
${spec("CHECK SIZE", "$7MM to $30MM")}
${spec("MARKET", "Nationwide")}
${spec("WHAT THEY LIKE", "Cash flow sensitive, day one cash flow a big plus. Some credit tenancy helps; no need for a grocer anchor. Fully discretionary.")}
        </table>
      </td></tr>
      <tr><td style="padding:0 40px 28px" align="left">
        <a href="mailto:jonathan@rjlcapadvisors.com?subject=Shopping%20center%20deal%20for%20your%20LP" style="display:inline-block;background:#1a2321;color:#ffffff;text-decoration:none;font-size:13px;letter-spacing:2px;font-weight:bold;padding:12px 26px;border-radius:6px">INQUIRE</a>
      </td></tr>`,
  "Eager to deploy capital. Checks $7-30MM",
);

(async () => {
  const upsert = async (name: string, subject: string, bodyHtml: string) => {
    const existing = await prisma.emailTemplate.findFirst({ where: { name } });
    if (existing) await prisma.emailTemplate.update({ where: { id: existing.id }, data: { subject, bodyHtml, kind: "BLAST" } });
    else await prisma.emailTemplate.create({ data: { name, subject, bodyHtml, kind: "BLAST" } });
    console.log(existing ? "updated" : "created", name);
  };
  await upsert("Deal Spotlight (blast)", "Looking For Forward Purchase NNN Capital! Class A Industrial 15 Year NNN", dealSpotlight);
  await upsert("Capital Spotlight (blast)", "Large LP Fund Aggressively Looking For Shopping Center Exposure", capitalSpotlight);
  await prisma.$disconnect();
})();
