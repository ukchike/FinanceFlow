// FinanceFlow money tools: reversals, fees, subscriptions, runway, recap, ajo, IOUs, forecast,
// real-value FX view, spending spikes, quick entry and savings challenges.
// Loaded before the main script; everything here runs only when called, so it can use the
// main script's globals (txns, accounts, save, render, ...) without load-order problems.
'use strict';

let ffx={debts:[],ajo:[],reversalLog:[],dismissedSubs:[],fx:{code:"USD",rates:[]}};
let ffxView=null,ffxStack=[],ffxDetail=null,ffxState={};
const FFX_DAY=864e5;

// ── persistence ──
function ffxFresh(){return{debts:[],ajo:[],reversalLog:[],dismissedSubs:[],fx:{code:"USD",rates:[]}};}
function ffxNormalize(d){
  const f=ffxFresh();if(!d||typeof d!=="object")return f;
  for(const k of ["debts","ajo","reversalLog","dismissedSubs"])if(Array.isArray(d[k]))f[k]=d[k];
  if(d.fx&&typeof d.fx==="object"){f.fx.code=typeof d.fx.code==="string"?d.fx.code:"USD";f.fx.rates=Array.isArray(d.fx.rates)?d.fx.rates.filter(r=>r&&FinanceCore.date(r.date)&&Number(r.rate)>0):[];}
  return f;
}
function ffxLoad(){try{ffx=ffxNormalize(JSON.parse(appStorage.getItem("ffd_tools")||"null"));}catch(e){ffx=ffxFresh();}}
function ffxSave(){appStorage.setItem("ffd_tools",JSON.stringify(ffx));}
function ffxValidateBackup(t){
  if(t===undefined)return;
  if(!t||typeof t!=="object"||Array.isArray(t))throw new Error("Invalid money tools data.");
  for(const k of ["debts","ajo","reversalLog","dismissedSubs"])if(t[k]!==undefined&&!Array.isArray(t[k]))throw new Error("Invalid money tools data.");
  for(const d of t.debts||[])if(!d||typeof d.person!=="string"||!(Number(d.amount)>0)||!["lent","borrowed"].includes(d.direction))throw new Error("Invalid IOU in backup.");
  for(const a of t.ajo||[])if(!a||typeof a.name!=="string"||!(Number(a.amount)>0)||!Array.isArray(a.members)||!a.members.length||!FinanceCore.date(a.startDate))throw new Error("Invalid ajo circle in backup.");
}

// ── helpers ──
const ffxToday=()=>toLocalISODate(new Date());
function ffxAddDays(iso,n){const d=FinanceCore.date(iso)||new Date();d.setDate(d.getDate()+n);return toLocalISODate(d);}
function ffxDaysBetween(a,b){const x=FinanceCore.date(a),y=FinanceCore.date(b);return x&&y?Math.round((y-x)/FFX_DAY):0;}
function ffxTotalBalance(){return accounts.reduce((s,a)=>{const eq=acctPrimaryEquiv(a);return eq===null?s:s+eq;},0);}
function ffxPA(t){const v=primaryAmount(t);return Number.isFinite(v)?v:0;}
function ffxNum(v){const n=parseAmount(String(v??""));return Number.isFinite(n)?n:0;}
function ffxShareText(text){
  if(window.Android&&window.Android.shareText){window.Android.shareText(text);return;}
  if(navigator.share){navigator.share({text}).catch(()=>{});return;}
  try{navigator.clipboard.writeText(text);showToast("📋 Copied — paste it into WhatsApp","green");}catch(e){prompt("Copy this message",text);}
}
function ffxExpensesSince(days){const from=ffxAddDays(ffxToday(),-days);return txns.filter(t=>t.type==="expense"&&t.date>=from&&t.date<=ffxToday());}
function ffxAvgDailySpend(){
  if(!txns.some(t=>t.type==="expense"))return 0;
  const first=txns.filter(t=>t.type==="expense").reduce((m,t)=>t.date<m?t.date:m,ffxToday());
  const span=Math.max(14,Math.min(90,ffxDaysBetween(first,ffxToday())+1));
  return ffxExpensesSince(span-1).reduce((s,t)=>s+ffxPA(t),0)/span;
}

// ── 4. headline metric: days of runway ──
function ffxRunway(){
  const avg=ffxAvgDailySpend(),bal=ffxTotalBalance();
  if(avg<=0)return{days:null,avg,bal};
  return{days:Math.max(0,Math.floor(bal/avg)),avg,bal};
}

// ── 1. failed debits awaiting reversal ──
function ffxPendingReversals(){return txns.filter(t=>t.type==="expense"&&t.reversalPending);}
function ffxReversalCandidates(t){
  return txns.filter(x=>x.type==="income"&&x.accountId===t.accountId&&Math.abs(Number(x.amount)-Number(t.amount))<0.005&&x.date>=t.date&&ffxDaysBetween(t.date,x.date)<=60).sort((a,b)=>a.date.localeCompare(b.date));
}
function markFailedDebit(id){
  const t=txns.find(x=>x.id===id);if(!t||t.type!=="expense")return;
  if(t.splitGroupId)return alert("Split transactions can't be tracked as failed debits. Edit the original entry instead.");
  t.reversalPending={since:ffxToday()};save();showModal("close");render();
  showToast("⏳ Tracking as a failed debit — we'll remind you until it's reversed","warn");
}
function cancelFailedDebit(id){const t=txns.find(x=>x.id===id);if(!t)return;delete t.reversalPending;save();ffxRender();render();showToast("Removed from reversal tracking","green");}
function resolveReversal(id){
  const t=txns.find(x=>x.id===id);if(!t)return;
  const sel=document.getElementById("revCredit_"+id),creditId=sel?sel.value:"";
  const c=creditId?txns.find(x=>x.id===creditId):null;
  const msg=c?`Treat the ${fmtCur(c.amount,txnCurrency(c))} credit on ${fmtD(c.date)} as the reversal of this failed debit? Both entries leave your totals (they cancel out) and are kept in the reversal log.`:"Mark this debit as reversed? It leaves your spending and the money returns to the account balance. It stays in the reversal log as a dated record.";
  if(!confirm(msg))return;
  const di=txns.indexOf(t);txns.splice(di,1);
  let ci=-1;if(c){ci=txns.indexOf(c);txns.splice(ci,1);}
  const log={id:uid(),debit:t,credit:c,resolvedOn:ffxToday(),waitedDays:ffxDaysBetween(t.reversalPending?.since||t.date,ffxToday())};
  ffx.reversalLog.unshift(log);if(ffx.reversalLog.length>200)ffx.reversalLog.length=200;
  save();ffxRender();render();
  showUndoToast("Reversal recorded",()=>{txns.splice(di,0,t);if(c)txns.splice(ci,0,c);ffx.reversalLog=ffx.reversalLog.filter(x=>x.id!==log.id);save();ffxRender();});
}
function ffxReversalsHTML(){
  const pend=ffxPendingReversals().sort((a,b)=>a.date.localeCompare(b.date));
  const total=pend.reduce((s,t)=>s+ffxPA(t),0);
  const rows=pend.map(t=>{
    const waited=ffxDaysBetween(t.reversalPending.since||t.date,ffxToday()),cands=ffxReversalCandidates(t);
    return`<div class="card ffx-rev"><div class="flex-b"><div style="min-width:0"><div class="fz13 fw7 ellip">${esc(t.description||t.category)}</div><div class="fz10 muted mt4">${esc(accName(t.accountId))} · debited ${fmtD(t.date)}</div></div><div class="fz14 fw8 red">-${fmtCur(t.amount,txnCurrency(t))}</div></div>
      <div class="ffx-wait ${waited>=7?"late":""}">⏳ Waiting ${waited} day${waited===1?"":"s"}${waited>=7?" — consider raising a complaint with your bank":""}</div>
      ${cands.length?`<div class="fz10 green fw6 mt8">✓ Possible reversal credit found</div><select class="inp mt4" id="revCredit_${esc(t.id)}"><option value="">Money came back but isn't recorded</option>${cands.map((c,i)=>`<option value="${esc(c.id)}" ${i===0?"selected":""}>${fmtD(c.date)} · ${esc(c.description||c.category)} · ${fmtCur(c.amount,txnCurrency(c))}</option>`).join("")}</select>`:""}
      <div class="flex g6 mt10"><button class="btn btn-p btn-sm" onclick="resolveReversal('${escJs(t.id)}')">✓ Reversed</button><button class="btn btn-g btn-sm" onclick="ffxShareText(ffxDisputeText('${escJs(t.id)}'))">Complaint text</button><button class="btn btn-g btn-sm" onclick="cancelFailedDebit('${escJs(t.id)}')">Not failed</button></div></div>`;
  }).join("");
  const log=ffx.reversalLog.slice(0,20).map(l=>`<div class="ffx-row"><div style="min-width:0"><div class="fz12 fw6 ellip">${esc(l.debit.description||l.debit.category)}</div><div class="fz10 muted">Debited ${fmtD(l.debit.date)} · reversed ${fmtD(l.resolvedOn)} · ${l.waitedDays} day wait</div></div><div class="fz12 fw7">${fmtCur(l.debit.amount,txnCurrency(l.debit))}</div></div>`).join("");
  return`<div class="ffx-hero ${pend.length?"warn":""}"><div class="fz11 muted">Money stuck in failed debits</div><div class="ffx-hero-num">${fmt(total)}</div><div class="fz11 muted">${pend.length?pend.length+" debit"+(pend.length>1?"s":"")+" awaiting reversal":"Nothing awaiting reversal"}</div></div>
    <div class="msg msg-ok fz11 mb12" style="display:block">Did a transfer or card payment fail but the money left your account? Open the transaction and tap <b>⏳ Failed debit</b>. FinanceFlow reminds you until the bank reverses it, spots the reversal credit, and keeps a dated log you can quote to your bank.</div>
    ${rows||`<div class="empty-state mb12"><div class="empty-ic">✅</div><div class="fz13 fw7">No failed debits</div><div class="fz11 muted mt4">Mark one from any expense's edit screen.</div></div>`}
    ${log?`<div class="st-label mt12">Reversal history</div><div class="card" style="padding:4px 14px">${log}</div>`:""}`;
}
function ffxDisputeText(id){
  const t=txns.find(x=>x.id===id);if(!t)return"";
  return`Hello, I'm writing about a failed transaction on my ${accName(t.accountId)} account.\n\nAmount: ${fmtCur(t.amount,txnCurrency(t))}\nDate debited: ${t.date}\nDescription: ${t.description||t.category}\n\nThe transaction did not go through but my account was debited ${ffxDaysBetween(t.date,ffxToday())} days ago and the money has not been reversed. Please reverse it as soon as possible.\n\nThank you.`;
}

// ── 2. fees leaked ──
const FFX_FEE_TYPES=[
  ["Stamp duty",/stamp\s*duty/i],["SMS alert",/sms\s*(alert)?\s*(fee|charge)|sms\s*alert/i],["Card maintenance",/(card|account)\s*maint/i],
  ["POS charge",/pos\s*(fee|charge)|pos\s*withdrawal\s*(fee|charge)/i],["VAT",/\bvat\b/i],["Transfer fee",/transfer\s*(fee|charge)|nip\s*(fee|charge)|commission/i]];
function ffxIsFee(t){
  if(t.type!=="expense")return false;
  if(t.category==="Fees & Charges"||(t.category==="Finance"&&t.subcategory==="Bank Charges"))return true;
  return FFX_FEE_TYPES.some(([,re])=>re.test(t.description||""))||/\b(bank\s*charges?|service\s*charge|levy)\b/i.test(t.description||"");
}
function ffxFeeType(t){
  for(const [name,re] of FFX_FEE_TYPES)if(re.test(t.description||""))return name;
  const sub={"Transfer Fee":"Transfer fee","Stamp Duty":"Stamp duty","POS Charge":"POS charge","SMS Alert":"SMS alert","Card Maintenance":"Card maintenance"}[t.subcategory];
  return sub||"Other charges";
}
function ffxFeesIn(startStr,endStr){return txns.filter(t=>t.date>=startStr&&t.date<=endStr&&ffxIsFee(t));}
function ffxMonthRange(offset){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+offset);const r=getRangeFor("month",d);return{start:r.startStr,end:r.endStr,label:MO[d.getMonth()]};}
function ffxFeesHTML(){
  const cur=ffxMonthRange(0),prev=ffxMonthRange(-1);
  const fees=ffxFeesIn(cur.start,cur.end),total=fees.reduce((s,t)=>s+ffxPA(t),0),prevTotal=ffxFeesIn(prev.start,prev.end).reduce((s,t)=>s+ffxPA(t),0);
  const byType={};fees.forEach(t=>{const k=ffxFeeType(t);byType[k]=(byType[k]||0)+ffxPA(t);});
  const months=[];for(let i=5;i>=0;i--){const r=ffxMonthRange(-i);months.push({label:r.label,v:ffxFeesIn(r.start,r.end).reduce((s,t)=>s+ffxPA(t),0)});}
  const max=Math.max(...months.map(m=>m.v),1);
  const yearly=months.reduce((s,m)=>s+m.v,0)/6*12;
  const diff=total-prevTotal;
  return`<div class="ffx-hero ${total>0?"warn":""}"><div class="fz11 muted">Fees & charges this month</div><div class="ffx-hero-num">${fmt(total)}</div><div class="fz11 muted">${fees.length} charge${fees.length===1?"":"s"} · ${prevTotal||total?(diff>0?"▲ "+fmt(diff)+" more than "+prev.label:diff<0?"▼ "+fmt(-diff)+" less than "+prev.label:"same as "+prev.label):"no fees recorded yet"}</div></div>
    <div class="card"><div class="fz12 fw7 mb10">Last 6 months</div><div class="ffx-bars">${months.map(m=>`<div class="ffx-bar-col"><div class="ffx-bar-val">${m.v?fmtK(m.v):""}</div><div class="ffx-bar" style="height:${Math.max(m.v/max*100,m.v?4:0)}%"></div><div class="ffx-bar-lbl">${m.label}</div></div>`).join("")}</div>
    <div class="fz11 muted mt10">At this rate you'll pay about <b class="red">${fmt(yearly)}</b> in fees over a year.</div></div>
    ${Object.keys(byType).length?`<div class="card"><div class="fz12 fw7 mb8">Where the fees came from</div>${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="ffx-row"><span class="fz12">${esc(k)}</span><span class="fz12 fw7">${fmt(v)}</span></div>`).join("")}</div>`:""}
    <div class="card"><div class="fz12 fw7 mb6">Cut your fees</div><div class="fz11 muted" style="line-height:1.6">• Stamp duty (₦50) applies to transfers into an account of ₦10,000 and above — fewer, larger transfers between your own accounts can't avoid it, but batching payments to others reduces it.<br>• Ask your bank to switch SMS alerts to free email or app alerts.<br>• Use free-transfer apps for small, frequent transfers.<br>• Withdraw cash less often — POS agents charge per withdrawal.</div></div>
    <div class="fz10 muted tac">Counted: the <b>Fees & Charges</b> category, Finance › Bank Charges, and any expense whose description mentions a fee, charge, stamp duty, VAT, SMS alert or commission.</div>`;
}

// ── 3. subscription & recurring bill detector ──
const FFX_STOP=new Set(["the","and","for","from","with","payment","pay","purchase","trf","transfer","pos","web","nip","via","ltd","limited","ref","card"]);
function ffxNormDesc(s){return String(s||"").toLowerCase().replace(/\d+/g," ").replace(/[^a-z]+/g," ").trim().split(/\s+/).filter(w=>w.length>2&&!FFX_STOP.has(w)).slice(0,3).join(" ");}
function ffxMedian(a){const s=a.slice().sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function ffxDetectSubscriptions(includeTracked){
  const from=ffxAddDays(ffxToday(),-400),groups={};
  txns.forEach(t=>{if(t.type!=="expense"||t.date<from||t.splitGroupId)return;const k=ffxNormDesc(t.description);if(!k)return;(groups[k]=groups[k]||[]).push(t);});
  const out=[];
  for(const [key,list] of Object.entries(groups)){
    if(list.length<3)continue;
    list.sort((a,b)=>a.date.localeCompare(b.date));
    const gaps=[];for(let i=1;i<list.length;i++)gaps.push(ffxDaysBetween(list[i-1].date,list[i].date));
    const med=ffxMedian(gaps);
    const freq=med>=6&&med<=8?"weekly":med>=26&&med<=35?"monthly":med>=84&&med<=100?"quarterly":med>=355&&med<=375?"yearly":null;
    if(!freq)continue;
    if(gaps.filter(g=>Math.abs(g-med)<=med*0.25).length<Math.ceil(gaps.length*0.66))continue;
    const amts=list.map(t=>Number(t.amount)),mAmt=ffxMedian(amts);
    if(amts.filter(a=>Math.abs(a-mAmt)<=mAmt*0.2).length<Math.ceil(amts.length*0.66))continue;
    const last=list[list.length-1],prevT=list[list.length-2];
    const sinceLast=ffxDaysBetween(last.date,ffxToday());if(sinceLast>med*2.5)continue; // looks cancelled
    const tracked=recurring.some(r=>r.type==="expense"&&(ffxNormDesc(r.description)===key||(r.category===last.category&&Math.abs(Number(r.amount)-mAmt)<=mAmt*0.1)));
    if(tracked&&!includeTracked)continue;
    if(ffx.dismissedSubs.includes(key))continue;
    const perMonth={weekly:52/12,monthly:1,quarterly:1/3,yearly:1/12}[freq];
    const priceUp=Number(last.amount)>Number(prevT.amount)*1.05?{from:Number(prevT.amount),to:Number(last.amount)}:null;
    let next=last.date;for(let i=0;next<=ffxToday()&&i<60;i++)next=ffxAddDays(next,Math.round(med));
    out.push({key,label:last.description||last.category,category:last.category,subcategory:last.subcategory||"",accountId:last.accountId,freq,amount:Number(last.amount),monthly:ffxPA(last)*perMonth,count:list.length,last,next,priceUp,tracked});
  }
  return out.sort((a,b)=>b.monthly-a.monthly);
}
function trackSubscription(key){
  const s=ffxDetectSubscriptions(false).find(x=>x.key===key);if(!s)return;
  const freq=s.freq==="quarterly"?"monthly":s.freq;
  addRecurring({id:uid(),type:"expense",amount:s.amount,category:s.category,subcategory:s.subcategory,accountId:s.accountId,description:s.label,frequency:freq,nextDue:s.next,anchorDate:s.next,active:true});
  showToast("🔁 Added to recurring — you'll be reminded before it's due","green");ffxRender();render();
}
function dismissSubscription(key){ffx.dismissedSubs.push(key);save();ffxRender();}
function ffxSubsHTML(){
  const subs=ffxDetectSubscriptions(false),tracked=ffxDetectSubscriptions(true).filter(s=>s.tracked);
  const monthly=subs.concat(tracked).reduce((s,x)=>s+x.monthly,0);
  const card=(s,isTracked)=>`<div class="card"><div class="flex-b"><div class="flex g8" style="min-width:0"><div class="tx-icon" style="background:${clr(s.category)}22;color:${clr(s.category)}">${catIcon(s.category)}</div><div style="min-width:0"><div class="fz13 fw7 ellip">${esc(s.label)}</div><div class="fz10 muted">${s.freq} · seen ${s.count}× · next about ${fmtD(s.next)}</div></div></div><div class="tac"><div class="fz13 fw8">${fmtK(s.amount)}</div><div class="fz9 muted">${fmtK(s.monthly)}/mo</div></div></div>
    ${s.priceUp?`<div class="ffx-wait late">▲ Price went up from ${fmt(s.priceUp.from)} to ${fmt(s.priceUp.to)}</div>`:""}
    ${isTracked?`<div class="fz10 green fw6 mt8">✓ Tracked in Recurring</div>`:`<div class="flex g6 mt10"><button class="btn btn-p btn-sm" onclick="trackSubscription('${escJs(s.key)}')">Track as recurring</button><button class="btn btn-g btn-sm" onclick="dismissSubscription('${escJs(s.key)}')">Not a subscription</button></div>`}</div>`;
  return`<div class="ffx-hero"><div class="fz11 muted">Subscriptions & repeat bills</div><div class="ffx-hero-num">${fmt(monthly)}<span class="fz12 muted"> /month</span></div><div class="fz11 muted">${fmt(monthly*12)} a year · found from your own history, no bank link</div></div>
    ${subs.length?`<div class="st-label">Detected — not tracked yet</div>${subs.map(s=>card(s,false)).join("")}`:`<div class="empty-state mb12"><div class="empty-ic">🔍</div><div class="fz13 fw7">No new repeat payments found</div><div class="fz11 muted mt4">Payments with the same description, a similar amount and a regular gap (weekly, monthly, quarterly or yearly) show up here after 3 occurrences.</div></div>`}
    ${tracked.length?`<div class="st-label mt12">Already tracked</div>${tracked.map(s=>card(s,true)).join("")}`:""}
    ${ffx.dismissedSubs.length?`<button class="btn btn-g btn-sm w100" style="justify-content:center" onclick="ffx.dismissedSubs=[];save();ffxRender()">Show ${ffx.dismissedSubs.length} dismissed again</button>`:""}`;
}

// ── 5. auto-categorization from rules & history (manual entry, quick entry, bank alerts) ──
function ffxSuggestCat(type,desc){
  if(!desc||!desc.trim())return null;
  try{
    const r=suggestStatementCategory({type,description:desc,amount:0,date:ffxToday(),accountId:""});
    if(r&&r.category&&r.category!=="Other"&&r.categoryReason&&!/conflicting/i.test(r.categoryReason))return{category:r.category,subcategory:r.subcategory||"",reason:r.categoryReason};
  }catch(e){}
  return null;
}
function ffxAutoCatTx(){
  if(window._txCatManual||window._txSplitMode)return;
  const d=$("txDesc");if(!d)return;
  const s=ffxSuggestCat(window._txT||"expense",d.value);
  let hint=$("txAutoCatHint");
  if(!hint&&s){const row=$("txCatLabel")?.closest("button")?.parentElement?.parentElement;if(row){hint=document.createElement("div");hint.id="txAutoCatHint";hint.className="fz10 accent mt4";row.insertAdjacentElement("afterend",hint);}}
  if(!s){if(hint)hint.textContent="";return;}
  window._txCat=s.category;window._txSub=s.subcategory;
  const lbl=$("txCatLabel");if(lbl)lbl.textContent=s.subcategory?s.category+" / "+s.subcategory:s.category;
  if(hint)hint.textContent="✨ "+s.reason;
}
function ffxRulesHTML(){
  return`<div class="ffx-hero"><div class="fz11 muted">Auto-categorization</div><div class="ffx-hero-num">${importRules.length}<span class="fz12 muted"> rule${importRules.length===1?"":"s"}</span></div><div class="fz11 muted">Applied to statement imports, Bank Alerts, manual entry and quick entry</div></div>
    <div class="msg msg-ok fz11 mb12" style="display:block">When a description contains your phrase (e.g. <b>"dstv"</b> or <b>"mtn"</b>), FinanceFlow fills in the category for you. If no rule matches, it reuses how you categorized the same description before.</div>
    <button class="btn btn-p w100 mb12" style="justify-content:center" onclick="closeTools();openSettings('rules')">Manage rules</button>
    ${importRules.length?`<div class="card" style="padding:4px 14px">${importRules.map(r=>`<div class="ffx-row"><span class="fz12">"${esc(r.phrase)}"</span><span class="fz11 muted">${esc(r.category)}${r.subcategory?" / "+esc(r.subcategory):""}</span></div>`).join("")}</div>`:""}`;
}

// ── 6. month / year in review ──
function ffxRecapRange(kind){
  const d=new Date();
  if(kind==="lastmonth"){d.setDate(1);d.setMonth(d.getMonth()-1);}
  if(kind==="lastyear")d.setFullYear(d.getFullYear()-1);
  const mode=kind.includes("year")?"year":"month";const r=getRangeFor(mode,d);
  const p=new Date(d);if(mode==="year")p.setFullYear(p.getFullYear()-1);else{p.setDate(1);p.setMonth(p.getMonth()-1);}
  const pr=getRangeFor(mode,p);
  return{start:r.startStr,end:r.endStr,pstart:pr.startStr,pend:pr.endStr,label:mode==="year"?String(d.getFullYear()):MO[d.getMonth()]+" "+d.getFullYear()};
}
function ffxRecapData(kind){
  const R=ffxRecapRange(kind),inR=t=>t.date>=R.start&&t.date<=R.end;
  const list=txns.filter(inR),exp=list.filter(t=>t.type==="expense"),inc=list.filter(t=>t.type==="income");
  const sum=a=>a.reduce((s,t)=>s+ffxPA(t),0);
  const E=sum(exp),I=sum(inc),prevE=sum(txns.filter(t=>t.type==="expense"&&t.date>=R.pstart&&t.date<=R.pend));
  const cats={};exp.forEach(t=>cats[t.category]=(cats[t.category]||0)+ffxPA(t));
  const payees={};exp.forEach(t=>{const k=(t.description||"").trim();if(k)payees[k]=(payees[k]||0)+1;});
  const days={};exp.forEach(t=>days[t.date]=(days[t.date]||0)+ffxPA(t));
  const wd=[0,0,0,0,0,0,0];exp.forEach(t=>{const d=FinanceCore.date(t.date);if(d)wd[d.getDay()]+=ffxPA(t);});
  const endCap=R.end<ffxToday()?R.end:ffxToday();const span=Math.max(0,ffxDaysBetween(R.start,endCap)+1);
  const biggest=exp.slice().sort((a,b)=>ffxPA(b)-ffxPA(a))[0];
  return{label:R.label,E,I,net:I-E,rate:I>0?(I-E)/I*100:0,count:list.length,
    top:Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,3),
    payee:Object.entries(payees).sort((a,b)=>b[1]-a[1])[0]||null,
    biggest,noSpend:Math.max(0,span-Object.keys(days).length),span,
    weekday:wd.some(v=>v)?["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"][wd.indexOf(Math.max(...wd))]:null,
    fees:sum(list.filter(ffxIsFee)),change:prevE>0?(E-prevE)/prevE*100:null};
}
function ffxRecapHTML(){
  const kind=ffxState.recap||"month",r=ffxRecapData(kind);
  const tabs=[["month","This month"],["lastmonth","Last month"],["year","This year"],["lastyear","Last year"]];
  return`<div class="tab-row mb12">${tabs.map(([k,l])=>`<button class="tab-btn ${kind===k?"active":""}" onclick="ffxState.recap='${k}';ffxRender()">${l}</button>`).join("")}</div>
  ${r.count?`<div class="ffx-recap">
    <div class="fz11" style="opacity:.8">Your ${esc(r.label)} in review</div>
    <div class="ffx-recap-big">${fmt(r.E)}</div><div class="fz11" style="opacity:.85">spent across ${r.count} transactions${r.change!==null?` · ${r.change>=0?"▲":"▼"} ${Math.abs(r.change).toFixed(0)}% vs before`:""}</div>
    <div class="ffx-recap-grid">
      <div><div class="ffx-rl">Earned</div><div class="ffx-rv">${fmtK(r.I)}</div></div>
      <div><div class="ffx-rl">Saved</div><div class="ffx-rv">${r.I>0?r.rate.toFixed(0)+"%":"—"}</div></div>
      <div><div class="ffx-rl">No-spend days</div><div class="ffx-rv">${r.noSpend}</div></div>
      <div><div class="ffx-rl">Fees paid</div><div class="ffx-rv">${fmtK(r.fees)}</div></div>
    </div>
    ${r.top.length?`<div class="ffx-rl mt12">Top spending</div>${r.top.map(([c,v],i)=>`<div class="ffx-recap-row"><span>${i+1}. ${catIcon(c)} ${esc(c)}</span><b>${fmtK(v)}</b></div>`).join("")}`:""}
    ${r.biggest?`<div class="ffx-rl mt12">Biggest purchase</div><div class="ffx-recap-row"><span>${esc(r.biggest.description||r.biggest.category)}</span><b>${fmtK(ffxPA(r.biggest))}</b></div>`:""}
    ${r.payee?`<div class="ffx-rl mt12">Most frequent</div><div class="ffx-recap-row"><span>${esc(r.payee[0])}</span><b>${r.payee[1]}×</b></div>`:""}
    ${r.weekday?`<div class="fz11 mt12" style="opacity:.85">You spend the most on <b>${r.weekday}</b>.</div>`:""}
  </div>
  <button class="btn btn-p w100 mt12" style="justify-content:center" onclick="shareRecap()">📤 Share my recap</button>`
  :`<div class="empty-state"><div class="empty-ic">📅</div><div class="fz13 fw7">Nothing recorded for ${esc(r.label)}</div></div>`}`;
}
function shareRecap(){
  const r=ffxRecapData(ffxState.recap||"month");
  const W=1080,H=1350,c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d");
  const g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,"#1e3a8a");g.addColorStop(.55,"#4f46e5");g.addColorStop(1,"#9333ea");x.fillStyle=g;x.fillRect(0,0,W,H);
  x.fillStyle="rgba(255,255,255,.75)";x.font="600 34px sans-serif";x.fillText("My "+r.label+" in review",70,120);
  x.fillStyle="#fff";x.font="800 104px sans-serif";x.fillText(fmt(r.E),70,250);
  x.fillStyle="rgba(255,255,255,.8)";x.font="30px sans-serif";x.fillText("spent across "+r.count+" transactions",70,305);
  const stats=[["Earned",fmtK(r.I)],["Saved",r.I>0?r.rate.toFixed(0)+"%":"—"],["No-spend days",String(r.noSpend)],["Fees paid",fmtK(r.fees)]];
  stats.forEach(([l,v],i)=>{const cx=70+(i%2)*470,cy=380+Math.floor(i/2)*190;x.fillStyle="rgba(255,255,255,.12)";x.beginPath();roundRectPath(x,cx,cy,440,160,28);x.fill();x.fillStyle="rgba(255,255,255,.7)";x.font="28px sans-serif";x.fillText(l,cx+32,cy+56);x.fillStyle="#fff";x.font="800 54px sans-serif";x.fillText(v,cx+32,cy+125);});
  let y=820;x.fillStyle="rgba(255,255,255,.7)";x.font="600 30px sans-serif";x.fillText("Top spending",70,y);y+=60;
  r.top.forEach(([cat,v],i)=>{x.fillStyle="#fff";x.font="600 36px sans-serif";x.fillText((i+1)+". "+cat,70,y);x.textAlign="right";x.fillText(fmtK(v),W-70,y);x.textAlign="left";y+=64;});
  if(r.weekday){x.fillStyle="rgba(255,255,255,.85)";x.font="30px sans-serif";x.fillText("I spend the most on "+r.weekday+".",70,y+30);}
  x.fillStyle="rgba(255,255,255,.6)";x.font="26px sans-serif";x.fillText("Made with FinanceFlow — your money, on your device.",70,H-70);
  const url=c.toDataURL("image/png");
  if(window.Android&&window.Android.shareImage)window.Android.shareImage(url.split(",")[1],"My "+r.label+" recap");
  else{const a=document.createElement("a");a.href=url;a.download="financeflow_recap.png";a.click();showToast("💾 Downloaded recap image","green");}
}

// ── 7. ajo / esusu circles ──
const FFX_FREQ_DAYS={daily:1,weekly:7,monthly:null};
function ffxAjoRoundDate(a,i){
  if(a.frequency==="monthly"){const d=FinanceCore.date(a.startDate);const day=d.getDate();const t=new Date(d.getFullYear(),d.getMonth()+i,1);t.setDate(Math.min(day,new Date(t.getFullYear(),t.getMonth()+1,0).getDate()));return toLocalISODate(t);}
  return ffxAddDays(a.startDate,i*(FFX_FREQ_DAYS[a.frequency]||7));
}
function ffxAjoRounds(a){
  // one full cycle: every member collects once; you contribute every round
  return a.members.map((m,i)=>({i,date:ffxAjoRoundDate(a,i),collector:m,paid:!!(a.paid||{})[i],collected:!!(a.collected||{})[i],memberPaid:(a.memberPaid||{})[i]||[]}));
}
function ffxAjoSummary(a){
  const rounds=ffxAjoRounds(a),today=ffxToday();
  const nextPay=rounds.find(r=>!r.paid);const mine=rounds.find(r=>r.collector===a.me);
  const pool=Number(a.amount)*a.members.length;
  return{rounds,nextPay,mine,pool,paidCount:rounds.filter(r=>r.paid).length,current:rounds.find(r=>r.date>=today)||rounds[rounds.length-1]};
}
function addAjoCircle(){
  const name=$("ajoName").value.trim(),amount=ffxNum($("ajoAmt").value),frequency=$("ajoFreq").value,startDate=$("ajoStart").value;
  const others=$("ajoMembers").value.split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
  const pos=Math.max(1,Math.min(others.length+1,parseInt($("ajoPos").value,10)||1));
  if(!name)return alert("Give the circle a name");if(!(amount>0))return alert("Enter the contribution amount");
  if(!FinanceCore.date(startDate))return alert("Pick the date of the first contribution");
  if(others.length<1)return alert("Add at least one other member");
  const me="You";const members=others.slice();members.splice(pos-1,0,me);
  ffx.ajo.push({id:uid(),name,amount,frequency,startDate,members,me,accountId:$("ajoAcc").value||accounts[0]?.id||"",record:$("ajoRecord").checked,paid:{},collected:{},memberPaid:{},createdAt:ffxToday()});
  save();ffxDetail=null;ffxState.ajoForm=false;ffxRender();showToast("🤝 Ajo circle added","green");
}
function ajoMarkPaid(id,i){
  const a=ffx.ajo.find(x=>x.id===id);if(!a)return;a.paid=a.paid||{};
  if(a.paid[i]){if(!confirm("Undo your contribution for this round?"))return;delete a.paid[i];}
  else{a.paid[i]=ffxToday();if(a.record&&accounts.some(x=>x.id===a.accountId)){txns.push({id:uid(),date:ffxToday(),description:"Ajo: "+a.name+" (round "+(i+1)+")",tags:[],amount:Number(a.amount),type:"expense",category:ffxCatOr("expense","Ajo & Esusu"),subcategory:"Contribution",accountId:a.accountId,projectId:""});}
    showToast("✓ Contribution recorded","green");}
  save();ffxRender();render();
}
function ajoMarkCollected(id,i){
  const a=ffx.ajo.find(x=>x.id===id);if(!a)return;a.collected=a.collected||{};
  if(a.collected[i])return;
  const pool=Number(a.amount)*a.members.length;
  if(!confirm("Mark your payout of "+fmt(pool)+" as collected?"))return;
  a.collected[i]=ffxToday();
  if(a.record&&accounts.some(x=>x.id===a.accountId))txns.push({id:uid(),date:ffxToday(),description:"Ajo payout: "+a.name,tags:[],amount:pool,type:"income",category:ffxCatOr("income","Ajo & Esusu"),subcategory:"Payout",accountId:a.accountId,projectId:""});
  save();ffxRender();render();showToast("🎉 Payout collected","green");
}
function ajoToggleMember(id,i,name){
  const a=ffx.ajo.find(x=>x.id===id);if(!a)return;a.memberPaid=a.memberPaid||{};const l=a.memberPaid[i]=a.memberPaid[i]||[];
  const k=l.indexOf(name);if(k>=0)l.splice(k,1);else l.push(name);save();ffxRender();
}
function deleteAjo(id){const i=ffx.ajo.findIndex(x=>x.id===id);if(i<0)return;const a=ffx.ajo[i];ffx.ajo.splice(i,1);save();ffxDetail=null;ffxRender();showUndoToast("Ajo circle deleted",()=>{ffx.ajo.splice(i,0,a);save();ffxRender();});}
function ajoShare(id){
  const a=ffx.ajo.find(x=>x.id===id);if(!a)return;const s=ffxAjoSummary(a),r=s.current;
  const paid=[...(r.paid?["You"]:[]),...r.memberPaid.filter(n=>n!=="You")],pending=a.members.filter(m=>!paid.includes(m));
  ffxShareText(`🤝 ${a.name} — Ajo update\nRound ${r.i+1} of ${a.members.length} · ${fmtD(r.date)}\nContribution: ${fmt(a.amount)} each · Payout: ${fmt(s.pool)} to ${r.collector}\n\n✅ Paid: ${paid.join(", ")||"no one yet"}\n⏳ Pending: ${pending.join(", ")||"none"}\n\nRotation: ${a.members.map((m,i)=>(i+1)+". "+m).join(", ")}`);
}
function ffxCatOr(type,name){const cats=type==="income"?getIC():getEC();return Object.hasOwn(cats,name)?name:(Object.hasOwn(cats,"Other")?"Other":Object.keys(cats)[0]);}
function ffxAjoHTML(){
  if(ffxDetail){
    const a=ffx.ajo.find(x=>x.id===ffxDetail);if(!a){ffxDetail=null;return ffxAjoHTML();}
    const s=ffxAjoSummary(a),today=ffxToday(),exp=ffxState.ajoRound;
    return`<div class="ffx-hero"><div class="fz11 muted">${esc(a.name)} · ${a.frequency} · ${a.members.length} members</div><div class="ffx-hero-num">${fmt(s.pool)}</div><div class="fz11 muted">payout per round · you contribute ${fmt(a.amount)} each round</div></div>
      <div class="grid2 mb12"><div class="stat"><div class="stat-label">Your payout</div><div class="stat-val accent">${s.mine?fmtD(s.mine.date):"—"}</div><div class="fz10 muted">Round ${s.mine?s.mine.i+1:"?"}${s.mine&&s.mine.collected?" · collected ✓":""}</div></div><div class="stat"><div class="stat-label">You've paid</div><div class="stat-val">${s.paidCount}/${a.members.length}</div><div class="fz10 muted">${fmt(s.paidCount*a.amount)} so far</div></div></div>
      <div class="card" style="padding:6px 0">${s.rounds.map(r=>{const due=r.date<=today&&!r.paid,isMe=r.collector===a.me;return`<div class="ffx-round ${r.date<=today?"past":""}">
        <div class="ffx-round-dot ${r.paid?"ok":due?"due":""}">${r.i+1}</div>
        <div style="flex:1;min-width:0" onclick="ffxState.ajoRound=${exp===r.i?"null":r.i};ffxRender()"><div class="fz12 fw7">${fmtD(r.date)} · ${isMe?"<span class='accent'>Your payout</span>":esc(r.collector)+" collects"}</div><div class="fz10 muted">${r.memberPaid.length+(r.paid?1:0)}/${a.members.length} paid · tap to tick members</div></div>
        <div class="flex g6">${isMe?(r.collected?`<span class="ffx-chip ok">Collected</span>`:`<button class="btn btn-p btn-sm" onclick="ajoMarkCollected('${escJs(a.id)}',${r.i})">Collect</button>`):""}<button class="btn btn-sm ${r.paid?"btn-g":"btn-p"}" onclick="ajoMarkPaid('${escJs(a.id)}',${r.i})">${r.paid?"Paid ✓":"Pay"}</button></div></div>
        ${exp===r.i?`<div class="ffx-members">${a.members.filter(m=>m!==a.me).map(m=>`<label class="ffx-member"><input type="checkbox" ${r.memberPaid.includes(m)?"checked":""} onchange="ajoToggleMember('${escJs(a.id)}',${r.i},'${escJs(m)}')"> ${esc(m)}</label>`).join("")}</div>`:""}`;}).join("")}</div>
      <div class="flex g6"><button class="btn btn-p" style="flex:1;justify-content:center" onclick="ajoShare('${escJs(a.id)}')">📤 Share status</button><button class="btn btn-rd" onclick="deleteAjo('${escJs(a.id)}')">Delete</button></div>
      <div class="fz10 muted mt8">${a.record?"Your contributions and payout are also recorded in "+esc(accName(a.accountId))+".":"This circle is tracked separately — it doesn't change your account balances."}</div>`;
  }
  const form=ffxState.ajoForm?`<div class="card"><div class="fz13 fw7 mb10">New ajo circle</div>
    <span class="edit-label">Circle name</span><input class="inp mb8" id="ajoName" placeholder="e.g. Office ajo">
    <div class="grid2" style="gap:8px"><div><span class="edit-label">Contribution</span><input class="inp" id="ajoAmt" inputmode="decimal" placeholder="10,000"></div><div><span class="edit-label">Every</span><select class="inp" id="ajoFreq"><option value="weekly">Week</option><option value="monthly" selected>Month</option><option value="daily">Day</option></select></div></div>
    <span class="edit-label mt8">First contribution date</span><input class="inp mb8" type="date" id="ajoStart" value="${ffxToday()}">
    <span class="edit-label">Other members, in collection order</span><textarea class="inp mb8" id="ajoMembers" rows="2" placeholder="Ada, Tunde, Chioma, Musa"></textarea>
    <div class="grid2" style="gap:8px"><div><span class="edit-label">Your turn to collect</span><input class="inp" id="ajoPos" type="number" min="1" value="1"></div><div><span class="edit-label">Account</span><select class="inp" id="ajoAcc">${accounts.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></div></div>
    <label class="flex g6 fz11 mt8"><input type="checkbox" id="ajoRecord" checked> Record my contributions and payout in this account</label>
    <div class="flex g6 mt12"><button class="btn btn-p" style="flex:1;justify-content:center" onclick="addAjoCircle()">Create circle</button><button class="btn btn-g" onclick="ffxState.ajoForm=false;ffxRender()">Cancel</button></div></div>`:"";
  const list=ffx.ajo.map(a=>{const s=ffxAjoSummary(a);return`<div class="card ffx-tap" onclick="ffxDetail='${escJs(a.id)}';ffxRender()"><div class="flex-b"><div style="min-width:0"><div class="fz13 fw7 ellip">${esc(a.name)}</div><div class="fz10 muted">${fmt(a.amount)} ${a.frequency} · ${a.members.length} members</div></div><div class="tac"><div class="fz10 muted">Your payout</div><div class="fz12 fw7 accent">${s.mine?fmtD(s.mine.date):"—"}</div></div></div>
    <div class="bar-track mt10"><div class="bar-fill" style="width:${s.paidCount/a.members.length*100}%;background:var(--accent)"></div></div><div class="fz10 muted mt4">${s.nextPay?"Next contribution "+fmtD(s.nextPay.date):"All contributions paid ✓"}</div></div>`;}).join("");
  return`<div class="ffx-hero"><div class="fz11 muted">Ajo & esusu circles</div><div class="ffx-hero-num">${ffx.ajo.length}</div><div class="fz11 muted">Track rotation, who has paid and your payout date — no money is held by the app</div></div>
    ${form||`<button class="btn btn-p w100 mb12" style="justify-content:center" onclick="ffxState.ajoForm=true;ffxRender()">+ New ajo circle</button>`}
    ${list||(form?"":`<div class="empty-state"><div class="empty-ic">🤝</div><div class="fz13 fw7">No circles yet</div><div class="fz11 muted mt4">Add your contribution group to get reminders before each payment and your payout.</div></div>`)}`;
}

// ── 8. debts & IOUs, bill split ──
function ffxDebtLeft(d){return Math.max(0,FinanceCore.round(Number(d.amount)-(d.payments||[]).reduce((s,p)=>s+Number(p.amount),0)));}
function addDebt(){
  const person=$("debtPerson").value.trim(),amount=ffxNum($("debtAmt").value),direction=$("debtDir").value,due=$("debtDue").value,note=$("debtNote").value.trim();
  if(!person)return alert("Who is it with?");if(!(amount>0))return alert("Enter the amount");
  ffx.debts.push({id:uid(),person,amount,direction,date:ffxToday(),due:FinanceCore.date(due)?due:"",note,payments:[]});
  save();ffxState.debtForm=false;ffxRender();showToast("🤝 Saved","green");
}
function debtRepay(id){
  const d=ffx.debts.find(x=>x.id===id);if(!d)return;const left=ffxDebtLeft(d);
  const v=prompt("Amount repaid (left: "+fmt(left)+")",String(left));if(v===null)return;const n=ffxNum(v);
  if(!(n>0))return alert("Enter a positive amount");d.payments=d.payments||[];d.payments.push({id:uid(),amount:Math.min(n,left),date:ffxToday()});
  save();ffxRender();showToast(ffxDebtLeft(d)?"Repayment recorded":"🎉 Fully settled","green");
}
function deleteDebt(id){const i=ffx.debts.findIndex(x=>x.id===id);if(i<0)return;const d=ffx.debts[i];ffx.debts.splice(i,1);save();ffxRender();showUndoToast("IOU deleted",()=>{ffx.debts.splice(i,0,d);save();ffxRender();});}
function debtRemind(id){
  const d=ffx.debts.find(x=>x.id===id);if(!d)return;const left=ffxDebtLeft(d);
  ffxShareText(d.direction==="lent"?`Hi ${d.person}, just a friendly reminder about the ${fmt(left)}${d.note?" for "+d.note:""} from ${fmtD(d.date)}${d.due?" (due "+fmtD(d.due)+")":""}. Thank you! 🙏`:`Hi ${d.person}, I haven't forgotten the ${fmt(left)}${d.note?" for "+d.note:""} I owe you. I'll pay ${d.due?"by "+fmtD(d.due):"soon"}. Thank you! 🙏`);
}
function splitBill(){
  const total=ffxNum($("splitTotal").value),what=$("splitWhat").value.trim()||"the bill";
  const people=$("splitPeople").value.split(/[,\n]/).map(s=>s.trim()).filter(Boolean);
  if(!(total>0))return alert("Enter the bill total");if(!people.length)return alert("Add who you split with");
  const share=FinanceCore.round(total/(people.length+1));
  people.forEach(p=>ffx.debts.push({id:uid(),person:p,amount:share,direction:"lent",date:ffxToday(),due:"",note:what,payments:[]}));
  save();ffxState.splitForm=false;ffxRender();
  ffxShareText(`🧾 ${what}: ${fmt(total)} split ${people.length+1} ways = ${fmt(share)} each.\n${people.map(p=>"• "+p+": "+fmt(share)).join("\n")}\n\nPlease send your share when you can. Thanks! 🙏`);
}
function ffxDebtsHTML(){
  const open=ffx.debts.filter(d=>ffxDebtLeft(d)>0),done=ffx.debts.filter(d=>ffxDebtLeft(d)<=0);
  const owed=open.filter(d=>d.direction==="lent").reduce((s,d)=>s+ffxDebtLeft(d),0),owe=open.filter(d=>d.direction==="borrowed").reduce((s,d)=>s+ffxDebtLeft(d),0);
  const today=ffxToday();
  const row=d=>{const left=ffxDebtLeft(d),paid=Number(d.amount)-left,over=d.due&&d.due<today&&left>0;return`<div class="card"><div class="flex-b"><div class="flex g8" style="min-width:0"><div class="ffx-avatar ${d.direction}">${esc(d.person.charAt(0).toUpperCase())}</div><div style="min-width:0"><div class="fz13 fw7 ellip">${esc(d.person)}</div><div class="fz10 muted ellip">${d.direction==="lent"?"Owes you":"You owe"}${d.note?" · "+esc(d.note):""}</div></div></div><div class="tac"><div class="fz14 fw8 ${d.direction==="lent"?"green":"red"}">${fmt(left)}</div><div class="fz9 muted">of ${fmt(d.amount)}</div></div></div>
    ${paid>0&&left>0?`<div class="bar-track mt8"><div class="bar-fill" style="width:${paid/d.amount*100}%;background:var(--green)"></div></div>`:""}
    ${d.due?`<div class="fz10 mt6 ${over?"red fw7":"muted"}">${over?"Overdue since ":"Due "}${fmtD(d.due)}</div>`:""}
    ${left>0?`<div class="flex g6 mt10"><button class="btn btn-p btn-sm" onclick="debtRepay('${escJs(d.id)}')">Record repayment</button><button class="btn btn-g btn-sm" onclick="debtRemind('${escJs(d.id)}')">📤 Remind</button><button class="btn btn-g btn-sm" onclick="deleteDebt('${escJs(d.id)}')">Delete</button></div>`:`<div class="flex-b mt8"><span class="fz10 green fw6">✓ Settled</span><button class="btn btn-g btn-sm" onclick="deleteDebt('${escJs(d.id)}')">Delete</button></div>`}</div>`;};
  const form=ffxState.debtForm?`<div class="card"><div class="fz13 fw7 mb10">New IOU</div>
    <div class="tab-row mb10"><button type="button" class="tab-btn ${ffxState.debtDir!=="borrowed"?"active":""}" onclick="ffxState.debtDir='lent';ffxRender()">I lent</button><button type="button" class="tab-btn ${ffxState.debtDir==="borrowed"?"active":""}" onclick="ffxState.debtDir='borrowed';ffxRender()">I borrowed</button></div><input type="hidden" id="debtDir" value="${ffxState.debtDir==="borrowed"?"borrowed":"lent"}">
    <div class="grid2" style="gap:8px"><div><span class="edit-label">Person</span><input class="inp" id="debtPerson" placeholder="e.g. Tunde"></div><div><span class="edit-label">Amount</span><input class="inp" id="debtAmt" inputmode="decimal" placeholder="20,000"></div></div>
    <div class="grid2 mt8" style="gap:8px"><div><span class="edit-label">Due date (optional)</span><input class="inp" type="date" id="debtDue"></div><div><span class="edit-label">For (optional)</span><input class="inp" id="debtNote" placeholder="e.g. school fees"></div></div>
    <div class="flex g6 mt12"><button class="btn btn-p" style="flex:1;justify-content:center" onclick="addDebt()">Save</button><button class="btn btn-g" onclick="ffxState.debtForm=false;ffxRender()">Cancel</button></div></div>`:"";
  const split=ffxState.splitForm?`<div class="card"><div class="fz13 fw7 mb10">Split a bill</div>
    <div class="grid2" style="gap:8px"><div><span class="edit-label">Total you paid</span><input class="inp" id="splitTotal" inputmode="decimal" placeholder="45,000"></div><div><span class="edit-label">For</span><input class="inp" id="splitWhat" placeholder="e.g. Dinner"></div></div>
    <span class="edit-label mt8">Split with (you're included automatically)</span><input class="inp" id="splitPeople" placeholder="Ada, Tunde">
    <div class="flex g6 mt12"><button class="btn btn-p" style="flex:1;justify-content:center" onclick="splitBill()">Split & share</button><button class="btn btn-g" onclick="ffxState.splitForm=false;ffxRender()">Cancel</button></div></div>`:"";
  return`<div class="grid2 mb12"><div class="ffx-hero" style="margin:0"><div class="fz11 muted">Owed to you</div><div class="ffx-hero-num green" style="font-size:24px">${fmt(owed)}</div></div><div class="ffx-hero" style="margin:0"><div class="fz11 muted">You owe</div><div class="ffx-hero-num red" style="font-size:24px">${fmt(owe)}</div></div></div>
    ${form||split||`<div class="flex g6 mb12"><button class="btn btn-p" style="flex:1;justify-content:center" onclick="ffxState.debtForm=true;ffxRender()">+ New IOU</button><button class="btn btn-g" style="flex:1;justify-content:center" onclick="ffxState.splitForm=true;ffxRender()">🧾 Split a bill</button></div>`}
    ${open.length?open.sort((a,b)=>(a.due||"9").localeCompare(b.due||"9")).map(row).join(""):(form||split?"":`<div class="empty-state"><div class="empty-ic">🤝</div><div class="fz13 fw7">No open IOUs</div><div class="fz11 muted mt4">Track money you lend to or borrow from family and friends, and send polite reminders.</div></div>`)}
    ${done.length?`<div class="st-label mt12">Settled</div>${done.map(row).join("")}`:""}
    <div class="fz10 muted tac mt8">IOUs are a separate ledger — they don't change your account balances.</div>`;
}

// ── 9. cash-flow forecast ──
function ffxForecast(days){
  const today=ffxToday(),end=ffxAddDays(today,days),events=[];
  recurring.filter(r=>r.active&&Number(r.amount)>0).forEach(r=>{
    let d=r.nextDue;for(let i=0;d&&i<500&&d<=end;i++){if(d>=today&&!scheduledPayments.some(p=>p.templateId===r.id&&p.date===d))events.push({date:d,amount:(r.type==="income"?1:-1)*ffxPA(r),label:r.description||r.category,kind:"recurring"});const n=advanceDate(d,r.frequency,r.anchorDate);if(!n||n<=d)break;d=n;}
  });
  scheduledPayments.filter(p=>p.status==="pending").forEach(p=>events.push({date:p.date<today?today:p.date,amount:(p.type==="income"?1:-1)*ffxPA(p),label:(p.description||p.category)+(p.date<today?" (overdue)":""),kind:"scheduled"}));
  ffx.debts.forEach(d=>{const left=ffxDebtLeft(d);if(left>0&&d.due&&d.due<=end)events.push({date:d.due<today?today:d.due,amount:d.direction==="lent"?left:-left,label:(d.direction==="lent"?"Repayment from ":"Repay ")+d.person,kind:"iou"});});
  ffx.ajo.forEach(a=>ffxAjoRounds(a).forEach(r=>{if(r.date>=today&&r.date<=end){if(!r.paid)events.push({date:r.date,amount:-Number(a.amount),label:"Ajo: "+a.name,kind:"ajo"});if(r.collector===a.me&&!r.collected)events.push({date:r.date,amount:Number(a.amount)*a.members.length,label:"Ajo payout: "+a.name,kind:"ajo"});}}));
  events.sort((a,b)=>a.date.localeCompare(b.date));
  // discretionary spend estimate: average daily spend excluding entries that came from recurring templates
  const span=90,from=ffxAddDays(today,-span);
  const recurringIds=new Set(txns.filter(t=>t.source==="Recurring").map(t=>t.id));
  const firstTx=txns.filter(t=>t.type==="expense").reduce((m,t)=>t.date<m?t.date:m,today);
  const days90=Math.max(14,Math.min(span,ffxDaysBetween(firstTx,today)+1));
  const disc=txns.filter(t=>t.type==="expense"&&t.date>=from&&!recurringIds.has(t.id)).reduce((s,t)=>s+ffxPA(t),0)/days90;
  const start=ffxTotalBalance();let conf=start,est=start,low={v:start,date:today},lowConf={v:start,date:today};const pts=[];
  for(let i=0;i<=days;i++){const d=ffxAddDays(today,i);events.filter(e=>e.date===d).forEach(e=>{conf+=e.amount;est+=e.amount;});if(i>0)est-=disc;pts.push({d,conf,est});if(est<low.v)low={v:est,date:d};if(conf<lowConf.v)lowConf={v:conf,date:d};}
  return{start,events,disc,pts,low,lowConf,endEst:est,endConf:conf};
}
function ffxForecastHTML(){
  const days=ffxState.fcDays||30,f=ffxForecast(days);
  const W=320,H=150,P=8,vals=f.pts.flatMap(p=>[p.conf,p.est]),mx=Math.max(...vals,0),mn=Math.min(...vals,0),rng=mx-mn||1;
  const X=i=>P+i*(W-2*P)/days,Y=v=>P+(mx-v)/rng*(H-2*P);
  const line=k=>f.pts.map((p,i)=>(i?"L":"M")+X(i).toFixed(1)+","+Y(p[k]).toFixed(1)).join(" ");
  const zero=Y(0);const lowI=f.pts.findIndex(p=>p.d===f.low.date);
  const neg=f.low.v<0;
  return`<div class="tab-row mb12">${[30,60,90].map(n=>`<button class="tab-btn ${days===n?"active":""}" onclick="ffxState.fcDays=${n};ffxRender()">${n} days</button>`).join("")}</div>
    <div class="ffx-hero ${neg?"bad":""}"><div class="fz11 muted">Projected balance in ${days} days</div><div class="ffx-hero-num ${f.endEst<0?"red":""}">${fmt(f.endEst)}</div><div class="fz11 muted">from ${fmt(f.start)} today · lowest ${fmt(f.low.v)} on ${fmtD(f.low.date)}</div></div>
    ${neg?`<div class="msg msg-err fz11 mb12" style="display:block">⚠️ At your usual spending your balance could go below zero around <b>${fmtD(f.low.date)}</b>. Bills you've confirmed alone take it to ${fmt(f.lowConf.v)}.</div>`:""}
    <div class="card"><svg viewBox="0 0 ${W} ${H}" class="ffx-chart" preserveAspectRatio="none">
      ${mn<0?`<line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="var(--red)" stroke-dasharray="3 3" stroke-width="1" opacity=".6"/>`:""}
      <path d="${line("conf")}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${line("est")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      ${lowI>0?`<circle cx="${X(lowI)}" cy="${Y(f.low.v)}" r="4" fill="${neg?"var(--red)":"var(--warn)"}"/>`:""}
    </svg><div class="flex g10 fz10 muted mt6"><span><span class="ffx-key" style="background:var(--accent)"></span>With usual spending (${fmtK(f.disc)}/day)</span><span><span class="ffx-key dashed"></span>Confirmed items only</span></div></div>
    <div class="st-label mt12">Coming up</div>
    <div class="card" style="padding:4px 14px">${f.events.length?f.events.slice(0,40).map(e=>`<div class="ffx-row"><div style="min-width:0"><div class="fz12 fw6 ellip">${esc(e.label)}</div><div class="fz10 muted">${fmtD(e.date)} · ${{recurring:"Recurring",scheduled:"Awaiting confirmation",iou:"IOU",ajo:"Ajo"}[e.kind]}</div></div><div class="fz12 fw7 ${e.amount<0?"red":"green"}">${e.amount<0?"-":"+"}${fmt(Math.abs(e.amount))}</div></div>`).join(""):`<div class="fz11 muted tac" style="padding:14px">No recurring bills, IOUs or ajo dates in this window. Add recurring items to make the forecast sharper.</div>`}</div>
    <div class="fz10 muted tac mt8">Estimate only. Uses your recurring items, pending payments, IOU due dates, ajo rounds, and your average daily spending over the last 90 days.</div>`;
}

// ── 10. real value / naira erosion ──
function ffxLatestRate(){const r=ffx.fx.rates.slice().sort((a,b)=>a.date.localeCompare(b.date));return r[r.length-1]||null;}
function ffxRateOn(date){const r=ffx.fx.rates.filter(x=>x.date<=date).sort((a,b)=>a.date.localeCompare(b.date));return r[r.length-1]||ffx.fx.rates.slice().sort((a,b)=>a.date.localeCompare(b.date))[0]||null;}
function addFxRate(){
  const rate=ffxNum($("fxRate").value),date=$("fxDate").value,label=$("fxLabel").value,code=$("fxCode").value;
  if(!(rate>0))return alert("Enter how much "+currency.code+" buys one "+code);if(!FinanceCore.date(date))return alert("Pick a date");
  if(code!==ffx.fx.code){if(ffx.fx.rates.length&&!confirm("Switching the comparison currency clears the saved "+ffx.fx.code+" rates. Continue?"))return;ffx.fx={code,rates:[]};}
  ffx.fx.rates=ffx.fx.rates.filter(r=>r.date!==date);ffx.fx.rates.push({date,rate,label});save();ffxRender();showToast("Rate saved","green");
}
function deleteFxRate(date){ffx.fx.rates=ffx.fx.rates.filter(r=>r.date!==date);save();ffxRender();}
function ffxRealValueHTML(){
  const code=ffx.fx.code,sym=(CURRENCIES.find(c=>c.code===code)||{symbol:code+" "}).symbol;
  const latest=ffxLatestRate(),sorted=ffx.fx.rates.slice().sort((a,b)=>a.date.localeCompare(b.date)),first=sorted[0];
  const acc=accounts.find(a=>a.currency===code&&Number(a.fxRate)>0);
  const fmtA=v=>(Number(v)<0?"-":"")+sym+Math.abs(Number(v||0)).toLocaleString(undefined,{maximumFractionDigits:2,minimumFractionDigits:2});
  const tb=ffxTotalBalance();
  const form=`<div class="card"><div class="fz12 fw7 mb8">Add today's rate</div>
    <div class="grid2" style="gap:8px"><div><span class="edit-label">${esc(currency.code)} per 1</span><select class="inp" id="fxCode">${CURRENCIES.filter(c=>c.code!==currency.code).map(c=>`<option value="${c.code}" ${c.code===code?"selected":""}>${c.code}</option>`).join("")}</select></div><div><span class="edit-label">Rate</span><input class="inp" id="fxRate" inputmode="decimal" placeholder="${latest?latest.rate:acc?acc.fxRate:"e.g. 1550"}"></div></div>
    <div class="grid2 mt8" style="gap:8px"><div><span class="edit-label">Date</span><input class="inp" type="date" id="fxDate" value="${ffxToday()}"></div><div><span class="edit-label">Rate type</span><select class="inp" id="fxLabel"><option>Parallel</option><option>Official</option></select></div></div>
    <button class="btn btn-p w100 mt10" style="justify-content:center" onclick="addFxRate()">Save rate</button></div>`;
  if(currency.code===code)return form;
  if(!latest)return`<div class="ffx-hero"><div class="fz11 muted">What your money is really worth</div><div class="ffx-hero-num">—</div><div class="fz11 muted">Add the ${esc(code)} rate you see today to compare</div></div>${form}<div class="fz10 muted tac">FinanceFlow never fetches rates online. Enter the official or parallel rate you trust, as often as you like — each one becomes a data point.</div>`;
  const exp=ffxMonthRange(0),spent=txns.filter(t=>t.type==="expense"&&t.date>=exp.start&&t.date<=exp.end).reduce((s,t)=>s+ffxPA(t),0);
  const erosion=first&&first.date!==latest.date?(1-first.rate/latest.rate)*100:null;
  const now=new Date();
  const hist=netWorthHistory(6).map((h,i,arr)=>{const back=arr.length-1-i;const end=toLocalISODate(new Date(now.getFullYear(),now.getMonth()-back+1,0));const r=ffxRateOn(end>ffxToday()?ffxToday():end);return{label:h.label,v:r?h.val/r.rate:null};});
  return`<div class="ffx-hero"><div class="fz11 muted">Your net worth in ${esc(code)}</div><div class="ffx-hero-num">${fmtA(tb/latest.rate)}</div><div class="fz11 muted">${fmt(tb)} at ${fmt(latest.rate)} per ${esc(code)} (${esc(latest.label||"")}, ${fmtD(latest.date)})</div></div>
    ${erosion!==null?`<div class="card ffx-erosion ${erosion>0?"bad":"good"}"><div class="fz12 fw7">${erosion>0?"📉 The "+esc(currency.code)+" lost "+erosion.toFixed(1)+"% against the "+esc(code):"📈 The "+esc(currency.code)+" gained "+(-erosion).toFixed(1)+"% against the "+esc(code)}</div><div class="fz11 muted mt4">since ${fmtD(first.date)} (${fmt(first.rate)} → ${fmt(latest.rate)}). ${fmt(1000000)} held in cash since then is now worth ${fmtA(1000000/latest.rate)} instead of ${fmtA(1000000/first.rate)}.</div></div>`:""}
    <div class="grid2 mb12"><div class="stat"><div class="stat-label">Spent this month</div><div class="stat-val">${fmtA(spent/latest.rate)}</div></div><div class="stat"><div class="stat-label">Your runway in ${esc(code)}</div><div class="stat-val">${fmtA(ffxAvgDailySpend()/latest.rate)}<span class="fz10 muted">/day</span></div></div></div>
    ${hist.some(h=>h.v!==null)?`<div class="card"><div class="fz12 fw7 mb8">Net worth in ${esc(code)}, month by month</div>${hist.map(h=>`<div class="ffx-row"><span class="fz12">${esc(String(h.label))}</span><span class="fz12 fw7">${h.v===null?"—":fmtA(h.v)}</span></div>`).join("")}<div class="fz10 muted mt6">Each month uses the latest rate you saved on or before it.</div></div>`:""}
    ${form}
    <div class="card" style="padding:4px 14px">${sorted.slice().reverse().map(r=>`<div class="ffx-row"><span class="fz12">${fmtD(r.date)} · ${esc(r.label||"")}</span><span class="flex g8"><b class="fz12">${fmt(r.rate)}</b><button class="btn btn-g btn-sm" onclick="deleteFxRate('${r.date}')">✕</button></span></div>`).join("")}</div>`;
}

// ── 11. unusual spending ──
function ffxSpikes(){
  const today=ffxToday(),wkStart=ffxAddDays(today,-6),hist=ffxAddDays(today,-62),out=[];
  const cats={};
  txns.forEach(t=>{if(t.type!=="expense"||t.date<hist||t.date>today)return;const c=cats[t.category]=cats[t.category]||{now:0,prev:new Array(8).fill(0)};
    if(t.date>=wkStart)c.now+=ffxPA(t);else{const w=Math.floor(ffxDaysBetween(t.date,wkStart)/7);if(w>=0&&w<8)c.prev[w]+=ffxPA(t);}});
  const monthlyAvg=ffxAvgDailySpend()*30;
  for(const [cat,c] of Object.entries(cats)){
    const active=c.prev.filter(v=>v>0).length;if(active<3)continue;
    const avg=c.prev.reduce((s,v)=>s+v,0)/8;if(avg<=0)continue;
    const ratio=c.now/avg;if(ratio>=2&&c.now>=Math.max(monthlyAvg*0.05,1))out.push({cat,now:c.now,avg,ratio});
  }
  return out.sort((a,b)=>b.ratio-a.ratio);
}

// ── 12. natural-language quick entry ──
const FFX_KEYWORDS=[
  [/\b(fuel|petrol|pms|filling station)\b/,"Transportation","Fuel"],[/\b(uber|bolt|indrive|taxi|ride)\b/,"Transportation","Ride-hailing"],[/\b(bus|keke|okada|danfo|brt|train|transport)\b/,"Transportation","Public Transport"],
  [/\b(airtime|recharge|top ?up)\b/,"Communication","Airtime"],[/\b(data|bundle|internet sub)\b/,"Communication","Data"],
  [/\b(lunch|dinner|breakfast|food|chop|restaurant|suya|shawarma|amala|eba)\b/,"Food & Dining","Restaurants"],[/\b(groceries|grocery|market|supermarket|foodstuff|shoprite)\b/,"Food & Dining","Groceries"],[/\b(drink|drinks|beer|coke|water)\b/,"Food & Dining","Beverages"],
  [/\b(rent)\b/,"Housing","Rent"],[/\b(nepa|phcn|light bill|electricity|prepaid|token|ikedc|ekedc|aedc)\b/,"Power & Generator","Electricity Token"],[/\b(diesel)\b/,"Power & Generator","Diesel"],[/\b(gen|generator)\b/,"Power & Generator","Generator Fuel"],
  [/\b(dstv|gotv|startimes|netflix|showmax|spotify|youtube premium|apple music)\b/,"Entertainment","Streaming"],[/\b(cinema|movie|movies)\b/,"Entertainment","Movies"],
  [/\b(stamp duty)\b/,"Fees & Charges","Stamp Duty"],[/\b(transfer fee|charges?|fee)\b/,"Fees & Charges","Transfer Fee"],[/\b(sms alert)\b/,"Fees & Charges","SMS Alert"],
  [/\b(mum|mom|mummy|mama|dad|daddy|papa|parents)\b/,"Family Support","Parents"],[/\b(brother|sister|sibling)\b/,"Family Support","Siblings"],[/\b(family|black tax)\b/,"Family Support","Extended Family"],
  [/\b(ajo|esusu|thrift|contribution)\b/,"Ajo & Esusu","Contribution"],
  [/\b(church|tithe|offering|mosque|zakat|sadaqah)\b/,"Gifts & Donations","Religious"],[/\b(gift|birthday|wedding)\b/,"Gifts & Donations","Friends"],
  [/\b(hospital|clinic|doctor)\b/,"Health","Hospital"],[/\b(drugs|pharmacy|medicine)\b/,"Health","Pharmacy"],[/\b(gym)\b/,"Health","Gym"],
  [/\b(school fees|tuition|fees)\b/,"Education","Tuition"],[/\b(clothes|shoe|shoes|dress|shirt)\b/,"Shopping","Clothing"],[/\b(barber|salon|hair)\b/,"Shopping","Personal Care"]];
const FFX_INCOME_KEYWORDS=[[/\b(salary|pay ?day|wages)\b/,"Salary","Primary Job"],[/\b(freelance|gig|client)\b/,"Freelance",""],[/\b(sales|sold|customer)\b/,"Business","Sales"],[/\b(payout)\b/,"Ajo & Esusu","Payout"],[/\b(gift|gifted)\b/,"Gift",""]];
function parseQuickEntry(text){
  const raw=String(text||"").trim();if(!raw)return null;let s=" "+raw.toLowerCase()+" ";
  const m=s.match(/(?:₦|ngn|\$|usd|n(?=\d))?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million|bn)?(?=[\s,.]|$)/i);
  if(!m)return{error:"Add an amount, e.g. \"5k fuel\" or \"2500 airtime\""};
  let amount=parseFloat(m[1].replace(/,/g,""));const mult={k:1e3,thousand:1e3,m:1e6,million:1e6,bn:1e9}[(m[2]||"").toLowerCase()]||1;amount=FinanceCore.round(amount*mult);
  s=s.replace(m[0]," ");
  let type=/^\s*\+/.test(raw)||/\b(salary|received|income|got paid|refund|payout|credited|earned|sold)\b/.test(s)?"income":"expense";
  s=s.replace(/^\s*\+/," ");
  let date=ffxToday();
  if(/\byesterday\b/.test(s)){date=ffxAddDays(date,-1);s=s.replace(/\byesterday\b/," ");}
  else{const dm=s.match(/\b(\d+)\s*days?\s*ago\b/);if(dm){date=ffxAddDays(date,-parseInt(dm[1],10));s=s.replace(dm[0]," ");}s=s.replace(/\btoday\b/," ");}
  let accountId=window._ffxLastAcc&&accounts.some(a=>a.id===window._ffxLastAcc)?window._ffxLastAcc:accounts[0]?.id,accMatched=false;
  const accs=accounts.slice().sort((a,b)=>b.name.length-a.name.length);
  for(const a of accs){const n=a.name.toLowerCase().trim();if(!n)continue;const re=new RegExp("\\b(?:from |with |via |on |by )?"+n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b");if(re.test(s)){accountId=a.id;accMatched=true;s=s.replace(re," ");break;}}
  if(!accMatched&&/\bcash\b/.test(s)){const c=accounts.find(a=>a.type==="cash");if(c){accountId=c.id;accMatched=true;s=s.replace(/\bcash\b/," ");}}
  s=s.replace(/\b(for|on|from|to|at|via|with|paid|pay|bought|spent|sent|send|gave|give|received)\b/g," ").replace(/\s+/g," ").trim();
  const description=s?s.replace(/\b\w/g,c=>c.toUpperCase()):"";
  const cats=type==="income"?getIC():getEC();
  let category="",subcategory="",reason="";
  const sug=ffxSuggestCat(type,description);
  if(sug&&Object.hasOwn(cats,sug.category)){category=sug.category;subcategory=sug.subcategory;reason=sug.reason;}
  else for(const [re,c,sub] of (type==="income"?FFX_INCOME_KEYWORDS:FFX_KEYWORDS)){if(re.test(" "+description.toLowerCase()+" ")&&Object.hasOwn(cats,c)){category=c;subcategory=(cats[c]||[]).includes(sub)?sub:"";reason="Matched “"+description+"”";break;}}
  if(!category){category=Object.hasOwn(cats,"Other")?"Other":Object.keys(cats)[0]||"";subcategory=(cats[category]||[])[0]||"";}
  return{amount,type,date,accountId,accMatched,description,category,subcategory,reason};
}
function openQuickEntry(text){
  const p=parseQuickEntry(text);
  if(!p)return;if(p.error){showToast(p.error,"warn");return;}
  window._qe=p;window._qeT=p.type;window._qeCat=p.category;window._qeSub=p.subcategory;window._qeAcc=p.accountId;
  ffxQuickSheet();
}
function ffxQuickSheet(){
  const p=window._qe;if(!p)return;
  $("modal-container").innerHTML=`<div class="modal-bg" onclick="showModal('close')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-handle"></div>
    <div class="flex-b mb12"><span class="fz16 fw7">⚡ Quick add</span><button class="btn" style="padding:2px;color:var(--muted)" onclick="showModal('close')">&#10005;</button></div>
    <div class="ffx-qe-amt ${window._qeT==="income"?"green":"red"}">${window._qeT==="income"?"+":"-"}${fmt(p.amount)}</div>
    <div class="tab-row mb10"><button class="tab-btn ${window._qeT==="expense"?"active":""}" onclick="ffxQeType('expense')">Expense</button><button class="tab-btn ${window._qeT==="income"?"active":""}" onclick="ffxQeType('income')">Income</button></div>
    <span class="edit-label">Description</span><input class="inp mb8" id="qeDesc" value="${esc(p.description)}">
    <div class="grid2" style="gap:8px"><div><span class="edit-label">Category</span><button type="button" class="inp" style="text-align:left;display:flex;justify-content:space-between;align-items:center" onclick="openCatPicker('_qeT','_qeCat','_qeSub','qeCatLabel')"><span id="qeCatLabel" class="ellip">${esc(window._qeSub?window._qeCat+" / "+window._qeSub:window._qeCat)}</span><span class="muted">›</span></button></div>
    <div><span class="edit-label">Account</span><button type="button" class="inp" style="text-align:left;display:flex;justify-content:space-between;align-items:center" onclick="openAccPicker('_qeAcc','qeAccLabel')"><span id="qeAccLabel" class="ellip">${esc(accName(window._qeAcc))}</span><span class="muted">›</span></button></div></div>
    <span class="edit-label mt8">Date</span><input class="inp" type="date" id="qeDate" value="${p.date}">
    ${p.reason?`<div class="fz10 accent mt8">✨ ${esc(p.reason)}</div>`:""}
    <button class="btn btn-p w100 mt12" style="justify-content:center;padding:13px" onclick="saveQuickEntry()">Save</button></div></div>`;
}
function ffxQeType(t){
  window._qeT=t;const desc=$("qeDesc")?.value||"";window._qe.description=desc;window._qe.date=$("qeDate")?.value||window._qe.date;
  const cats=t==="income"?getIC():getEC();const sug=ffxSuggestCat(t,desc);
  if(sug&&Object.hasOwn(cats,sug.category)){window._qeCat=sug.category;window._qeSub=sug.subcategory;}else{window._qeCat=Object.keys(cats)[0]||"";window._qeSub=(cats[window._qeCat]||[])[0]||"";}
  ffxQuickSheet();
}
function saveQuickEntry(){
  const p=window._qe;if(!p)return;const date=$("qeDate").value;
  if(!validEntry(p.amount,date,window._qeAcc))return;
  const t={id:uid(),date,description:$("qeDesc").value.trim(),tags:[],amount:p.amount,type:window._qeT,category:window._qeCat,subcategory:window._qeSub||"",accountId:window._qeAcc,projectId:""};
  txns.push(t);window._ffxLastAcc=t.accountId;save();checkBudgetAlerts(t);showModal("close");
  const qi=$("ffxQuickInput");if(qi)qi.value="";
  render();showUndoToast((t.type==="income"?"Added +":"Added -")+fmt(t.amount)+" · "+(t.description||t.category),()=>{const i=txns.indexOf(t);if(i>=0)txns.splice(i,1);save();});
}
function ffxQuickKey(e){if(e.key==="Enter"){e.preventDefault();openQuickEntry(e.target.value);}}

// ── 13. savings challenges on goals ──
const FFX_CHALLENGES={week52:{label:"52-week challenge",desc:"Save 1× the amount in week 1, 2× in week 2 … 52× in week 52"},weekly:{label:"Weekly fixed",desc:"Save the same amount every week"},daily:{label:"Daily streak",desc:"Save a small amount every day and build a streak"}};
function ffxChallengeStep(g){
  const c=g.challenge;if(!c)return null;
  if(c.type==="daily")return{key:ffxToday(),amount:Number(c.unit),label:"today"};
  const w=Math.max(0,Math.floor(ffxDaysBetween(c.start,ffxToday())/7));
  return{key:"w"+w,amount:c.type==="week52"?Number(c.unit)*(Math.min(w,51)+1):Number(c.unit),label:"week "+(w+1)};
}
function ffxStreak(g){
  const c=g.challenge;if(!c||c.type!=="daily")return 0;const set=new Set(c.checkins||[]);let n=0,d=ffxToday();
  if(!set.has(d))d=ffxAddDays(d,-1);while(set.has(d)){n++;d=ffxAddDays(d,-1);}return n;
}
function startChallenge(goalId){
  const g=goals.find(x=>x.id===goalId);if(!g)return;const type=$("chType_"+goalId).value,unit=ffxNum($("chUnit_"+goalId).value);
  if(!(unit>0))return alert("Enter an amount");g.challenge={type,unit,start:ffxToday(),checkins:[]};save();ffxRender();render();showToast("🔥 Challenge started","green");
}
function challengeCheckIn(goalId){
  const g=goals.find(x=>x.id===goalId);if(!g||!g.challenge)return;const st=ffxChallengeStep(g);
  if((g.challenge.checkins||[]).includes(st.key))return showToast("Already saved for "+st.label,"warn");
  g.challenge.checkins=g.challenge.checkins||[];g.challenge.checkins.push(st.key);g.saved=FinanceCore.round(Number(g.saved||0)+st.amount);
  save();ffxRender();render();showToast("💰 "+fmt(st.amount)+" saved to "+g.name+(g.saved>=g.target?" — goal reached! 🎉":""),"green");
}
function stopChallenge(goalId){const g=goals.find(x=>x.id===goalId);if(!g||!confirm("Stop this challenge? Money already saved stays in the goal."))return;delete g.challenge;save();ffxRender();render();}
function ffxChallengesHTML(){
  if(!goals.length)return`<div class="empty-state"><div class="empty-ic">🎯</div><div class="fz13 fw7">Create a savings goal first</div><div class="fz11 muted mt4 mb12">Challenges are attached to a goal, so every check-in moves it forward.</div><button class="btn btn-p btn-sm" onclick="closeTools();openSettings('goals')">+ New goal</button></div>`;
  return`<div class="msg msg-ok fz11 mb12" style="display:block">Pick a goal and a challenge. Each check-in adds the amount to the goal — move the actual money into savings when you check in.</div>`+goals.map(g=>{
    const c=g.challenge,pct=g.target>0?Math.min(100,g.saved/g.target*100):0;
    if(!c)return`<div class="card"><div class="flex-b mb8"><div class="fz13 fw7">${esc(g.name)}</div><div class="fz11 muted">${fmtK(g.saved)} / ${fmtK(g.target)}</div></div>
      <div class="grid2" style="gap:8px"><select class="inp" id="chType_${esc(g.id)}">${Object.entries(FFX_CHALLENGES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("")}</select><input class="inp" id="chUnit_${esc(g.id)}" inputmode="decimal" placeholder="Amount e.g. 1,000"></div>
      <div class="fz10 muted mt6">52-week with ₦1,000 saves ${fmt(1378000)} in a year.</div><button class="btn btn-p btn-sm mt8" onclick="startChallenge('${escJs(g.id)}')">Start challenge</button></div>`;
    const st=ffxChallengeStep(g),done=(c.checkins||[]).includes(st.key),streak=ffxStreak(g);
    const grid=c.type==="week52"?`<div class="ffx-52">${Array.from({length:52},(_,i)=>`<div class="${(c.checkins||[]).includes("w"+i)?"on":""} ${"w"+i===st.key?"now":""}"></div>`).join("")}</div>`:"";
    return`<div class="card"><div class="flex-b"><div><div class="fz13 fw7">${esc(g.name)}</div><div class="fz10 muted">${FFX_CHALLENGES[c.type].label} · ${(c.checkins||[]).length} check-in${(c.checkins||[]).length===1?"":"s"}</div></div>${c.type==="daily"?`<div class="ffx-streak">🔥 ${streak}</div>`:""}</div>
      <div class="bar-track mt8"><div class="bar-fill" style="width:${pct}%;background:${esc(g.color||"var(--green)")}"></div></div><div class="fz10 muted mt4">${fmt(g.saved)} of ${fmt(g.target)}</div>
      ${grid}
      <div class="flex g6 mt10"><button class="btn ${done?"btn-g":"btn-p"} btn-sm" ${done?"disabled":""} onclick="challengeCheckIn('${escJs(g.id)}')">${done?"✓ Saved for "+st.label:"Save "+fmt(st.amount)+" for "+st.label}</button><button class="btn btn-g btn-sm" onclick="stopChallenge('${escJs(g.id)}')">Stop</button></div></div>`;
  }).join("");
}

// ── tools hub, panel & navigation ──
const FFX_TOOLS=[
  {id:"forecast",icon:"📈",label:"Forecast",sub:"Balance 30–90 days ahead"},
  {id:"reversals",icon:"⏳",label:"Reversals",sub:"Failed debits"},
  {id:"ajo",icon:"🤝",label:"Ajo",sub:"Esusu circles"},
  {id:"debts",icon:"💸",label:"IOUs",sub:"Lent & borrowed"},
  {id:"subs",icon:"🔁",label:"Subscriptions",sub:"Repeat bills found"},
  {id:"fees",icon:"🏦",label:"Fees",sub:"Charges leaked"},
  {id:"realvalue",icon:"💵",label:"Real value",sub:"In dollars"},
  {id:"recap",icon:"🎉",label:"Recap",sub:"Month & year"},
  {id:"challenges",icon:"🔥",label:"Challenges",sub:"Save daily/weekly"},
  {id:"rules",icon:"✨",label:"Auto-rules",sub:"Categorize for me"}];
const FFX_RENDER={forecast:ffxForecastHTML,reversals:ffxReversalsHTML,ajo:ffxAjoHTML,debts:ffxDebtsHTML,subs:ffxSubsHTML,fees:ffxFeesHTML,realvalue:ffxRealValueHTML,recap:ffxRecapHTML,challenges:ffxChallengesHTML,rules:ffxRulesHTML,hub:ffxHubHTML};
function ffxHubHTML(){return`<div class="ffx-grid">${FFX_TOOLS.map(t=>`<button class="ffx-tile" onclick="openTool('${t.id}')"><span class="ffx-tile-ic">${t.icon}</span><span class="fz12 fw7">${t.label}</span><span class="fz10 muted">${t.sub}</span></button>`).join("")}</div>`;}
function openTool(id){if(typeof notifOpen!=="undefined"&&notifOpen)closeNotifCenter();if(ffxView&&ffxView!==id)ffxStack.push(ffxView);ffxView=id;ffxDetail=null;ffxRender();const b=document.querySelector("#toolsPanel .settings-body");if(b)b.scrollTop=0;}
function closeTools(){ffxView=null;ffxStack=[];ffxDetail=null;ffxState.ajoForm=ffxState.debtForm=ffxState.splitForm=false;const p=$("toolsPanel");if(p)p.innerHTML="";}
function ffxBack(){if(ffxDetail){ffxDetail=null;ffxRender();return;}if(ffxState.ajoForm||ffxState.debtForm||ffxState.splitForm){ffxState.ajoForm=ffxState.debtForm=ffxState.splitForm=false;ffxRender();return;}if(ffxStack.length){ffxView=ffxStack.pop();ffxRender();return;}closeTools();}
function ffxHandleBack(){if(!ffxView)return false;const po=$("pickerOverlay");if(po&&po.innerHTML.trim())return false;const mc=$("modal-container");if(mc&&mc.innerHTML.trim())return false;ffxBack();return true;}
function ffxRender(){
  if(!ffxView)return;
  let p=$("toolsPanel");if(!p){p=document.createElement("div");p.id="toolsPanel";document.body.appendChild(p);}
  const meta=FFX_TOOLS.find(t=>t.id===ffxView)||{icon:"🧰",label:"Money tools",sub:"Everything beyond the basics"};
  let body="";try{body=(FFX_RENDER[ffxView]||ffxHubHTML)();}catch(e){body=`<div class="msg msg-err">Something went wrong showing this tool: ${esc(e.message)}</div>`;}
  const keep=p.querySelector(".settings-body")?.scrollTop||0;
  p.innerHTML=`<div class="settings-panel" style="z-index:204"><div class="settings-drawer"><div class="settings-hdr"><button class="settings-back" onclick="ffxBack()" aria-label="Back">&#8592;</button><div style="flex:1;min-width:0"><div class="fz14 fw7">${meta.icon} ${meta.label}</div><div class="fz10 muted">${meta.sub}</div></div></div><div class="settings-body"><div class="st-section">${body}</div></div></div></div>`;
  const nb=p.querySelector(".settings-body");if(nb)nb.scrollTop=keep;
}

// ── Home "Money pulse" card ──
function ffxPulseHTML(){
  const rw=ffxRunway(),pend=ffxPendingReversals(),fm=ffxMonthRange(0),fees=ffxFeesIn(fm.start,fm.end).reduce((s,t)=>s+ffxPA(t),0);
  const subs=ffxDetectSubscriptions(false),spikes=ffxSpikes(),owed=ffx.debts.filter(d=>d.direction==="lent").reduce((s,d)=>s+ffxDebtLeft(d),0);
  let fc=null;try{fc=ffxForecast(30);}catch(e){}
  const chips=[];
  if(pend.length)chips.push(`<button class="ffx-pchip warn" onclick="openTool('reversals')">⏳ ${pend.length} awaiting reversal · ${fmtK(pend.reduce((s,t)=>s+ffxPA(t),0))}</button>`);
  if(fc&&fc.low.v<0)chips.push(`<button class="ffx-pchip bad" onclick="openTool('forecast')">⚠️ Balance may dip below zero ${fmtD(fc.low.date)}</button>`);
  if(spikes[0])chips.push(`<button class="ffx-pchip warn" onclick="goTo('stats')">📊 ${esc(spikes[0].cat)} is ${spikes[0].ratio.toFixed(1)}× your usual week</button>`);
  if(subs.length)chips.push(`<button class="ffx-pchip" onclick="openTool('subs')">🔁 ${subs.length} repeat bill${subs.length>1?"s":""} found · ${fmtK(subs.reduce((s,x)=>s+x.monthly,0))}/mo</button>`);
  if(fees>0)chips.push(`<button class="ffx-pchip" onclick="openTool('fees')">🏦 Fees this month ${fmtK(fees)}</button>`);
  if(owed>0)chips.push(`<button class="ffx-pchip good" onclick="openTool('debts')">🤝 Owed to you ${fmtK(owed)}</button>`);
  const days=rw.days,tone=days===null?"":days<14?"bad":days<45?"warn":"good";
  return`<div class="card ffx-pulse">
    <div class="flex-b"><div><div class="fz10 muted fw6" style="text-transform:uppercase;letter-spacing:.5px">Money runway</div><div class="ffx-runway ${tone}">${days===null?"—":days>999?"999+":days}<span> day${days===1?"":"s"}</span></div><div class="fz10 muted">${days===null?"Record some spending to see how long your money lasts":"Your balance at your usual "+fmtK(rw.avg)+"/day spending"}</div></div>
    <button class="ffx-pulse-btn" onclick="openTool('forecast')" aria-label="Open forecast">📈</button></div>
    <div class="ffx-qe"><span>⚡</span><input id="ffxQuickInput" placeholder="Quick add: “5k fuel cash”, “+250k salary gtbank”" enterkeyhint="done" onkeydown="ffxQuickKey(event)"><button onclick="openQuickEntry($('ffxQuickInput').value)" aria-label="Quick add">Add</button></div>
    ${chips.length?`<div class="ffx-pchips">${chips.join("")}</div>`:""}
    <div class="ffx-mini-grid">${FFX_TOOLS.slice(0,8).map(t=>`<button onclick="openTool('${t.id}')"><span>${t.icon}</span>${t.label}</button>`).join("")}</div>
    <button class="btn btn-g btn-sm w100 mt8" style="justify-content:center" onclick="openTool('hub')">All money tools ›</button>
  </div>`;
}

// ── extra badge/actions on the transaction edit sheet ──
function ffxEditExtras(t){
  if(!t||t.type!=="expense"||t.splitGroupId)return"";
  return t.reversalPending
    ?`<div class="msg msg-err fz11 mb10 flex-b"><span>⏳ Failed debit — awaiting reversal since ${fmtD(t.reversalPending.since)}</span><button class="btn btn-sm btn-g" onclick="showModal('close');openTool('reversals')">Open</button></div>`
    :`<button type="button" class="btn btn-g btn-sm mb10" onclick="markFailedDebit('${escJs(t.id)}')">⏳ Failed debit — track reversal</button>`;
}

// ── notifications from the tools ──
function ffxScanNotifications(){
  const today=ffxToday();
  ffxPendingReversals().forEach(t=>{
    const w=ffxDaysBetween(t.reversalPending.since||t.date,today);
    [3,7,14,30].forEach(n=>{if(w>=n)pushNotif(`rev:${t.id}:d${n}`,"reversal",`Still waiting on a reversal: ${fmtK(t.amount)}`,`${t.description||t.category} on ${fmtD(t.date)} — ${w} days. ${n>=7?"Time to raise a complaint with your bank.":"Check your account."}`,"tool:reversals");});
    ffxReversalCandidates(t).slice(0,1).forEach(c=>pushNotif(`rev:${t.id}:match:${c.id}`,"reversal","Possible reversal received",`${fmt(c.amount)} credit on ${fmtD(c.date)} matches your failed debit`,"tool:reversals"));
  });
  ffxDetectSubscriptions(false).forEach(s=>pushNotif("sub:"+s.key,"sub","Repeat payment found: "+s.label,`${fmt(s.amount)} ${s.freq} — track it so you're reminded before it's due`,"tool:subs"));
  ffxDetectSubscriptions(true).forEach(s=>{if(s.priceUp)pushNotif(`subup:${s.key}:${s.last.id}`,"sub","Price went up: "+s.label,`${fmt(s.priceUp.from)} → ${fmt(s.priceUp.to)}`,"tool:subs");});
  const wk=getRangeFor("week",new Date()).startStr;
  ffxSpikes().slice(0,3).forEach(s=>pushNotif(`spike:${s.cat}:${wk}`,"spike",`${s.cat} is ${s.ratio.toFixed(1)}× your usual week`,`${fmt(s.now)} in the last 7 days vs about ${fmt(s.avg)} normally`,"stats"));
  ffx.debts.forEach(d=>{const left=ffxDebtLeft(d);if(left>0&&d.due&&d.due<=ffxAddDays(today,1))pushNotif(`debt:${d.id}:${d.due}`,"debt",d.direction==="lent"?`${d.person} owes you ${fmtK(left)}`:`Repay ${d.person} ${fmtK(left)}`,d.due<today?"Overdue since "+fmtD(d.due):"Due "+fmtD(d.due),"tool:debts");});
  ffx.ajo.forEach(a=>ffxAjoRounds(a).forEach(r=>{
    if(!r.paid&&r.date>=ffxAddDays(today,-3)&&r.date<=ffxAddDays(today,1))pushNotif(`ajo:${a.id}:pay:${r.i}`,"ajo",`Ajo contribution due: ${a.name}`,`${fmt(a.amount)} · ${fmtD(r.date)} · ${r.collector} collects`,"tool:ajo");
    if(r.collector===a.me&&!r.collected&&r.date<=ffxAddDays(today,2)&&r.date>=ffxAddDays(today,-7))pushNotif(`ajo:${a.id}:collect:${r.i}`,"ajo",`Your ajo payout is due: ${a.name}`,`${fmt(Number(a.amount)*a.members.length)} on ${fmtD(r.date)}`,"tool:ajo");
  }));
  try{const f=ffxForecast(30);if(f.low.v<0)pushNotif("fc:"+today.slice(0,7)+":"+f.low.date.slice(0,7),"forecast","Your balance may run low",`At your usual spending it could dip to ${fmt(f.low.v)} around ${fmtD(f.low.date)}`,"tool:forecast");}catch(e){}
  goals.forEach(g=>{if(!g.challenge||g.saved>=g.target)return;const st=ffxChallengeStep(g);if(!(g.challenge.checkins||[]).includes(st.key)&&(g.challenge.type==="daily"?new Date().getHours()>=18:new Date().getDay()>=5||new Date().getDay()===0))pushNotif(`chal:${g.id}:${st.key}`,"challenge",`Keep your ${FFX_CHALLENGES[g.challenge.type].label} going`,`Save ${fmt(st.amount)} to ${g.name} for ${st.label}`,"tool:challenges");});
}
