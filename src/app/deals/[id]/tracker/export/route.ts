import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { TRACKER_STATUSES, fmtReportDate, investorLabel } from "@/lib/tracker";
import { missingFor, itemLabel } from "@/lib/checklist";

/**
 * Standalone HTML progress report in the same format as the legacy Google Drive version
 * (interactive status picker, notes, action items, PDF button). Download and upload to Drive as before.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: { investors: { include: { contact: { include: { company: true } } } }, actions: { orderBy: { createdAt: "asc" } } },
  });
  if (!deal) return new Response("Not found", { status: 404 });

  const name = deal.propertyName ?? deal.name;
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inv = deal.investors.map((r) => ({ n: investorLabel(r.contact), s: r.status, note: r.note ?? "", nd: r.noteDate ? fmtReportDate(r.noteDate) : "" }));
  const actions = deal.actions.map((a, i) => ({ id: i + 1, text: a.text, done: a.done }));
  const chips = [
    deal.sponsorName ? { label: "Sponsor", value: deal.sponsorName } : null,
    { label: "Type", value: [deal.requestedAmount ? fmtMoney(deal.requestedAmount) : null, deal.executionType ?? deal.requestType, deal.assetClass, [deal.city, deal.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") },
    deal.units || deal.squareFeet || deal.yearBuilt || deal.occupancy != null
      ? { label: "Property", value: [deal.units ? `${deal.units.toLocaleString()} units` : null, deal.squareFeet ? `${deal.squareFeet.toLocaleString()} SF` : null, deal.yearBuilt ? `Built ${deal.yearBuilt}` : null, deal.occupancy != null ? `${deal.occupancy}% Occupied` : null].filter(Boolean).join(" · ") }
      : null,
    deal.irr || deal.equityMultiple || deal.holdPeriod ? { label: "Returns", value: [deal.irr ? `${deal.irr}% IRR` : null, deal.equityMultiple ? `${deal.equityMultiple}x EM` : null, deal.holdPeriod, deal.cashOnCash ? `${deal.cashOnCash}% CoC` : null].filter(Boolean).join(" · ") } : null,
    deal.purchasePrice ? { label: "Purchase Price", value: [fmtMoney(deal.purchasePrice), deal.capRateT12 ? `${deal.capRateT12}% T12 Cap Rate` : null].filter(Boolean).join(" · ") } : null,
    deal.expectedClose ? { label: "Target Close", value: deal.expectedClose } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const itemsNeeded = [...missingFor(deal).map((it) => itemLabel(it, deal.strategy)), ...(deal.trackerItemsNote ? deal.trackerItemsNote.split(/\n+/).map((x) => x.trim()).filter(Boolean) : [])];
  const meta = { themes: deal.trackerThemes ?? "", items: itemsNeeded, address: [deal.propertyAddress, deal.city, deal.state].filter(Boolean).join(", "), preparedFor: deal.trackerPreparedFor ?? "" };
  const longest = Math.max(0, ...inv.map((x) => x.n.length));
  const gridCols = longest > 34 ? "200px 225px 1fr" : "175px 225px 1fr";
  const pdfName = `${name.replace(/[^a-z0-9]+/gi, "_")}_Progress_Report`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(name)} — Progress Report | RJL Capital Advisors</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Inter',sans-serif;background:#F0F2F7;color:#111827;min-height:100vh;padding:40px 20px 64px;}
  .page{max-width:900px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);}
  button{cursor:pointer;font-family:inherit;}
  textarea,input{font-family:inherit;}
  a{color:#60A5FA;text-decoration:none;}
  a:hover{text-decoration:underline;}
  #dlBtn:disabled{opacity:0.6;cursor:not-allowed;}
  @media print{.no-print{display:none!important;}body{padding:0;background:#fff;}.page{box-shadow:none;border-radius:0;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
</head>
<body>
<div class="page" id="app"></div>
<div class="no-print" style="position:fixed;bottom:24px;right:24px;z-index:999;">
  <button id="dlBtn" onclick="downloadPDF(${JSON.stringify(pdfName)})" style="display:flex;align-items:center;gap:7px;padding:10px 18px;background:#111827;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.25);">Download PDF</button>
</div>
<script>
const BLUE='#60A5FA';
const S=${JSON.stringify(TRACKER_STATUSES.map(({ id, label, bg, c, d }) => ({ id, label, bg, c, d })))};
const inv=${JSON.stringify(inv)};
inv.sort(function(a,b){return b.s-a.s;});
var actions=${JSON.stringify(actions)};
var nextActionId=actions.length+1;
var addingAction=false;
let openPicker=-1, editNote=-1, sortPriority=0;
var lastUpdated=new Date(${JSON.stringify(new Date().toISOString())});
function touchUpdated(){lastUpdated=new Date();}
function lastUpdatedStr(){var mo=['January','February','March','April','May','June','July','August','September','October','November','December'];return mo[lastUpdated.getMonth()]+' '+lastUpdated.getDate()+', '+lastUpdated.getFullYear();}
function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stamp(){var n=new Date();return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][n.getMonth()]+' '+n.getDate()+', '+n.getFullYear();}
window.togglePicker=function(i){openPicker=openPicker===i?-1:i;editNote=-1;render();}
window.setStatus=function(i,sid){inv[i].s=sid;touchUpdated();applySortOrder();openPicker=-1;render();}
window.startEdit=function(i){editNote=i;openPicker=-1;render();setTimeout(function(){var t=document.getElementById('nt'+i);if(t){t.focus();t.setSelectionRange(t.value.length,t.value.length);}},20);}
window.saveNote=function(i){var t=document.getElementById('nt'+i);if(t){inv[i].note=t.value;inv[i].nd=t.value?stamp():'';touchUpdated();}editNote=-1;render();}
window.setSortPriority=function(sid){sortPriority=sid;applySortOrder();openPicker=-1;editNote=-1;render();}
window.toggleAction=function(id){var a=actions.find(function(x){return x.id===id;});if(a){a.done=!a.done;touchUpdated();}render();}
window.deleteAction=function(id){actions=actions.filter(function(x){return x.id!==id;});touchUpdated();render();}
window.startAddAction=function(){addingAction=true;render();setTimeout(function(){var t=document.getElementById('newActionInput');if(t)t.focus();},20);}
window.cancelAdd=function(){addingAction=false;render();}
window.saveNewAction=function(){var t=document.getElementById('newActionInput');if(t&&t.value.trim()){actions.push({id:nextActionId++,text:t.value.trim(),done:false});touchUpdated();}addingAction=false;render();}
window.handleActionKey=function(e){if(e.key==='Enter')window.saveNewAction();if(e.key==='Escape')window.cancelAdd();}
function applySortOrder(){if(sortPriority===0){inv.sort(function(a,b){return b.s-a.s;});}else{inv.sort(function(a,b){var aP=(a.s===sortPriority)?1:0;var bP=(b.s===sortPriority)?1:0;if(bP!==aP)return bP-aP;return b.s-a.s;});}}
function badgeHTML(investor,i){var s=S.find(function(x){return x.id===investor.s;});return '<button onclick="togglePicker('+i+')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px 4px 8px;border-radius:20px;font-size:11px;font-weight:500;border:none;cursor:pointer;background:'+s.bg+';color:'+s.c+';white-space:nowrap;"><span style="width:6px;height:6px;border-radius:50%;background:'+s.d+';flex-shrink:0;display:inline-block;"></span>'+s.label+' &#8964;</button>';}
function pickerHTML(i,cur){if(openPicker!==i)return '';var html='<div style="margin-top:6px;background:#fff;border:0.5px solid #d1d5db;border-radius:8px;overflow:hidden;width:220px;box-shadow:0 4px 16px rgba(0,0,0,0.1);position:relative;z-index:10;">';S.slice().reverse().forEach(function(s){html+='<button onclick="setStatus('+i+','+s.id+')" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:'+(s.id===cur?'#f3f4f6':'transparent')+';cursor:pointer;font-size:12px;color:'+(s.id===6?'#1e40af':s.c)+';white-space:nowrap;text-align:left;font-family:inherit;"><span style="width:7px;height:7px;border-radius:50%;background:'+s.d+';flex-shrink:0;display:inline-block;"></span>'+s.label+(s.id===cur?' ✓':'')+'</button>';});html+='</div>';return html;}
function noteHTML(investor,i){if(editNote===i)return '<div><textarea id="nt'+i+'" style="width:100%;min-height:56px;font-size:12px;padding:6px 8px;border-radius:6px;font-family:inherit;resize:vertical;border:1px solid #d1d5db;color:#111827;">'+esc(investor.note)+'</textarea><button onclick="saveNote('+i+')" style="margin-top:4px;font-size:11px;padding:4px 12px;background:#111827;color:#fff;border:none;border-radius:6px;cursor:pointer;">Save</button></div>';if(investor.note)return '<div onclick="startEdit('+i+')" style="cursor:text;"><span style="font-size:12px;color:#4B5563;font-style:italic;line-height:1.6;">'+esc(investor.note)+'</span>'+(investor.nd?'<br><span style="font-size:10px;color:#9CA3AF;">Updated '+investor.nd+'</span>':'')+'</div>';return '<div onclick="startEdit('+i+')" style="cursor:text;color:#9CA3AF;font-size:11px;">Add note ✎</div>';}
function sortBarHTML(){var html='<div class="no-print" style="padding:12px 20px 10px;background:#F8F9FB;border-bottom:1px solid #E5E7EB;display:flex;flex-wrap:wrap;gap:6px;align-items:center;"><span style="font-size:9px;font-weight:600;color:#9CA3AF;letter-spacing:0.12em;text-transform:uppercase;margin-right:4px;">Sort</span>';var allActive=sortPriority===0;html+='<button onclick="setSortPriority(0)" style="padding:3px 10px;border-radius:14px;font-size:11px;font-weight:500;border:1.5px solid '+(allActive?'#111827':'#D1D5DB')+';background:'+(allActive?'#111827':'transparent')+';color:'+(allActive?'#fff':'#6B7280')+';cursor:pointer;">Default (8&#8594;1)</button>';S.slice().reverse().forEach(function(s){var cnt=inv.filter(function(x){return x.s===s.id;}).length;if(cnt===0)return;var active=sortPriority===s.id;html+='<button onclick="setSortPriority('+s.id+')" style="padding:3px 10px;border-radius:14px;font-size:11px;font-weight:500;border:1.5px solid '+(active?s.d:'#D1D5DB')+';background:'+(active?s.bg:'transparent')+';color:'+(active?(s.id===6?'#1e40af':s.c):'#6B7280')+';cursor:pointer;">'+s.label.replace(/^\\d+\\. /,'')+'</button>';});html+='</div>';return html;}
function actionBoxHTML(){var open=actions.filter(function(a){return !a.done;}).length;var html='<div style="margin:16px 20px;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;"><div style="background:#111827;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:9.5px;font-weight:600;color:'+BLUE+';letter-spacing:0.14em;text-transform:uppercase;">Action Items</span>';if(open>0)html+='<span style="background:'+BLUE+';color:#111827;font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;">'+open+' open</span>';html+='</div><button class="no-print" onclick="startAddAction()" style="display:flex;align-items:center;gap:4px;padding:3px 10px;background:rgba(96,165,250,0.15);border:0.5px solid rgba(96,165,250,0.4);border-radius:6px;font-size:11px;color:'+BLUE+';cursor:pointer;">+ Add</button></div><div style="background:#fff;">';if(actions.length===0&&!addingAction)html+='<div style="padding:14px 16px;font-size:12px;color:#9CA3AF;font-style:italic;">No action items yet. Click + Add to create one.</div>';actions.forEach(function(a){html+='<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid #F3F4F6;"><button class="no-print" onclick="toggleAction('+a.id+')" style="width:16px;height:16px;border-radius:4px;border:1.5px solid '+(a.done?'#10B981':'#D1D5DB')+';background:'+(a.done?'#10B981':'transparent')+';flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;padding:0;">'+(a.done?'<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>':'')+'</button><span style="flex:1;font-size:12.5px;color:'+(a.done?'#9CA3AF':'#374151')+';line-height:1.5;text-decoration:'+(a.done?'line-through':'none')+';padding-top:1px;">'+esc(a.text)+'</span><button class="no-print" onclick="deleteAction('+a.id+')" style="color:#D1D5DB;background:none;border:none;font-size:15px;padding:0 2px;line-height:1;flex-shrink:0;margin-top:1px;" title="Remove">&times;</button></div>';});if(addingAction){html+='<div style="padding:10px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #F3F4F6;"><div style="width:16px;height:16px;border-radius:4px;border:1.5px solid #D1D5DB;flex-shrink:0;"></div><input id="newActionInput" onkeydown="handleActionKey(event)" placeholder="Describe the action item..." style="flex:1;border:1px solid #D1D5DB;border-radius:6px;padding:5px 8px;font-size:12px;color:#111827;outline:none;"><button onclick="saveNewAction()" style="padding:4px 12px;background:#111827;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;">Save</button><button onclick="cancelAdd()" style="padding:4px 10px;background:transparent;color:#9CA3AF;border:1px solid #E5E7EB;border-radius:6px;font-size:11px;cursor:pointer;">Cancel</button></div>';}html+='</div></div>';return html;}
var META=${JSON.stringify(meta)};
function box(title,inner){return '<div style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;"><div style="background:#111827;padding:8px 14px;font-size:9.5px;font-weight:600;color:'+BLUE+';letter-spacing:0.14em;text-transform:uppercase;">'+title+'</div><div style="padding:10px 14px;font-size:12.5px;line-height:1.55;color:#374151;">'+inner+'</div></div>';}
function metaHTML(){var empty='<span style="color:#9CA3AF;font-style:italic;">';var themes=META.themes?'<div style="white-space:pre-wrap;">'+esc(META.themes)+'</div>':empty+'No themes noted yet.</span>';var items=META.items.length?'<ol style="margin:0;padding-left:18px;">'+META.items.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ol>':empty+'Nothing outstanding.</span>';return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 20px 0;">'+box('Notable Feedback Themes',themes)+box('Items Needed from Sponsor',items)+'</div>';}
function subHTML(){var parts=[];if(META.address)parts.push('Deal address: '+esc(META.address));if(META.preparedFor)parts.push('Prepared for: '+esc(META.preparedFor));return parts.length?'<div style="font-size:11.5px;color:rgba(255,255,255,0.55);margin:-10px 0 14px;">'+parts.join(' &nbsp;&middot;&nbsp; ')+'</div>':'';}
function render(){var gridCols=${JSON.stringify(gridCols)};var rows='';inv.forEach(function(investor,i){rows+='<div style="display:grid;grid-template-columns:'+gridCols+';padding:12px 20px;border-bottom:1px solid #F3F4F6;align-items:start;background:'+(i%2===1?'#FAFAFA':'#fff')+';"><div style="font-size:13.5px;font-weight:500;color:#111827;padding-top:3px;">'+esc(investor.n)+'</div><div>'+badgeHTML(investor,i)+pickerHTML(i,investor.s)+'</div><div>'+noteHTML(investor,i)+'</div></div>';});
var chips=${JSON.stringify(chips)};
var chipsHTML=chips.map(function(c){return '<div style="background:rgba(255,255,255,0.07);border:0.5px solid rgba(96,165,250,0.3);border-radius:6px;padding:5px 14px;"><span style="color:'+BLUE+';font-size:8.5px;letter-spacing:0.12em;text-transform:uppercase;display:block;margin-bottom:2px;">'+esc(c.label)+'</span><span style="color:rgba(255,255,255,0.7);font-size:12px;">'+esc(c.value)+'</span></div>';}).join('');
document.getElementById('app').innerHTML='<div style="background:#111827;padding:28px 32px 24px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;"><div style="background:#fff;border-radius:8px;padding:8px 14px;display:inline-block;"><img src="https://www.rjlcapadvisors.com/wp-content/uploads/2022/08/rjlc_P21_1125_Logo2.svg" alt="RJL Capital Advisors" style="height:30px;display:block;" onerror="this.style.display=\\'none\\';this.nextElementSibling.style.display=\\'block\\';"><div style="display:none;font-size:13px;font-weight:600;color:#111827;letter-spacing:0.04em;">RJL Capital Advisors</div></div><div style="text-align:right;"><div style="font-size:9px;color:'+BLUE+';letter-spacing:0.15em;text-transform:uppercase;margin-bottom:3px;">Last Updated</div><div style="font-size:12px;color:rgba(255,255,255,0.5);">'+lastUpdatedStr()+'</div></div></div><div style="font-size:20px;font-weight:600;color:#fff;margin-bottom:16px;">${esc(name)} &#8212; Progress Report</div><div style="display:flex;flex-wrap:wrap;gap:8px;">'+chipsHTML+'</div>'+subHTML()+'</div><div style="height:2px;background:'+BLUE+';"></div><div style="background:#1a2332;padding:8px 32px;font-size:11px;color:rgba(255,255,255,0.3);">Please email <a href="mailto:jonathan@rjlcapadvisors.com">jonathan@rjlcapadvisors.com</a> or <a href="mailto:aviel@rjlcapadvisors.com">aviel@rjlcapadvisors.com</a> with any questions</div>'+metaHTML()+actionBoxHTML()+sortBarHTML()+'<div style="display:grid;grid-template-columns:'+gridCols+';background:#111827;padding:10px 20px;"><div style="font-size:9.5px;font-weight:600;color:'+BLUE+';letter-spacing:0.14em;text-transform:uppercase;">Investor</div><div style="font-size:9.5px;font-weight:600;color:'+BLUE+';letter-spacing:0.14em;text-transform:uppercase;">Status</div><div style="font-size:9.5px;font-weight:600;color:'+BLUE+';letter-spacing:0.14em;text-transform:uppercase;">Notes</div></div>'+rows+'<div style="height:2px;background:'+BLUE+';"></div><div style="background:#111827;padding:12px 32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;"><span style="font-size:10px;color:rgba(255,255,255,0.22);">RJL Capital Advisors &middot; 9 Park Place, 3rd Floor, Great Neck, NY 11021 &middot; 516.220.0477</span><span style="font-size:10px;color:rgba(255,255,255,0.22);font-style:italic;">Confidential &#8212; For Authorized Recipients Only</span></div>';}
render();
function downloadPDF(filename){var btn=document.getElementById('dlBtn');if(btn){btn.disabled=true;btn.innerHTML='Generating…';}var noPrint=document.querySelectorAll('.no-print');noPrint.forEach(function(el){el._pd=el.style.display;el.style.display='none';});var logoImg=document.querySelector('.page img');var logoTxt=logoImg?logoImg.nextElementSibling:null;if(logoImg)logoImg.style.display='none';if(logoTxt)logoTxt.style.display='block';html2canvas(document.querySelector('.page'),{scale:2,useCORS:false,logging:false}).then(function(canvas){if(logoImg)logoImg.style.display='';if(logoTxt)logoTxt.style.display='none';noPrint.forEach(function(el){el.style.display=el._pd||'';});if(btn){btn.disabled=false;btn.innerHTML='Download PDF';}var pdf=new window.jspdf.jsPDF({orientation:'portrait',unit:'px',format:'a4'});var pW=pdf.internal.pageSize.getWidth();var pH=pdf.internal.pageSize.getHeight();var ratio=pW/canvas.width;var scaledH=canvas.height*ratio;var y=0,rem=scaledH;pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,y,pW,scaledH);rem-=pH;y-=pH;while(rem>0){pdf.addPage();pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,y,pW,scaledH);rem-=pH;y-=pH;}pdf.save(filename+'.pdf');});}
</script>
</body>
</html>`;

  const stamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const fileName = `${name} - Progress Report (${stamp}).html`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"` } });
}
