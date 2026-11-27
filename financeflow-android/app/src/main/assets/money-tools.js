// FinanceFlow money tools: reversals, fees, subscriptions, runway, recap, ajo, IOUs, forecast,
// real-value FX view, spending spikes, quick entry and savings challenges.
// Loaded before the main script; everything here runs only when called, so it can use the
// main script's globals (txns, accounts, save, render, ...) without load-order problems.
'use strict';

let ffx={debts:[],ajo:[],reversalLog:[],dismissedSubs:[],templates:[],streakRepairs:[],sharedDeletes:[],savedFilters:[],milestones:[],projectIncome:[],monthStart:1,custom:null,prefs:{},fx:{code:"USD",rates:[]}};
let ffxView=null,ffxStack=[],ffxDetail=null,ffxState={};
const FFX_DAY=864e5;

// ── persistence ──
function ffxFresh(){return{debts:[],ajo:[],reversalLog:[],dismissedSubs:[],templates:[],streakRepairs:[],sharedDeletes:[],savedFilters:[],milestones:[],projectIncome:[],monthStart:1,custom:null,prefs:{},fx:{code:"USD",rates:[]}};}
function ffxNormalize(d){
  const f=ffxFresh();if(!d||typeof d!=="object")return f;
  for(const k of ["debts","ajo","reversalLog","dismissedSubs","templates","streakRepairs","sharedDeletes","savedFilters","milestones","projectIncome"])if(Array.isArray(d[k]))f[k]=d[k];
  if(d.fx&&typeof d.fx==="object"){f.fx.code=typeof d.fx.code==="string"?d.fx.code:"USD";f.fx.rates=Array.isArray(d.fx.rates)?d.fx.rates.filter(r=>r&&FinanceCore.date(r.date)&&Number(r.rate)>0):[];}
  if(typeof d.deviceId==="string")f.deviceId=d.deviceId.slice(0,40);
  for(const k of ["lastFamilySent"])if(typeof d[k]==="string")f[k]=d[k];
  if(d.lastFamilyReceived&&typeof d.lastFamilyReceived==="object")f.lastFamilyReceived={from:String(d.lastFamilyReceived.from||""),at:String(d.lastFamilyReceived.at||"")};
  const ms=Math.floor(Number(d.monthStart));if(ms>=1&&ms<=28)f.monthStart=ms;
  if(d.custom&&FinanceCore.date(d.custom.from)&&FinanceCore.date(d.custom.to)&&d.custom.from<=d.custom.to)f.custom={from:d.custom.from,to:d.custom.to};
  if(d.prefs&&typeof d.prefs==="object")f.prefs=Object.assign({},d.prefs);
  return f;
}
function ffxLoad(){try{ffx=ffxNormalize(JSON.parse(appStorage.getItem("ffd_tools")||"null"));}catch(e){ffx=ffxFresh();}}
function ffxSave(){appStorage.setItem("ffd_tools",JSON.stringify(ffx));}
function ffxValidateBackup(t){
  if(t===undefined)return;
  if(!t||typeof t!=="object"||Array.isArray(t))throw new Error("Invalid money tools data.");
  for(const k of ["debts","ajo","reversalLog","dismissedSubs"])if(t[k]!==undefined&&!Array.isArray(t[k]))throw new Error("Invalid money tools data.");
  for(const d of t.debts||[])if(!d||typeof d.person!=="string"||!(Number(d.amount)>0)||!["lent","borrowed"].includes(d.direction))throw new Error("Invalid IOU in backup.");
  for(const m of t.milestones||[])if(!m||typeof m.title!=="string"||typeof m.projectId!=="string")throw new Error("Invalid project milestone in backup.");
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
function ffxMonthRange(offset){const a=new Date(getRangeFor("month",new Date()).start);a.setMonth(a.getMonth()+offset);const r=getRangeFor("month",a);return{start:r.startStr,end:r.endStr,label:MO[a.getMonth()]};}
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
  let d=new Date();
  if(kind==="lastmonth"){d=new Date(getRangeFor("month",d).start);d.setMonth(d.getMonth()-1);}
  if(kind==="lastyear")d.setFullYear(d.getFullYear()-1);
  const mode=kind.includes("year")?"year":"month",r=getRangeFor(mode,d),pr=ffxPrevRange(mode,d);
  return{start:r.startStr,end:r.endStr,pstart:pr.startStr,pend:pr.endStr,label:mode==="year"?String(d.getFullYear()):ffxMonthStart()>1?ffxPeriodLabel("month",d):MO[d.getMonth()]+" "+d.getFullYear()};
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
    <div class="fz11 mt8" style="opacity:.9">${ffxLine("saved",r.rate)}</div>
  </div>
  <div class="flex g6 mt12"><button class="btn btn-p" style="flex:1;justify-content:center" onclick="openRecapStory()">▶ Play story</button><button class="btn btn-g" style="flex:1;justify-content:center" onclick="shareRecap()">📤 Share</button></div>`
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
    ${p.receipt?`<details class="fz10 muted mt8"><summary>📷 Read from your receipt${p.receipt.reference?" · ref "+esc(p.receipt.reference):""} — check the details</summary><div style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px">${esc(p.receipt.text).slice(0,2000)}</div></details>`:""}
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
  if(p.receipt){t.source="Receipt";if(p.receipt.reference)t.externalReference=p.receipt.reference;}else if(p.reason===""||t.category==="Other")t.needsReview=true;txns.push(t);ffxRememberAccount(t.accountId);haptic("success");save();checkBudgetAlerts(t);showModal("close");
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
  {id:"review",icon:"📥",label:"Review",sub:"Check new entries"},
  {id:"reversals",icon:"⏳",label:"Reversals",sub:"Failed debits"},
  {id:"ajo",icon:"🤝",label:"Ajo",sub:"Esusu circles"},
  {id:"debts",icon:"💸",label:"IOUs",sub:"Lent & borrowed"},
  {id:"subs",icon:"🔁",label:"Subscriptions",sub:"Repeat bills found"},
  {id:"fees",icon:"🏦",label:"Fees",sub:"Charges leaked"},
  {id:"realvalue",icon:"💵",label:"Real value",sub:"In dollars"},
  {id:"recap",icon:"🎉",label:"Recap",sub:"Month & year"},
  {id:"challenges",icon:"🔥",label:"Challenges",sub:"Save daily/weekly"},
  {id:"rules",icon:"✨",label:"Auto-rules",sub:"Categorize for me"}];
const FFX_RENDER={review:()=>ffxReviewHTML(),forecast:ffxForecastHTML,reversals:ffxReversalsHTML,ajo:ffxAjoHTML,debts:ffxDebtsHTML,subs:ffxSubsHTML,fees:ffxFeesHTML,realvalue:ffxRealValueHTML,recap:ffxRecapHTML,challenges:ffxChallengesHTML,rules:ffxRulesHTML,hub:ffxHubHTML};
function ffxHubHTML(){return`<div class="ffx-grid">${FFX_TOOLS.map(t=>`<button class="ffx-tile" onclick="openTool('${t.id}')"><span class="ffx-tile-ic">${t.icon}</span><span class="fz12 fw7">${t.label}</span><span class="fz10 muted">${t.sub}</span></button>`).join("")}</div>`;}
function openTool(id){if(typeof notifOpen!=="undefined"&&notifOpen)closeNotifCenter();if(ffxView&&ffxView!==id)ffxStack.push(ffxView);ffxView=id;ffxDetail=null;ffxRender();const b=document.querySelector("#toolsPanel .settings-body");if(b)b.scrollTop=0;}
function closeTools(){ffxView=null;ffxStack=[];ffxDetail=null;ffxState.ajoForm=ffxState.debtForm=ffxState.splitForm=false;const p=$("toolsPanel");if(p)p.innerHTML="";}
function ffxBack(){if(ffxDetail){ffxDetail=null;ffxRender();return;}if(ffxState.ajoForm||ffxState.debtForm||ffxState.splitForm){ffxState.ajoForm=ffxState.debtForm=ffxState.splitForm=false;ffxRender();return;}if(ffxStack.length){ffxView=ffxStack.pop();ffxRender();return;}closeTools();}
function ffxHandleBack(){if(ffxStoryOpen()){closeRecapStory();return true;}if(!ffxView)return false;const po=$("pickerOverlay");if(po&&po.innerHTML.trim())return false;const mc=$("modal-container");if(mc&&mc.innerHTML.trim())return false;ffxBack();return true;}
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
  const subs=ffxDetectSubscriptions(false),spikes=ffxSpikes(),owed=ffx.debts.filter(d=>d.direction==="lent").reduce((s,d)=>s+ffxDebtLeft(d),0),rev=ffxReviewList().length;
  let fc=null;try{fc=ffxForecast(30);}catch(e){}
  const pace=ffxPacing();
  const chips=[];
  const sc=ffxStreakChip();if(sc)chips.push(sc);
  if(rev)chips.push(`<button class="ffx-pchip accent" onclick="openTool('review')">📥 ${rev} to review</button>`);
  if(pend.length)chips.push(`<button class="ffx-pchip warn" onclick="openTool('reversals')">⏳ ${pend.length} awaiting reversal · ${fmtK(pend.reduce((s,t)=>s+ffxPA(t),0))}</button>`);
  if(fc&&fc.low.v<0)chips.push(`<button class="ffx-pchip bad" onclick="openTool('forecast')">⚠️ Balance may dip below zero ${fmtD(fc.low.date)}</button>`);
  if(spikes[0])chips.push(`<button class="ffx-pchip warn" onclick="goTo('stats')">📊 ${ffxLine("spike",esc(spikes[0].cat),spikes[0].ratio.toFixed(1))}</button>`);
  if(subs.length)chips.push(`<button class="ffx-pchip" onclick="openTool('subs')">🔁 ${subs.length} repeat bill${subs.length>1?"s":""} found · ${fmtK(subs.reduce((s,x)=>s+x.monthly,0))}/mo</button>`);
  if(fees>0)chips.push(`<button class="ffx-pchip" onclick="openTool('fees')">🏦 ${ffxLine("fees",fmtK(fees))}</button>`);
  if(owed>0)chips.push(`<button class="ffx-pchip good" onclick="openTool('debts')">🤝 Owed to you ${fmtK(owed)}</button>`);
  const days=rw.days,tone=days===null?"":days<14?"bad":days<45?"warn":"good";
  const head=pace?`<div class="flex-b" style="align-items:flex-start"><div style="min-width:0"><div class="ffx-eyebrow">${pace.left>=0?T("Left to spend this month"):T("Over this month's plan")}</div>
      <div class="ffx-left ${pace.left<0?"bad":pace.ahead?"warn":"good"}">${fmt(Math.abs(pace.left))}</div>
      <div class="fz11 muted">${pace.left>0?`<b class="${pace.ahead?"warn":"green"}">${fmtK(pace.perDay)}/day</b> for ${pace.daysLeft} day${pace.daysLeft===1?"":"s"} · `:""}${pace.ahead?ffxLine("ahead"):ffxLine("onpace")}</div></div>
      <button class="ffx-pulse-btn" onclick="openTool('forecast')" aria-label="Open forecast">📈</button></div>
    ${ffxPacingSVG(pace)}<div class="flex-b fz9 muted"><span>${fmtK(pace.spent)} spent of ${fmtK(pace.limit)} ${pace.src==="budget"?"monthly budgets":"(last month's spending)"}</span><span>Runway <b class="${tone==="bad"?"red":tone==="warn"?"warn":""}">${days===null?"—":days>999?"999+":days} days</b></span></div>`
    :`<div class="flex-b"><div><div class="ffx-eyebrow">${T("Money runway")}</div><div class="ffx-runway ${tone}">${days===null?"—":days>999?"999+":days}<span> day${days===1?"":"s"}</span></div><div class="fz10 muted">${days===null?"Record some spending to see how long your money lasts":"Your balance at your usual "+fmtK(rw.avg)+"/day spending"}</div></div>
    <button class="ffx-pulse-btn" onclick="openTool('forecast')" aria-label="Open forecast">📈</button></div>`;
  const ring=ffxTopCategories(8);
  return`<div class="card ffx-pulse">${head}
    <div class="ffx-eyebrow mt12">${T("Log in one tap")}</div>
    <div class="ffx-ring">${ring.map(([c,s])=>`<button onclick="ffxQuickCat('${escJs(c)}','${escJs(s)}')" aria-label="Add ${esc(s||c)} expense"><span style="background:${clr(c)}22;color:${clr(c)};border-color:${clr(c)}55">${catIcon(c)}</span><em>${esc(s||c)}</em></button>`).join("")}</div>
    <div class="ffx-qe"><span>⚡</span><input id="ffxQuickInput" placeholder="${esc(T("Or type: “5k fuel cash”, “+250k salary gtbank”"))}" enterkeyhint="done" onkeydown="ffxQuickKey(event)"><button class="ffx-qe-cam" onclick="startReceiptScan()" aria-label="Scan a receipt">📷</button><button onclick="openQuickEntry($('ffxQuickInput').value)" aria-label="Quick add">Add</button></div>
    ${chips.length?`<div class="ffx-pchips">${chips.join("")}</div>`:""}
    <div class="ffx-mini-grid">${FFX_TOOLS.slice(0,8).map(t=>`<button onclick="openTool('${t.id}')"><span>${t.icon}</span>${t.label}${t.id==="review"&&rev?`<i class="ffx-dot">${rev}</i>`:""}</button>`).join("")}</div>
    <button class="btn btn-g btn-sm w100 mt8" style="justify-content:center" onclick="openTool('hub')">${T("All money tools ›")}</button>
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
  ffxSpikes().slice(0,3).forEach(s=>pushNotif(`spike:${s.cat}:${wk}`,"spike",ffxLine("spike",s.cat,s.ratio.toFixed(1)),`${fmt(s.now)} in the last 7 days vs about ${fmt(s.avg)} normally`,"stats"));
  ffx.debts.forEach(d=>{const left=ffxDebtLeft(d);if(left>0&&d.due&&d.due<=ffxAddDays(today,1))pushNotif(`debt:${d.id}:${d.due}`,"debt",d.direction==="lent"?`${d.person} owes you ${fmtK(left)}`:`Repay ${d.person} ${fmtK(left)}`,d.due<today?"Overdue since "+fmtD(d.due):"Due "+fmtD(d.due),"tool:debts");});
  ffx.ajo.forEach(a=>ffxAjoRounds(a).forEach(r=>{
    if(!r.paid&&r.date>=ffxAddDays(today,-3)&&r.date<=ffxAddDays(today,1))pushNotif(`ajo:${a.id}:pay:${r.i}`,"ajo",`Ajo contribution due: ${a.name}`,`${fmt(a.amount)} · ${fmtD(r.date)} · ${r.collector} collects`,"tool:ajo");
    if(r.collector===a.me&&!r.collected&&r.date<=ffxAddDays(today,2)&&r.date>=ffxAddDays(today,-7))pushNotif(`ajo:${a.id}:collect:${r.i}`,"ajo",`Your ajo payout is due: ${a.name}`,`${fmt(Number(a.amount)*a.members.length)} on ${fmtD(r.date)}`,"tool:ajo");
  }));
  try{ffxScanProjects();}catch(e){}
  try{const f=ffxForecast(30);if(f.low.v<0)pushNotif("fc:"+today.slice(0,7)+":"+f.low.date.slice(0,7),"forecast","Your balance may run low",`At your usual spending it could dip to ${fmt(f.low.v)} around ${fmtD(f.low.date)}`,"tool:forecast");}catch(e){}
  const st=ffxStreak2();if(st.streak>=2&&!st.thisWeek&&new Date().getDay()>=5)pushNotif("streak:"+ffxWeekKey(today),"challenge",`Keep your ${st.streak}-week streak`,"Log at least one transaction this week to keep it going","");
  if(st.repairable)pushNotif("streakfix:"+st.prev,"challenge",`Your ${st.before}-week streak broke`,"You can repair it once a month — tap to open Home","");
  goals.forEach(g=>{if(!g.challenge||g.saved>=g.target)return;const st=ffxChallengeStep(g);if(!(g.challenge.checkins||[]).includes(st.key)&&(g.challenge.type==="daily"?new Date().getHours()>=18:new Date().getDay()>=5||new Date().getDay()===0))pushNotif(`chal:${g.id}:${st.key}`,"challenge",`Keep your ${FFX_CHALLENGES[g.challenge.type].label} going`,`Save ${fmt(st.amount)} to ${g.name} for ${st.label}`,"tool:challenges");});
}

// ════════════════ UX layer: privacy, haptics, pacing, one-tap entry, favourites,
// swipe gestures, review inbox, demo data ════════════════
let privacyMode=false,uxPrefs={haptics:true,secureRecents:true};
function uxLoad(){
  try{privacyMode=appStorage.getItem("ffd_privacy")==="1";}catch(e){}
  try{uxPrefs=Object.assign({haptics:true,secureRecents:true},JSON.parse(appStorage.getItem("ffd_uxprefs")||"{}"));}catch(e){}
  try{const la=appStorage.getItem("ffd_lastacc");if(la)window._ffxLastAcc=la;}catch(e){}
  if(document.body)document.body.classList.toggle("lite",!!uxPrefs.lite);if(uxPrefs.lite)txRenderLimit=80;
  if(uxPrefs.lang&&uxPrefs.lang!=="en")document.documentElement.lang=uxPrefs.lang==="pcm"?"en-NG":uxPrefs.lang;
  try{if(window.Android&&window.Android.setSecureRecents)window.Android.setSecureRecents(!!uxPrefs.secureRecents);}catch(e){}
}
function uxSavePrefs(){appStorage.setItem("ffd_uxprefs",JSON.stringify(uxPrefs));}
const privOn=()=>privacyMode&&!window._privBypass;
function togglePrivacy(){privacyMode=!privacyMode;appStorage.setItem("ffd_privacy",privacyMode?"1":"0");haptic("light");updatePrivacyBtn();render();if(ffxView)ffxRender();if(typeof notifOpen!=="undefined"&&notifOpen)renderNotifCenter();showToast(privacyMode?"🙈 Amounts hidden":"👁 Amounts visible","green");}
function updatePrivacyBtn(){const b=$("privBtn");if(b){b.innerHTML=privacyMode?"&#128584;":"&#128065;";b.setAttribute("aria-pressed",String(privacyMode));b.setAttribute("aria-label",privacyMode?"Show amounts":"Hide amounts");}document.body.classList.toggle("privacy",privacyMode);}
function setUxPref(k,v){uxPrefs[k]=v;uxSavePrefs();if(k==="secureRecents"&&window.Android&&window.Android.setSecureRecents)window.Android.setSecureRecents(!!v);if(v)haptic("light");render();}
function uxPrivacyHTML(){
  const row=(label,sub,checked,on)=>`<div class="toggle-wrap mb8"><div><div class="fz12 fw6">${label}</div><div class="fz10 muted mt4">${sub}</div></div><label class="toggle"><input type="checkbox" ${checked?"checked":""} onchange="${on}"><span class="toggle-slider"></span></label></div>`;
  return`<div class="card mb12"><div class="fz12 fw7 mb10">Privacy</div>
    ${row("&#128584; Hide amounts","Masks balances and amounts everywhere. Also toggled with the eye button at the top.",privacyMode,"togglePrivacy()")}
    ${row("&#128737; Hide in recent apps","The app preview in the recent-apps screen is blanked so balances aren't visible.",uxPrefs.secureRecents,"setUxPref('secureRecents',this.checked)")}</div>`;
}
function uxFeelHTML(){
  const row=(label,sub,checked,on)=>`<div class="toggle-wrap mb8"><div><div class="fz12 fw6">${label}</div><div class="fz10 muted mt4">${sub}</div></div><label class="toggle"><input type="checkbox" ${checked?"checked":""} onchange="${on}"><span class="toggle-slider"></span></label></div>`;
  return`<div class="card mb12"><div class="fz12 fw7 mb10">Feel</div>
    ${row("&#128243; Vibration feedback","A light tap when you save, delete or swipe.",uxPrefs.haptics,"setUxPref('haptics',this.checked)")}
    <div class="fz12 fw6 mt8">Insight tone</div><div class="fz10 muted mt4 mb8">How FinanceFlow talks about your spending on Home, in alerts and in your recap.</div>
    <div class="tab-row"><button class="tab-btn ${ffxTone()==="gentle"?"active":""}" onclick="setTone('gentle')">🌿 Gentle</button><button class="tab-btn ${ffxTone()==="roast"?"active":""}" onclick="setTone('roast')">🔥 Roast me</button></div></div>`;
}
function haptic(kind){
  if(!uxPrefs.haptics)return;
  try{if(window.Android&&window.Android.haptic)window.Android.haptic(kind||"light");else if(navigator.vibrate)navigator.vibrate(kind==="heavy"?18:kind==="success"?[8,40,12]:8);}catch(e){}
}
function syncWidgetDataUnmasked(fn){window._privBypass=true;try{fn();}finally{window._privBypass=false;}}

// ── left to spend + pacing (Copilot "Free to spend", Rocket Money "Left for spending") ──
function ffxBudgetMatch(b,t){return t.category===b.cat&&(b.limit>0||(b.subs||[]).some(s=>s.name===t.subcategory&&s.limit>0));}
function ffxPacing(){
  const now=new Date(),r=getRangeFor("month",now),today=ffxToday(),dim=ffxDaysBetween(r.startStr,r.endStr)+1,day=Math.max(1,Math.min(dim,ffxDaysBetween(r.startStr,today)+1));
  const monthBudgets=budgets.filter(b=>(b.period||"month")==="month"&&budgetBaseLimit(b)>0);
  let limit=0,src="",match=()=>true;
  if(monthBudgets.length){limit=monthBudgets.reduce((s,b)=>s+budgetEffLimit(b,"month",now),0);src="budget";match=t=>monthBudgets.some(b=>ffxBudgetMatch(b,t));}
  else{const p=ffxMonthRange(-1);limit=txns.filter(t=>t.type==="expense"&&t.date>=p.start&&t.date<=p.end).reduce((s,t)=>s+ffxPA(t),0);src="lastmonth";}
  if(!(limit>0))return null;
  const exp=txns.filter(t=>t.type==="expense"&&t.date>=r.startStr&&t.date<=today&&match(t));
  const perDaySpent=new Array(dim+1).fill(0);exp.forEach(t=>{const d=ffxDaysBetween(r.startStr,t.date)+1;if(d>=1&&d<=dim)perDaySpent[d]+=ffxPA(t);});
  const series=[];let cum=0;for(let d=1;d<=day;d++){cum+=perDaySpent[d];series.push(cum);}
  const spent=cum,left=limit-spent,daysLeft=dim-day+1,perDay=left>0?left/daysLeft:0,expected=limit*day/dim;
  return{limit,spent,left,perDay,daysLeft,src,series,dim,day,ahead:spent>expected,overBy:spent-expected};
}
function ffxPacingSVG(p){
  const W=300,H=64,X=d=>(d/p.dim)*W,max=Math.max(p.limit,p.spent)*1.05,Y=v=>H-(v/max)*(H-4)-2;
  const pts=p.series.map((v,i)=>X(i+1).toFixed(1)+","+Y(v).toFixed(1)).join(" ");
  const col=p.ahead?"var(--warn)":"var(--green)";
  return`<svg viewBox="0 0 ${W} ${H}" class="ffx-pace" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(p.limit)}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7"/>
    <line x1="0" y1="${Y(p.limit)}" x2="${W}" y2="${Y(p.limit)}" stroke="var(--border)" stroke-width="1"/>
    <polyline points="0,${Y(0)} ${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(p.day)}" cy="${Y(p.spent)}" r="4" fill="${col}"/></svg>`;
}

// ── one-tap category ring (Monefy) ──
function ffxTopCategories(n){
  const from=ffxAddDays(ffxToday(),-120),count={};
  txns.forEach(t=>{if(t.type==="expense"&&t.date>=from){const k=t.category+"|"+(t.subcategory||"");count[k]=(count[k]||0)+1;}});
  const EC=getEC();
  let list=Object.entries(count).sort((a,b)=>b[1]-a[1]).map(([k])=>k.split("|")).filter(([c,s])=>Object.hasOwn(EC,c)&&(!s||(EC[c]||[]).includes(s)));
  const seen=new Set(list.map(x=>x[0]+"|"+x[1]));
  for(const c of Object.keys(EC)){if(list.length>=n)break;const s=(EC[c]||[])[0]||"";if(!seen.has(c+"|"+s)){list.push([c,s]);seen.add(c+"|"+s);}}
  return list.slice(0,n);
}
function ffxQuickCat(cat,sub){
  haptic("light");showModal("addtx");
  window._txCat=cat;window._txSub=sub||"";window._txCatManual=true;
  const lbl=$("txCatLabel");if(lbl)lbl.textContent=sub?cat+" / "+sub:cat;
  setTimeout(()=>{const a=$("txAmt");if(a)a.focus();},250);
}

// ── favourites / templates + remembered account ──
function ffxRememberAccount(id){if(!id)return;window._ffxLastAcc=id;try{appStorage.setItem("ffd_lastacc",id);}catch(e){}}
function ffxEnhanceAddSheet(){
  if(!window._bankAlertId&&window._ffxLastAcc&&accounts.some(a=>a.id===window._ffxLastAcc)){window._txAcc=window._ffxLastAcc;const l=$("txAccLabel");if(l)l.textContent=accName(window._txAcc);}
  const body=document.querySelector(".entry-modal .entry-body");if(!body||$("tplRow"))return;
  const row=document.createElement("div");row.id="tplRow";row.className="ffx-tpl-row";
  row.innerHTML=`<button type="button" class="ffx-tpl add" onclick="showModal('close');startReceiptScan()">📷 Scan receipt</button>`+(ffx.templates||[]).map(t=>`<button type="button" class="ffx-tpl" onclick="applyTemplate('${escJs(t.id)}')" oncontextmenu="event.preventDefault();deleteTemplate('${escJs(t.id)}')">${catIcon(t.category)} ${esc(t.name)}${t.amount?` <b>${fmtK(t.amount)}</b>`:""}</button>`).join("")+`<button type="button" class="ffx-tpl add" onclick="saveTemplateFromForm()">☆ Save as favourite</button>`;
  body.parentElement.insertBefore(row,body);
}
function applyTemplate(id){
  const t=(ffx.templates||[]).find(x=>x.id===id);if(!t)return;haptic("light");
  if(t.type&&t.type!==window._txT&&typeof setTT==="function")setTT(t.type);
  if(t.amount)setAmountValue("txAmt",t.amount);
  const d=$("txDesc");if(d)d.value=t.description||"";
  const cats=t.type==="income"?getIC():getEC();
  if(Object.hasOwn(cats,t.category)){window._txCat=t.category;window._txSub=t.subcategory||"";window._txCatManual=true;const l=$("txCatLabel");if(l)l.textContent=t.subcategory?t.category+" / "+t.subcategory:t.category;}
  if(accounts.some(a=>a.id===t.accountId)){window._txAcc=t.accountId;const l=$("txAccLabel");if(l)l.textContent=accName(t.accountId);}
  showToast("★ "+t.name+" filled in — check and save","green");
}
function saveTemplateFromForm(){
  const desc=($("txDesc")?.value||"").trim(),amount=parseAmount($("txAmt")?.value);
  const name=prompt("Name this favourite",desc||window._txSub||window._txCat||"Favourite");if(!name||!name.trim())return;
  ffx.templates=ffx.templates||[];
  ffx.templates.push({id:uid(),name:name.trim().slice(0,24),type:window._txT||"expense",amount:amount>0?amount:0,description:desc,category:window._txCat,subcategory:window._txSub||"",accountId:window._txAcc});
  if(ffx.templates.length>12)ffx.templates.shift();
  save();const r=$("tplRow");if(r)r.remove();ffxEnhanceAddSheet();showToast("★ Saved — long-press a favourite to remove it","green");
}
function deleteTemplate(id){const t=(ffx.templates||[]).find(x=>x.id===id);if(!t||!confirm("Remove the favourite “"+t.name+"”?"))return;ffx.templates=ffx.templates.filter(x=>x.id!==id);save();const r=$("tplRow");if(r)r.remove();ffxEnhanceAddSheet();}

// ── review inbox (Copilot "To review") ──
function ffxReviewList(){return txns.filter(t=>t.needsReview&&t.type!=="transfer").sort((a,b)=>b.date.localeCompare(a.date));}
function ffxCatSuggestions(t){
  const cats=t.type==="income"?getIC():getEC(),key=ffxNormDesc(t.description),count={};
  txns.forEach(x=>{if(x===t||x.type!==t.type||!Object.hasOwn(cats,x.category))return;const w=key&&ffxNormDesc(x.description)===key?10:1;const k=x.category+"|"+(x.subcategory||"");count[k]=(count[k]||0)+w;});
  const s=ffxSuggestCat(t.type,t.description);if(s&&Object.hasOwn(cats,s.category)){const k=s.category+"|"+(s.subcategory||"");count[k]=(count[k]||0)+100;}
  const out=Object.entries(count).sort((a,b)=>b[1]-a[1]).map(([k])=>k.split("|")).filter(([c,sub])=>!(c===t.category&&sub===(t.subcategory||"")));
  for(const c of Object.keys(cats)){if(out.length>=2)break;const sub=(cats[c]||[])[0]||"";if(c!==t.category&&!out.some(([x])=>x===c))out.push([c,sub]);}
  return out.slice(0,2);
}
function reviewConfirm(id){const t=txns.find(x=>x.id===id);if(!t)return;delete t.needsReview;haptic("success");save();ffxRender();render();}
function reviewSetCat(id,cat,sub){const t=txns.find(x=>x.id===id);if(!t)return;t.category=cat;t.subcategory=sub||"";delete t.needsReview;haptic("success");save();ffxRender();render();showToast("🏷 "+(sub?cat+" / "+sub:cat),"green");}
function reviewConfirmAll(){const l=ffxReviewList();if(!l.length||!confirm("Mark all "+l.length+" as reviewed?"))return;l.forEach(t=>delete t.needsReview);haptic("success");save();ffxRender();render();}
function ffxReviewHTML(){
  const l=ffxReviewList();
  if(!l.length)return`<div class="empty-state"><div class="empty-ic">✅</div><div class="fz13 fw7">All caught up</div><div class="fz11 muted mt4">Imported statements and quick-adds land here so you can check their categories in one go.</div></div>`;
  return`<div class="flex-b mb12"><div class="fz11 muted">${l.length} to check · tap a suggestion to fix the category, or confirm</div><button class="btn btn-g btn-sm" onclick="reviewConfirmAll()">Confirm all</button></div>`+
  l.slice(0,60).map(t=>{const sug=ffxCatSuggestions(t);return`<div class="card ffx-review"><div class="flex-b"><div class="flex g8" style="min-width:0"><div class="tx-icon" style="background:${clr(t.category)}22;color:${clr(t.category)}">${catIcon(t.category)}</div><div style="min-width:0"><div class="fz13 fw7 ellip">${esc(t.description||t.category)}</div><div class="fz10 muted">${fmtD(t.date)} · ${esc(accName(t.accountId))}${t.source?" · "+esc(t.source):""}</div></div></div><div class="fz13 fw8 ${t.type==="income"?"green":"red"}">${t.type==="income"?"+":"-"}${fmtTxn(t)}</div></div>
    <div class="ffx-sugs"><span class="ffx-sug cur">${catIcon(t.category)} ${esc(t.subcategory?t.category+" / "+t.subcategory:t.category)}</span>${sug.map(([c,s])=>`<button class="ffx-sug" onclick="reviewSetCat('${escJs(t.id)}','${escJs(c)}','${escJs(s)}')">${catIcon(c)} ${esc(s||c)}</button>`).join("")}</div>
    <div class="flex g6 mt10"><button class="btn btn-p btn-sm" onclick="reviewConfirm('${escJs(t.id)}')">✓ Looks right</button><button class="btn btn-g btn-sm" onclick="showModal('edit','${escJs(t.id)}')">Edit</button></div></div>`;}).join("");
}

// ── swipe gestures: rows (delete / recategorize) and periods (prev / next month) ──
let _sw=null;
function ffxInitGestures(){
  const main=$("main");if(!main||main._ffxGest)return;main._ffxGest=true;
  main.addEventListener("touchstart",e=>{
    if(e.touches.length!==1){_sw=null;return;}const p=e.touches[0];
    const row=e.target.closest('.tx-row[data-id]');const block=e.target.closest(".acc-deck,.ffx-pchips,.ffx-tpl-row,.tab-row,input,select,textarea,.cal-grid,[data-noswipe]");
    _sw={x:p.clientX,y:p.clientY,row:row&&!selectMode?row:null,month:!row&&!block,dir:null,dx:0};
  },{passive:true});
  main.addEventListener("touchmove",e=>{
    if(!_sw)return;const p=e.touches[0],dx=p.clientX-_sw.x,dy=p.clientY-_sw.y;
    if(!_sw.dir&&(Math.abs(dx)>12||Math.abs(dy)>12))_sw.dir=Math.abs(dx)>Math.abs(dy)*1.3?"h":"v";
    if(_sw.dir!=="h")return;_sw.dx=dx;
    if(_sw.row){_sw.row.classList.add("swiping");_sw.row.classList.toggle("sw-left",dx<0);_sw.row.classList.toggle("sw-right",dx>0);_sw.row.classList.toggle("sw-armed",Math.abs(dx)>90);_sw.row.style.setProperty("--sx",Math.max(-140,Math.min(140,dx))+"px");}
  },{passive:true});
  main.addEventListener("touchend",()=>{
    const s=_sw;_sw=null;if(!s||s.dir!=="h")return;
    if(s.row){const id=s.row.dataset.id;s.row.classList.remove("swiping","sw-left","sw-right","sw-armed");s.row.style.removeProperty("--sx");
      if(s.dx<-90){haptic("heavy");deleteTx(id);}else if(s.dx>90){haptic("light");ffxSwipeCat(id);}return;}
    if(s.month&&Math.abs(s.dx)>80&&["dashboard","stats","transactions","budgets"].includes(V)&&!settingsOpen&&typeof navPeriod==="function"){
      if(V==="transactions"&&txViewMode==="calendar")return;
      haptic("light");navPeriod(s.dx<0?1:-1);const m=$("main");m.classList.remove("slide-l","slide-r");void m.offsetWidth;m.classList.add(s.dx<0?"slide-l":"slide-r");
    }
  });
  main.addEventListener("touchcancel",()=>{if(_sw&&_sw.row){_sw.row.classList.remove("swiping","sw-left","sw-right","sw-armed");_sw.row.style.removeProperty("--sx");}_sw=null;});
}
function ffxSwipeCat(id){
  const t=txns.find(x=>x.id===id);if(!t||t.type==="transfer")return;
  window._swipeId=id;window._swipeT=t.type;window._swipeCat=t.category;window._swipeSub=t.subcategory||"";
  openCatPicker("_swipeT","_swipeCat","_swipeSub","_swipeLbl");
}
function ffxApplySwipeCat(){
  const t=txns.find(x=>x.id===window._swipeId);if(!t)return;const before={c:t.category,s:t.subcategory};
  t.category=window._swipeCat;t.subcategory=window._swipeSub||"";delete t.needsReview;save();render();
  showUndoToast("Category → "+(t.subcategory||t.category),()=>{t.category=before.c;t.subcategory=before.s;save();});
}

// ── demo data for first-time users (Copilot demo mode) ──
function loadDemoData(){
  if(txns.length&&!confirm("Add sample data alongside your records? You can clear it later."))return;
  const d=n=>ffxAddDays(ffxToday(),-n),D={demo:true};
  const acc=[{id:"demo_gt",name:"GTBank (demo)",type:"bank",color:"#3b82f6"},{id:"demo_op",name:"Opay (demo)",type:"mobile",color:"#8b5cf6"},{id:"demo_cash",name:"Cash (demo)",type:"cash",color:"#22c55e"}].map(a=>({...a,...D,currency:currency.code}));
  accounts.push(...acc);
  const EC=getEC(),IC=getIC(),ok=(c,s,inc)=>{const m=inc?IC:EC;return Object.hasOwn(m,c)?[c,(m[c]||[]).includes(s)?s:((m[c]||[])[0]||"")]:[Object.keys(m)[0],""];};
  const add=(n,amt,type,c,s,a,desc)=>{const [cc,ss]=ok(c,s,type==="income");txns.push({id:"demo_"+uid(),date:d(n),amount:amt,type,category:cc,subcategory:ss,accountId:a,description:desc,tags:[],...D});};
  [58,28].forEach(n=>add(n,650000,"income","Salary","Primary Job","demo_gt","Salary"));
  for(let i=0;i<55;i+=1){const r=i%7;
    if(r===0)add(i,4500+(i%5)*300,"expense","Food & Dining","Restaurants","demo_op","Lunch");
    if(r===1)add(i,3000,"expense","Transportation","Public Transport","demo_cash","Bus fare");
    if(r===2)add(i,12000+(i%3)*1500,"expense","Food & Dining","Groceries","demo_gt","Market run");
    if(r===3)add(i,1500,"expense","Communication","Data","demo_op","MTN data");
    if(r===4)add(i,15000,"expense","Transportation","Fuel","demo_cash","Fuel");
    if(r===5&&i<40)add(i,50,"expense","Fees & Charges","Stamp Duty","demo_gt","Stamp duty");
  }
  [52,22].forEach(n=>add(n,24500,"expense","Entertainment","Streaming","demo_gt","DSTV Compact"));
  add(20,180000,"expense","Housing","Rent","demo_gt","Rent contribution");add(9,30000,"expense","Family Support","Parents","demo_op","Sent to mum");
  budgets.push({id:"demo_b1",cat:ok("Food & Dining","",false)[0],limit:120000,period:"month",subs:[],...D},{id:"demo_b2",cat:ok("Transportation","",false)[0],limit:80000,period:"month",subs:[],...D});
  goals.push({id:"demo_g1",name:"Emergency fund (demo)",target:500000,saved:140000,color:"#22c55e",...D});
  ffx.debts.push({id:"demo_d1",person:"Tunde",amount:25000,direction:"lent",date:d(6),due:ffxAddDays(ffxToday(),5),note:"Demo IOU",payments:[],...D});
  onboardComplete=true;save();render();showToast("👀 Sample data loaded — clear it anytime from the banner","green");
}
function hasDemoData(){return txns.some(t=>t.demo)||accounts.some(a=>a.demo);}
function clearDemoData(){
  if(!confirm("Remove all sample data? Your own records stay."))return;
  txns=txns.filter(t=>!t.demo&&!String(t.accountId||"").startsWith("demo_"));accounts=accounts.filter(a=>!a.demo);budgets=budgets.filter(b=>!b.demo);goals=goals.filter(g=>!g.demo);ffx.debts=ffx.debts.filter(x=>!x.demo);
  if(!accounts.length)accounts=[{id:"cash",name:"Cash",type:"cash",color:"#22c55e",currency:currency.code}];
  save();render();showToast("Sample data removed","green");
}
function ffxDemoBanner(){return hasDemoData()?`<div class="ffx-demo"><span>👀 You're exploring <b>sample data</b></span><button onclick="clearDemoData()">Clear it</button></div>`:"";}
function ffxInitUX(){updatePrivacyBtn();ffxInitGestures();}

// ════════════════ Polish: device colour, recap story, weekly streaks, tone, lighter lists ════════════════
// ── tone (opt-in roast, Cleo-style) ──
function ffxTone(){return uxPrefs.tone==="roast"?"roast":"gentle";}
function setTone(t){uxPrefs.tone=t;uxSavePrefs();haptic("light");render();showToast(t==="roast"?"🔥 Roast mode on — no feelings were spared":"🌿 Gentle mode on","green");}
const FFX_LINES={
  ahead:{gentle:"▲ spending faster than planned",roast:"▲ your wallet is running a marathon it never trained for"},
  onpace:{gentle:"✓ on pace",roast:"✓ on pace — suspicious, but we'll allow it"},
  spike:{gentle:(c,r)=>`${c} is ${r}× your usual week`,roast:(c,r)=>`${c} at ${r}× your usual week. Who hurt you?`},
  fees:{gentle:f=>`Fees this month ${f}`,roast:f=>`You donated ${f} to your bank this month`},
  recapTop:{gentle:c=>`${c} took the biggest share.`,roast:c=>`You and ${c} should just move in together.`},
  noSpend:{gentle:n=>n?`${n} no-spend day${n===1?"":"s"} — nice.`:"No no-spend days this time.",roast:n=>n?`${n} no-spend day${n===1?"":"s"}. Were you asleep?`:"Zero no-spend days. Impressive, in a bad way."},
  saved:{gentle:r=>r>0?`You kept ${r.toFixed(0)}% of what you earned.`:"Spending matched or beat income.",roast:r=>r>20?`Saved ${r.toFixed(0)}%. Look at you, a whole adult.`:r>0?`Saved ${r.toFixed(0)}%. Baby steps. Very small baby.`:"You spent more than you earned. Bold strategy."}
};
function ffxLine(key,...a){const v=FFX_LINES[key][ffxTone()];return typeof v==="function"?v(...a):v;}

// ── weekly logging streak with one repair a month ──
function ffxWeekKey(dateStr){return getRangeFor("week",FinanceCore.date(dateStr)||new Date()).startStr;}
function ffxStreak2(){
  const weeks=new Set(txns.filter(t=>!t.demo).map(t=>ffxWeekKey(t.date))),reps=new Set((ffx.streakRepairs||[]).map(r=>r.week));
  const filled=w=>weeks.has(w)||reps.has(w);
  const cur=ffxWeekKey(ffxToday()),prev=ffxAddDays(cur,-7);
  const run=from=>{let n=0,w=from;while(filled(w)&&n<520){n++;w=ffxAddDays(w,-7);}return n;};
  const streak=run(filled(cur)?cur:prev);
  const lastRepair=(ffx.streakRepairs||[]).reduce((m,r)=>r.on>m?r.on:m,"");
  const before=!filled(prev)?run(ffxAddDays(prev,-7)):0;
  const repairable=!filled(prev)&&before>=2&&(!lastRepair||ffxDaysBetween(lastRepair,ffxToday())>=30);
  return{streak,thisWeek:filled(cur),repairable,before,prev};
}
function repairStreak(){
  const s=ffxStreak2();if(!s.repairable)return;
  if(!confirm(`Repair your ${s.before}-week streak? You get one repair every 30 days.`))return;
  ffx.streakRepairs=ffx.streakRepairs||[];ffx.streakRepairs.push({week:s.prev,on:ffxToday()});save();haptic("success");render();showToast("🩹 Streak repaired — log something this week to keep it going","green");
}
function ffxStreakChip(){
  const s=ffxStreak2();
  if(s.repairable)return`<button class="ffx-pchip warn" onclick="repairStreak()">🩹 Repair your ${s.before}-week logging streak</button>`;
  if(s.streak>=2)return`<span class="ffx-pchip streak">🔥 ${s.streak}-week logging streak${s.thisWeek?"":" · log this week to keep it"}</span>`;
  return"";
}

// ── device (Material You) accent colour ──
let accentAuto=false;
function ffxHexToRgb(h){const m=/^#?([0-9a-f]{6})$/i.exec(h||"");if(!m)return null;const n=parseInt(m[1],16);return[(n>>16)&255,(n>>8)&255,n&255].join(",");}
function ffxDeviceAccent(){try{if(window.Android&&window.Android.getSystemAccent){const h=window.Android.getSystemAccent(theme==="light"?"light":"dark");const rgb=ffxHexToRgb(h);if(rgb)return{n:"Device",h:h.startsWith("#")?h:"#"+h,rgb};}}catch(e){}return null;}
function setAccentAuto(){const d=ffxDeviceAccent();if(!d)return showToast("Your phone doesn't share a system colour (needs Android 12+)","warn");accentAuto=true;accentColor=d;applyAccent();save();render();haptic("light");}
function ffxApplyAutoAccent(){if(!accentAuto)return;const d=ffxDeviceAccent();if(d){accentColor=d;applyAccent();}}
function ffxAccentAutoSwatch(){const d=ffxDeviceAccent();if(!d)return"";return`<button type="button" class="color-swatch device ${accentAuto?"sel":""}" style="background:conic-gradient(from 90deg,${d.h},#22c55e,#f97316,#ec4899,${d.h})" onclick="setAccentAuto()" title="Match my phone"></button>`;}

// ── recap story (swipeable month in review) ──
let ffxStoryIdx=0,ffxStoryTimer=null,ffxStorySlides=[];
function ffxBuildStory(r){
  const slides=[
    {bg:"linear-gradient(160deg,#1e3a8a,#4f46e5)",k:"Your "+r.label,big:fmt(r.E),s:`spent across ${r.count} transactions${r.change!==null?` · ${r.change>=0?"▲":"▼"} ${Math.abs(r.change).toFixed(0)}% vs before`:""}`},
    {bg:"linear-gradient(160deg,#065f46,#10b981)",k:"Money in",big:fmt(r.I),s:ffxLine("saved",r.rate)}];
  if(r.top.length)slides.push({bg:"linear-gradient(160deg,#7c2d12,#f97316)",k:"Top spending",big:catIcon(r.top[0][0])+" "+esc(r.top[0][0]),s:fmt(r.top[0][1])+" · "+ffxLine("recapTop",esc(r.top[0][0])),list:r.top.map(([c,v],i)=>`${i+1}. ${esc(c)} — ${fmtK(v)}`)});
  if(r.biggest)slides.push({bg:"linear-gradient(160deg,#831843,#ec4899)",k:"Biggest purchase",big:fmt(ffxPA(r.biggest)),s:esc(r.biggest.description||r.biggest.category)+" · "+fmtD(r.biggest.date)});
  slides.push({bg:"linear-gradient(160deg,#164e63,#06b6d4)",k:"No-spend days",big:String(r.noSpend),s:ffxLine("noSpend",r.noSpend)+(r.weekday?` You spend the most on ${r.weekday}.`:"")});
  if(r.payee)slides.push({bg:"linear-gradient(160deg,#3b0764,#a855f7)",k:"Your regular",big:esc(r.payee[0]),s:`${r.payee[1]} times this period`});
  slides.push({bg:"linear-gradient(160deg,#111827,#374151)",k:"Fees paid",big:fmt(r.fees),s:ffxLine("fees",fmt(r.fees)),end:true});
  return slides;
}
function openRecapStory(){
  const r=ffxRecapData(ffxState.recap||"month");if(!r.count)return showToast("Nothing to show for this period yet","warn");
  ffxStorySlides=ffxBuildStory(r);ffxStoryIdx=0;
  let p=$("storyPanel");if(!p){p=document.createElement("div");p.id="storyPanel";document.body.appendChild(p);}
  ffxStoryRender();
}
function ffxStoryRender(){
  const p=$("storyPanel");if(!p)return;const s=ffxStorySlides[ffxStoryIdx];
  p.innerHTML=`<div class="ffx-story" style="background:${s.bg}">
    <div class="ffx-story-bars">${ffxStorySlides.map((_,i)=>`<span class="${i<ffxStoryIdx?"done":i===ffxStoryIdx?"now":""}"></span>`).join("")}</div>
    <button class="ffx-story-x" onclick="closeRecapStory()" aria-label="Close">✕</button>
    <div class="ffx-story-body" key="${ffxStoryIdx}"><div class="ffx-story-k">${s.k}</div><div class="ffx-story-big">${s.big}</div><div class="ffx-story-s">${s.s}</div>${s.list?`<div class="ffx-story-list">${s.list.map(x=>`<div>${x}</div>`).join("")}</div>`:""}
    ${s.end?`<button class="ffx-story-share" onclick="event.stopPropagation();shareRecap()">📤 Share my recap</button>`:""}</div>
    <div class="ffx-story-nav"><div onclick="ffxStoryStep(-1)"></div><div onclick="ffxStoryStep(1)"></div></div></div>`;
  clearTimeout(ffxStoryTimer);if(!s.end)ffxStoryTimer=setTimeout(()=>ffxStoryStep(1),5500);
}
function ffxStoryStep(d){const n=ffxStoryIdx+d;if(n<0)return;if(n>=ffxStorySlides.length)return closeRecapStory();ffxStoryIdx=n;haptic("light");ffxStoryRender();}
function closeRecapStory(){clearTimeout(ffxStoryTimer);const p=$("storyPanel");if(p)p.innerHTML="";ffxStorySlides=[];}
function ffxStoryOpen(){return ffxStorySlides.length>0;}

// ── lighter History list for low-memory phones ──
let txRenderLimit=150;
function ffxLimitDates(dates,groups){let n=0;const out=[];for(const d of dates){out.push(d);n+=groups[d].length;if(n>=txRenderLimit)break;}window._txShown=n;return out;}
function ffxMoreBtn(dates,groups){const total=dates.reduce((s,d)=>s+groups[d].length,0),left=total-(window._txShown||0);return left>0?`<button class="btn btn-g w100 ffx-more" onclick="txRenderLimit+=200;render()">Show ${Math.min(left,200)} more · ${left} older</button>`:"";}

// ════════════════ Long-term features: Wi-Fi editor, receipt scanning, AI assistant,
// zero-based budgeting, local languages + lite mode, family ledger ════════════════
const ffxHasBridge=n=>!!(window.Android&&typeof window.Android[n]==="function");

// ── Wi-Fi desktop editor (Full build) ──
function lanSnapshot(){
  if(pinLockActive)return JSON.stringify({ok:false,error:"FinanceFlow is locked on the phone. Unlock it first."});
  return JSON.stringify({ok:true,currency:currency.code,symbol:currency.symbol,
    accounts:accounts.map(a=>({id:a.id,name:a.name,currency:a.currency||currency.code})),
    categories:{expense:getEC(),income:getIC()},
    txns:txns.map(t=>t.type==="transfer"?{id:t.id,date:t.date,type:"transfer",amount:Number(t.amount),description:t.description||"",from:accName(t.fromAccountId),to:accName(t.toAccountId)}
      :{id:t.id,date:t.date,type:t.type,amount:Number(t.amount),description:t.description||"",category:t.category||"",subcategory:t.subcategory||"",accountId:t.accountId})});
}
function ffxValidTx(t){
  const errs=[],cats=t.type==="income"?getIC():getEC();
  if(!["income","expense"].includes(t.type))errs.push("type must be income or expense");
  if(!(Number(t.amount)>0)||!Number.isFinite(Number(t.amount)))errs.push("amount must be a positive number");
  if(!FinanceCore.date(t.date))errs.push("invalid date "+t.date);
  if(!accounts.some(a=>a.id===t.accountId))errs.push("unknown account");
  if(!Object.hasOwn(cats,t.category))errs.push("unknown category "+t.category);
  else if(t.subcategory&&!(cats[t.category]||[]).includes(t.subcategory))errs.push("unknown subcategory "+t.subcategory);
  return errs;
}
function lanApply(bodyStr){
  if(pinLockActive)return JSON.stringify({ok:false,error:"FinanceFlow is locked on the phone. Unlock it first."});
  let ops;try{ops=JSON.parse(bodyStr).ops;}catch(e){return JSON.stringify({ok:false,error:"Bad request"});}
  if(!Array.isArray(ops)||ops.length>5000)return JSON.stringify({ok:false,error:"Bad request"});
  const FIELDS=["date","description","type","category","subcategory","accountId","amount"],errors=[],plan=[];
  ops.forEach((o,i)=>{
    if(o.op==="delete"){const t=txns.find(x=>x.id===o.id);if(!t||t.type==="transfer")errors.push(`#${i+1}: can't delete that entry`);else plan.push({o,t});return;}
    let next;
    if(o.op==="update"){const t=txns.find(x=>x.id===o.id);if(!t||t.type==="transfer"){errors.push(`#${i+1}: entry not found or is a transfer`);return;}next={...t};FIELDS.forEach(f=>{if(o.fields&&Object.hasOwn(o.fields,f))next[f]=f==="amount"?Number(o.fields[f]):String(o.fields[f]??"");});plan.push({o,t,next});}
    else if(o.op==="add"){next={id:uid(),tags:[],projectId:"",source:"Desktop"};FIELDS.forEach(f=>{next[f]=f==="amount"?Number(o.tx&&o.tx[f]):String((o.tx&&o.tx[f])??"");});plan.push({o,next});}
    else{errors.push(`#${i+1}: unknown operation`);return;}
    ffxValidTx(next).forEach(e=>errors.push(`${next.description||next.date||"#"+(i+1)}: ${e}`));
  });
  if(errors.length)return JSON.stringify({ok:false,error:"Nothing was saved — fix these first:",errors:errors.slice(0,20)});
  const before=JSON.parse(JSON.stringify(txns));
  plan.forEach(p=>{
    if(p.o.op==="delete"){ffxNoteDelete(p.t);txns.splice(txns.indexOf(p.t),1);}
    else if(p.o.op==="update"){Object.assign(p.t,p.next);delete p.t.needsReview;}
    else txns.push(p.next);
  });
  save();render();haptic("success");
  showUndoToast("💻 "+plan.length+" change"+(plan.length===1?"":"s")+" from your computer",()=>{txns=before;save();});
  return JSON.stringify({ok:true,applied:plan.length});
}
function lanToggle(on){
  if(!ffxHasBridge("lanStart"))return;
  if(on){const s=JSON.parse(window.Android.lanStart());if(s.error)showToast(s.error,"red");}
  else window.Android.lanStop();
  haptic("light");ffxRender();
}
function ffxLanHTML(){
  if(!ffxHasBridge("lanAvailable")||!window.Android.lanAvailable())return`<div class="empty-state"><div class="empty-ic">💻</div><div class="fz13 fw7">Available in the Full build</div><div class="fz11 muted mt4">The Wi-Fi editor needs network access, which the standard build never asks for. Install FinanceFlow-Full.apk from the same release to use it.</div></div>`;
  let s={running:false};try{s=JSON.parse(window.Android.lanStatus());}catch(e){}
  if(!s.running)return`<div class="ffx-hero"><div class="fz11 muted">Edit on a big screen</div><div class="ffx-hero-num" style="font-size:22px">Wi-Fi desktop editor</div><div class="fz11 muted">Open your records in a laptop browser on the same Wi-Fi to bulk-edit, recategorize, add and export. Your phone stays the master copy and nothing goes to the internet.</div></div>
    <button class="btn btn-p w100" style="justify-content:center;padding:13px" onclick="lanToggle(true)">Start Wi-Fi editor</button>
    <div class="fz10 muted mt10">It stops by itself after 30 minutes without use, or when you close the app. Only devices that know the 6-digit PIN can connect.</div>`;
  return`<div class="ffx-hero"><div class="fz11 muted">On your computer, open</div><div class="ffx-lan-url">${s.url?esc(s.url):"Connect the phone to Wi-Fi"}</div><div class="fz11 muted mt8">then enter this PIN</div><div class="ffx-lan-pin">${esc(s.pin||"")}</div></div>
    ${s.wifi?"":`<div class="msg msg-err fz11 mb12" style="display:block">This phone doesn't seem to be on Wi-Fi. Connect it to the same network as your computer (a phone hotspot also works).</div>`}
    <div class="flex g6"><button class="btn btn-g" style="flex:1;justify-content:center" onclick="ffxRender()">Refresh</button><button class="btn btn-rd" style="flex:1;justify-content:center" onclick="lanToggle(false)">Stop</button></div>
    <div class="fz10 muted mt10">Keep FinanceFlow open while you edit. Changes from the computer show up here instantly and can be undone.</div>`;
}

// ── receipt & transfer-screenshot scanning (ML Kit on device) ──
const FFX_MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
function ffxParseMoney(s){const m=String(s).replace(/\s/g,"").match(/^(?:₦|NGN|N)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/i);return m?parseFloat(m[1].replace(/,/g,"")+(m[2]||"")):null;}
function ffxGuessCategory(type,desc){
  const cats=type==="income"?getIC():getEC();
  const sug=ffxSuggestCat(type,desc);if(sug&&Object.hasOwn(cats,sug.category))return[sug.category,sug.subcategory,sug.reason];
  for(const [re,c,sub] of (type==="income"?FFX_INCOME_KEYWORDS:FFX_KEYWORDS))if(re.test(" "+String(desc).toLowerCase()+" ")&&Object.hasOwn(cats,c))return[c,(cats[c]||[]).includes(sub)?sub:"","Matched “"+desc+"”"];
  const c=Object.hasOwn(cats,"Other")?"Other":Object.keys(cats)[0];return[c,(cats[c]||[])[0]||"",""];
}
function parseReceiptText(rows){
  rows=(rows||[]).map(r=>String(r).trim()).filter(Boolean);
  const text=rows.join("\n"),low=text.toLowerCase();
  // amount: score every money-looking token by its row's label
  let best=null;
  rows.forEach((row,i)=>{
    const tokens=row.match(/(?:₦|NGN|N)?\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₦|NGN)\s?\d+(?:\.\d{1,2})?|\b\d+\.\d{2}\b/gi)||[];
    tokens.forEach(tok=>{
      const v=ffxParseMoney(tok);if(v===null||v<=0||v>1e10)return;
      const r=row.toLowerCase(),prev=(rows[i-1]||"").toLowerCase();let sc=0;
      if(/\b(amount|total|amt|grand total|paid|you sent|you paid|transfer amount|debit amount|credit amount)\b/.test(r))sc+=4;
      else if(/\b(amount|total)\b/.test(prev))sc+=3;
      if(/₦|ngn/i.test(tok))sc+=2;if(/\.\d{2}$/.test(tok))sc+=1;
      if(/\b(balance|bal|avail)/.test(r))sc-=6;if(/\b(fee|charge|vat|stamp|commission|cashback|change)\b/.test(r))sc-=3;
      if(/\b(phone|tel|acct|account no|terminal|tid|mid|stan|rrn)\b/.test(r))sc-=4;
      if(!best||sc>best.sc||(sc===best.sc&&v>best.v))best={v,sc,row};
    });
  });
  // date (Nigerian receipts are day-first)
  let date=null;const now=new Date();
  const mk=(y,m,d)=>{if(y<100)y+=2000;const dt=new Date(y,m,d);return dt.getMonth()===m&&dt.getDate()===d&&dt<=new Date(now.getTime()+864e5)&&y>2015?toLocalISODate(dt):null;};
  for(const row of rows){
    let m;
    if((m=row.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))){date=mk(+m[1],+m[2]-1,+m[3]);}
    else if((m=row.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/))){date=mk(+m[3],+m[2]-1,+m[1]);}
    else if((m=row.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[,\s\-]+(\d{4})\b/))&&FFX_MONTHS[m[2].slice(0,3).toLowerCase()]!==undefined){date=mk(+m[3],FFX_MONTHS[m[2].slice(0,3).toLowerCase()],+m[1]);}
    else if((m=row.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/))&&FFX_MONTHS[m[1].slice(0,3).toLowerCase()]!==undefined){date=mk(+m[3],FFX_MONTHS[m[1].slice(0,3).toLowerCase()],+m[2]);}
    if(date)break;
  }
  const income=/\b(credit alert|you received|received from|incoming|deposit|credited)\b/.test(low)&&!/\b(debit|you sent|transfer successful|paid to|purchase|sent to)\b/.test(low);
  // counterparty / merchant
  let name="";
  const labelRe=income?/\b(sender|from|received from)(?:\s+(?:details|name|account name))?\b\s*[:\-]?\s*(.*)$/i:/\b(beneficiary|recipient|receiver|sent to|paid to|to|merchant|biller)(?:\s+(?:details|name|account name))?\b\s*[:\-]?\s*(.*)$/i;
  for(let i=0;i<rows.length&&!name;i++){const m=rows[i].match(labelRe);if(m){const rest=m[2].replace(/\d{6,}/g,"").trim();name=rest&&/[a-z]/i.test(rest)?rest:(rows[i+1]&&/[a-z]/i.test(rows[i+1])&&!/\d{3,}/.test(rows[i+1])?rows[i+1]:"");}}
  if(!name){const first=rows.find(r=>/[a-z]{3}/i.test(r)&&!/\d{4,}|receipt|transaction|successful|details|customer copy|merchant copy/i.test(r));name=first||"";}
  name=name.replace(/\s{2,}.*/,"").replace(/[|*]/g,"").trim().slice(0,60);
  const ref=(text.match(/\b(?:ref(?:erence)?(?:\s*no)?|session\s*id|transaction\s*(?:id|ref|no)|rrn)\b\s*[:#\-]?\s*([A-Z0-9\-]{6,})/i)||[])[1]||"";
  // only the receipt's own header names the paying app/bank; later rows often name the recipient's bank
  const head=rows.slice(0,2).join(" ").toLowerCase();
  const bankHit=accounts.find(a=>{const k=a.name.toLowerCase().split(/\s+/)[0];return k.length>=3&&head.includes(k);});
  return{amount:best?best.v:null,date,type:income?"income":"expense",name,reference:ref,accountId:bankHit?bankHit.id:null,text};
}
function startReceiptScan(){
  if(!ffxHasBridge("ocrImage"))return showToast("📷 Scanning works in the FinanceFlow app","warn");
  let inp=$("ffxScanInput");
  if(!inp){inp=document.createElement("input");inp.type="file";inp.accept="image/*";inp.id="ffxScanInput";inp.style.display="none";inp.onchange=()=>ffxScanFile(inp.files[0]);document.body.appendChild(inp);}
  inp.value="";inp.click();
}
function ffxScanFile(file){
  if(!file)return;showToast("🔍 Reading the receipt…","green");
  const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{
    const max=1800,sc=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);window.Android.ocrImage(c.toDataURL("image/jpeg",0.9).split(",")[1],"ffxOcrDone");};img.src=r.result;};r.readAsDataURL(file);
}
function ffxOcrDone(json){
  let res;try{res=JSON.parse(json);}catch(e){res={ok:false};}
  if(!res.ok)return showToast("⚠️ "+(res.error||"Couldn't read that image"),"red");
  const p=parseReceiptText(res.rows&&res.rows.length?res.rows:String(res.text||"").split("\n"));
  if(!p.amount)return showToast("Couldn't find an amount — try a clearer photo or screenshot","warn");
  if(p.reference&&txns.some(t=>t.externalReference===p.reference)&&!confirm("A transaction with reference "+p.reference+" is already recorded. Add it again?"))return;
  const [category,subcategory,reason]=ffxGuessCategory(p.type,p.name);
  window._qe={amount:p.amount,type:p.type,date:p.date||ffxToday(),accountId:p.accountId||window._ffxLastAcc||accounts[0]?.id,description:p.name,category,subcategory,reason:reason||"From your receipt",receipt:{reference:p.reference,text:p.text}};
  window._qeT=p.type;window._qeCat=category;window._qeSub=subcategory;window._qeAcc=window._qe.accountId;
  haptic("success");ffxQuickSheet();
}

// ── AI assistant (Full build, user's own Claude API key) ──
ffxState.aiChat=ffxState.aiChat||[];
function ffxAiKey(){try{return appStorage.getItem("ffd_aikey")||"";}catch(e){return"";}}
function aiSaveKey(){const k=($("aiKey")?.value||"").trim();if(!/^sk-ant-/.test(k))return alert("That doesn't look like a Claude API key (it starts with sk-ant-).");appStorage.setItem("ffd_aikey",k);haptic("success");showToast("🔑 Key saved on this phone (encrypted)","green");ffxRender();}
function aiForgetKey(){if(!confirm("Remove your API key from this phone?"))return;appStorage.removeItem("ffd_aikey");ffxState.aiChat=[];ffxRender();}
function ffxAiContext(){
  const from=ffxAddDays(ffxToday(),-365);
  const list=txns.filter(t=>t.date>=from).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,1500);
  return JSON.stringify({today:ffxToday(),currency:currency.code,
    accounts:accounts.map(a=>({id:a.id,name:a.name,currency:a.currency||currency.code,balance:getAccountBalance(a.id)})),
    categories:{expense:getEC(),income:getIC()},
    budgets:budgets.map(b=>({category:b.cat,limit:budgetBaseLimit(b),period:b.period||"month"})),
    goals:goals.map(g=>({name:g.name,target:g.target,saved:g.saved})),
    transaction_columns:["id","date","type","amount","category","subcategory","account","description"],
    transactions:list.map(t=>t.type==="transfer"?[t.id,t.date,"transfer",Number(t.amount),"","",accName(t.fromAccountId)+" -> "+accName(t.toAccountId),t.description||""]:[t.id,t.date,t.type,Number(t.amount),t.category,t.subcategory||"",accName(t.accountId),t.description||""])});
}
function aiSend(text){
  const q=String(text??$("aiInput")?.value??"").trim();if(!q||ffxState.aiBusy)return;
  const key=ffxAiKey();if(!key)return;
  ffxState.aiChat.push({role:"user",text:q});ffxState.aiBusy=true;ffxRender();
  const history=ffxState.aiChat.slice(-12).map(m=>({role:m.role,text:m.text}));
  window.Android.aiAsk(key,ffxAiContext(),JSON.stringify(history),"ffxAiReply");
}
function ffxAiReply(json){
  ffxState.aiBusy=false;let r;try{r=JSON.parse(json);}catch(e){r={ok:false,error:"Unexpected reply"};}
  if(r.ok){
    const props=(r.proposals||[]).filter(p=>{const t=txns.find(x=>x.id===p.tx_id);if(!t||t.type==="transfer")return false;const cats=t.type==="income"?getIC():getEC();return Object.hasOwn(cats,p.category)&&(!p.subcategory||(cats[p.category]||[]).includes(p.subcategory))&&!(t.category===p.category&&(t.subcategory||"")===(p.subcategory||""));});
    ffxState.aiChat.push({role:"assistant",text:r.answer||"(no answer)",proposals:props});haptic("light");
  }else ffxState.aiChat.push({role:"error",text:r.error||"Something went wrong"});
  if(ffxView==="assistant")ffxRender();else showToast("🤖 Your assistant replied","green");
}
function aiApply(msgIdx,pIdx){
  const m=ffxState.aiChat[msgIdx];if(!m)return;const list=pIdx===undefined?m.proposals:[m.proposals[pIdx]];
  const before=[];list.forEach(p=>{const t=txns.find(x=>x.id===p.tx_id);if(!t)return;before.push([t,t.category,t.subcategory]);t.category=p.category;t.subcategory=p.subcategory||"";delete t.needsReview;p.applied=true;});
  save();render();ffxRender();haptic("success");
  showUndoToast("🏷 "+before.length+" recategorized",()=>{before.forEach(([t,c,s])=>{t.category=c;t.subcategory=s;});list.forEach(p=>p.applied=false);save();});
}
function ffxAssistantHTML(){
  if(!ffxHasBridge("aiAvailable")||!window.Android.aiAvailable())return`<div class="empty-state"><div class="empty-ic">🤖</div><div class="fz13 fw7">Available in the Full build</div><div class="fz11 muted mt4">The AI assistant needs internet access, which the standard build never asks for. Install FinanceFlow-Full.apk from the same release to use it.</div></div>`;
  if(!ffxAiKey())return`<div class="ffx-hero"><div class="fz11 muted">Optional · uses your own Claude API key</div><div class="ffx-hero-num" style="font-size:22px">Ask about your money</div><div class="fz11 muted">“How much did I spend on transport since January?” · “Which subscriptions cost the most?” · “Fix my miscategorized transactions.”</div></div>
    <div class="msg msg-err fz11 mb12" style="display:block"><b>What gets sent:</b> each question, plus your last 12 months of transactions (date, amount, category, account name, description), account balances, budgets and goals, goes to Anthropic's Claude API using your key. Nothing else in FinanceFlow uses the internet, and nothing is sent until you ask a question.</div>
    <span class="edit-label">Claude API key</span><input class="inp mb8" id="aiKey" type="password" autocomplete="off" placeholder="sk-ant-…">
    <button class="btn btn-p w100" style="justify-content:center" onclick="aiSaveKey()">Save key & start</button>
    <div class="fz10 muted mt8">Get a key at console.anthropic.com. Usage is billed to your Anthropic account. The key is stored encrypted on this phone and is never included in backups.</div>`;
  const sugg=["How much did I spend this month, by category?","Which subscriptions or repeat bills cost me the most?","Find transactions that look miscategorized","How can I cut my spending next month?"];
  const msgs=ffxState.aiChat.map((m,i)=>m.role==="user"?`<div class="ffx-ai-me">${esc(m.text)}</div>`:m.role==="error"?`<div class="ffx-ai-err">⚠️ ${esc(m.text)}</div>`:
    `<div class="ffx-ai-bot">${esc(m.text).replace(/\n/g,"<br>")}${(m.proposals||[]).length?`<div class="ffx-ai-props">${m.proposals.map((p,j)=>{const t=txns.find(x=>x.id===p.tx_id);return`<div class="ffx-ai-prop"><div style="min-width:0"><div class="fz11 fw7 ellip">${esc(t?.description||t?.category||p.tx_id)} · ${t?fmtTxn(t):""}</div><div class="fz10 muted">${esc(t?t.category:"")} → <b>${esc(p.category)}${p.subcategory?" / "+esc(p.subcategory):""}</b> · ${esc(p.reason)}</div></div>${p.applied?`<span class="fz10 green fw7">✓</span>`:`<button class="btn btn-sm btn-g" onclick="aiApply(${i},${j})">Apply</button>`}</div>`;}).join("")}${m.proposals.some(p=>!p.applied)?`<button class="btn btn-p btn-sm mt8" onclick="aiApply(${i})">Apply all ${m.proposals.filter(p=>!p.applied).length}</button>`:""}</div>`:""}</div>`).join("");
  return`<div class="ffx-ai">${msgs||`<div class="fz11 muted mb8">Try one of these:</div>`}
    ${ffxState.aiBusy?`<div class="ffx-ai-bot ffx-ai-typing"><span></span><span></span><span></span></div>`:""}
    ${!ffxState.aiChat.length?`<div class="ffx-sugs">${sugg.map(s=>`<button class="ffx-sug" onclick="aiSend('${escJs(s)}')">${esc(s)}</button>`).join("")}</div>`:""}</div>
    <div class="ffx-qe mt12"><span>🤖</span><input id="aiInput" placeholder="Ask about your money…" enterkeyhint="send" onkeydown="if(event.key==='Enter'){event.preventDefault();aiSend()}" ${ffxState.aiBusy?"disabled":""}><button onclick="aiSend()" ${ffxState.aiBusy?"disabled":""}>Ask</button></div>
    <div class="fz10 muted mt8">Model: Claude Opus 5.5 · suggested changes need your OK</div><div class="flex g6 mt6"><button class="btn btn-sm btn-g" onclick="ffxState.aiChat=[];ffxRender()">Clear chat</button><button class="btn btn-sm btn-g" onclick="aiForgetKey()">Remove key</button></div>`;
}

// ── zero-based "give every naira a job" budgeting (YNAB) ──
function ffxZeroBased(){
  const r=ffxMonthRange(0),now=new Date();
  const income=txns.filter(t=>t.type==="income"&&t.date>=r.start&&t.date<=r.end).reduce((s,t)=>s+ffxPA(t),0);
  const monthly=budgets.filter(b=>(b.period||"month")==="month");
  const weekly=budgets.filter(b=>b.period==="week");
  const assigned=monthly.reduce((s,b)=>s+budgetEffLimit(b,"month",now),0)+weekly.reduce((s,b)=>s+budgetBaseLimit(b)*52/12,0);
  return{income,assigned,ready:income-assigned,label:r.label};
}
function setZeroBased(on){uxPrefs.zeroBased=on;uxSavePrefs();haptic("light");render();}
function zbAssignRest(){
  const z=ffxZeroBased();if(z.ready<=0)return;
  const cat=Object.hasOwn(getEC(),"Savings")?"Savings":null;if(!cat)return alert("Add a Savings category first.");
  let b=budgets.find(x=>x.cat===cat&&(x.period||"month")==="month");
  if(!confirm(`Assign the remaining ${fmt(z.ready)} to your Savings budget?`))return;
  if(b)b.limit=FinanceCore.round(Number(b.limit||0)+z.ready);else budgets.push({id:uid(),cat,limit:FinanceCore.round(z.ready),period:"month",subs:[]});
  save();render();haptic("success");showToast("💰 Every naira has a job","green");
}
function zbFromLastMonth(){
  const p=ffxMonthRange(-1),EC=getEC(),spent={};
  txns.filter(t=>t.type==="expense"&&t.date>=p.start&&t.date<=p.end&&Object.hasOwn(EC,t.category)).forEach(t=>spent[t.category]=(spent[t.category]||0)+ffxPA(t));
  const missing=Object.entries(spent).filter(([c])=>!budgets.some(b=>b.cat===c));
  if(!missing.length)return showToast("Every category you spent in last month already has a budget","warn");
  if(!confirm(`Create ${missing.length} budget${missing.length>1?"s":""} from last month's spending?\n\n`+missing.map(([c,v])=>`${c}: ${fmt(Math.ceil(v/1000)*1000)}`).join("\n")))return;
  missing.forEach(([c,v])=>budgets.push({id:uid(),cat:c,limit:Math.ceil(v/1000)*1000,period:"month",subs:[]}));save();render();haptic("success");
}
function ffxZeroBasedHTML(){
  if(!uxPrefs.zeroBased)return`<button class="ffx-zb-off" onclick="setZeroBased(true)">🎯 Try “give every naira a job” budgeting</button>`;
  const z=ffxZeroBased(),st=Math.abs(z.ready)<1?"done":z.ready>0?"ready":"over";
  const pct=z.income>0?Math.min(100,z.assigned/z.income*100):0;
  return`<div class="card ffx-zb ${st}"><div class="flex-b"><div class="ffx-eyebrow">Give every naira a job · ${esc(z.label)}</div><button class="btn btn-sm btn-g" onclick="setZeroBased(false)">Turn off</button></div>
    <div class="ffx-zb-num">${st==="done"?"✓ Every naira has a job":st==="ready"?fmt(z.ready)+" <span>ready to assign</span>":fmt(-z.ready)+" <span>over-assigned</span>"}</div>
    <div class="bar-track mt8"><div class="bar-fill" style="width:${pct}%;background:${st==="over"?"var(--red)":"var(--accent)"}"></div></div>
    <div class="flex-b fz10 muted mt4"><span>Income received ${fmtK(z.income)}</span><span>Assigned to budgets ${fmtK(z.assigned)}</span></div>
    <div class="fz11 muted mt8">${st==="over"?"Your budgets add up to more than you've received this month. Lower one, or wait for more income.":st==="ready"?"Give this money a job: raise a budget, add one, or send it to savings.":"Everything you received this month is planned. Nice."}</div>
    ${st==="ready"?`<div class="flex g6 mt10"><button class="btn btn-p btn-sm" onclick="zbAssignRest()">Assign rest to Savings</button><button class="btn btn-g btn-sm" onclick="zbFromLastMonth()">Budgets from last month</button></div>`:""}</div>`;
}

// ── local languages (beta) + lite mode ──
const FFX_LANGS={en:"English",pcm:"Pidgin",yo:"Yorùbá",ha:"Hausa",ig:"Igbo"};
const FFX_I18N={
  Home:{pcm:"Home",yo:"Ilé",ha:"Gida",ig:"Ụlọ"},Stats:{pcm:"Numba",yo:"Ìṣirò",ha:"Ƙididdiga",ig:"Ọnụ ọgụgụ"},History:{pcm:"History",yo:"Ìtàn",ha:"Tarihi",ig:"Akụkọ"},
  Budgets:{pcm:"Budget",yo:"Ìnáwó",ha:"Kasafi",ig:"Mmefu"},Projects:{pcm:"Project",yo:"Iṣẹ́",ha:"Ayyuka",ig:"Ọrụ"},Settings:{pcm:"Settings",yo:"Ètò",ha:"Saituna",ig:"Ntọala"},
  Hi:{pcm:"How far",yo:"Ẹ n lẹ",ha:"Sannu",ig:"Ndeewo"},
  "+ Add transaction":{pcm:"+ Add am",yo:"+ Ṣàfikún",ha:"+ Ƙara ciniki",ig:"+ Tinye"},
  "Import statement":{pcm:"Bring statement",yo:"Gbé àkọsílẹ̀ wọlé",ha:"Shigo da bayanai",ig:"Bubata akwụkwọ"},
  "Left to spend this month":{pcm:"Money wey remain this month",yo:"Owó tó kù lóṣù yìí",ha:"Kuɗin da ya rage a wannan wata",ig:"Ego fọdụrụ n'ọnwa a"},
  "Over this month's plan":{pcm:"You don pass this month plan",yo:"O ti kọjá ètò oṣù yìí",ha:"Ka wuce shirin wannan wata",ig:"Ị gafeela atụmatụ ọnwa a"},
  "Log in one tap":{pcm:"Add am sharp sharp",yo:"Kọ sílẹ̀ ní ìfọwọ́kàn kan",ha:"Rubuta da taɓawa ɗaya",ig:"Dee ya n'otu mmetụ"},
  "All money tools ›":{pcm:"All di money tools ›",yo:"Gbogbo irinṣẹ́ owó ›",ha:"Duk kayan aikin kuɗi ›",ig:"Ngwaọrụ ego niile ›"},
  "Money runway":{pcm:"How long money go last",yo:"Bí owó ṣe máa pẹ́ tó",ha:"Tsawon kuɗi",ig:"Ogologo oge ego"},
  "Add Transaction":{pcm:"Add money matter",yo:"Ṣàfikún ìṣòwò",ha:"Ƙara ciniki",ig:"Tinye azụmahịa"},
  Notifications:{pcm:"Notification dem",yo:"Ìfitónilétí",ha:"Sanarwa",ig:"Ọkwa"},
  "Or type: “5k fuel cash”, “+250k salary gtbank”":{pcm:"Type am: “5k fuel cash”",yo:"Tẹ̀: “5k fuel cash”",ha:"Rubuta: “5k fuel cash”",ig:"Dee: “5k fuel cash”"}
};
function T(s){const l=uxPrefs.lang||"en";if(l==="en")return s;const e=FFX_I18N[s];return(e&&e[l])||s;}
function setLang(l){uxPrefs.lang=FFX_LANGS[l]?l:"en";uxSavePrefs();document.documentElement.lang=uxPrefs.lang==="pcm"?"en-NG":uxPrefs.lang;render();if(settingsOpen)renderSettings();}
function setLite(on){uxPrefs.lite=on;uxSavePrefs();document.body.classList.toggle("lite",on);txRenderLimit=on?80:150;render();}

// ── family / household ledger via shared files ──
function ffxDeviceId(){if(!ffx.deviceId){ffx.deviceId=uid();ffxSave();}return ffx.deviceId;}
function ffxNoteDelete(t){
  if(!t)return;const acc=accounts.find(a=>a.id===t.accountId||a.id===t.fromAccountId);
  if(acc&&acc.shared){ffx.sharedDeletes=ffx.sharedDeletes||[];ffx.sharedDeletes.push({id:t.id,at:new Date().toISOString()});if(ffx.sharedDeletes.length>2000)ffx.sharedDeletes.shift();}
}
function toggleSharedAccount(id,on){const a=accounts.find(x=>x.id===id);if(!a)return;a.shared=on;save();ffxRender();}
function exportFamilyUpdate(){
  const shared=accounts.filter(a=>a.shared);if(!shared.length)return alert("Mark at least one account as shared first.");
  const ids=new Set(shared.map(a=>a.id));
  const list=txns.filter(t=>t.type==="transfer"?ids.has(t.fromAccountId)&&ids.has(t.toAccountId):ids.has(t.accountId)).map(t=>{const c={...t};delete c.receipt;delete c.needsReview;c.addedBy=c.addedBy||profile.name||"";return c;});
  const pkg={format:"financeflow-family",version:1,from:profile.name||"Someone",device:ffxDeviceId(),sentAt:new Date().toISOString(),
    accounts:shared.map(a=>({id:a.id,name:a.name,type:a.type,color:a.color,currency:a.currency||currency.code})),txns:list,deletes:(ffx.sharedDeletes||[]).slice(-500)};
  ffx.lastFamilySent=pkg.sentAt;save();
  saveOrDownload("financeflow-family-"+(profile.name||"me").replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-"+ffxToday()+".json",JSON.stringify(pkg),"application/json");
}
function importFamilyUpdate(){
  let inp=$("ffxFamilyInput");
  if(!inp){inp=document.createElement("input");inp.type="file";inp.accept=".json,application/json";inp.id="ffxFamilyInput";inp.style.display="none";inp.onchange=()=>{const f=inp.files[0];if(!f)return;if(f.size>20*1024*1024)return alert("That file is too large.");const r=new FileReader();r.onload=()=>ffxMergeFamily(String(r.result));r.readAsText(f);};document.body.appendChild(inp);}
  inp.value="";inp.click();
}
function ffxMergeFamily(raw){
  let p;try{p=JSON.parse(raw);}catch(e){return alert("That isn't a FinanceFlow family file.");}
  if(!p||p.format!=="financeflow-family"||!Array.isArray(p.txns)||!Array.isArray(p.accounts))return alert("That isn't a FinanceFlow family file.");
  if(p.device&&p.device===ffx.deviceId)return alert("This file came from this phone.");
  const accIds=new Set(accounts.map(a=>a.id)),newAccs=p.accounts.filter(a=>a&&typeof a.id==="string"&&typeof a.name==="string"&&!accIds.has(a.id));
  const allAcc=new Set([...accIds,...newAccs.map(a=>a.id)]);
  const ok=t=>t&&typeof t.id==="string"&&FinanceCore.date(t.date)&&Number(t.amount)>0&&(t.type==="transfer"?allAcc.has(t.fromAccountId)&&allAcc.has(t.toAccountId):["income","expense"].includes(t.type)&&allAcc.has(t.accountId));
  const incoming=p.txns.filter(ok),bad=p.txns.length-incoming.length;
  const adds=[],changes=[];
  incoming.forEach(t=>{const cur=txns.find(x=>x.id===t.id);if(!cur)adds.push(t);else{const keys=["date","amount","type","category","subcategory","accountId","description","fromAccountId","toAccountId","receivedAmount"];if(keys.some(k=>String(cur[k]??"")!==String(t[k]??"")))changes.push([cur,t]);}});
  const dels=(p.deletes||[]).map(d=>txns.find(x=>x.id===d.id)).filter(Boolean);
  if(!adds.length&&!changes.length&&!dels.length&&!newAccs.length)return showToast("You're already up to date with "+(p.from||"them"),"green");
  if(!confirm(`Update from ${p.from||"family"} (${new Date(p.sentAt).toLocaleDateString()}):\n\n• ${adds.length} new\n• ${changes.length} changed (their version is kept)\n• ${dels.length} deleted\n${newAccs.length?`• ${newAccs.length} new shared account${newAccs.length>1?"s":""}\n`:""}${bad?`• ${bad} skipped (invalid)\n`:""}\nApply?`))return;
  const before={txns:JSON.parse(JSON.stringify(txns)),accounts:JSON.parse(JSON.stringify(accounts))};
  newAccs.forEach(a=>accounts.push({id:a.id,name:a.name,type:a.type||"bank",color:a.color||"#6366f1",currency:a.currency||currency.code,shared:true}));
  adds.forEach(t=>txns.push({...t,sharedFrom:p.from||""}));
  changes.forEach(([cur,t])=>Object.assign(cur,t,{sharedFrom:p.from||""}));
  dels.forEach(t=>txns.splice(txns.indexOf(t),1));
  ffx.lastFamilyReceived={from:p.from,at:new Date().toISOString()};save();render();ffxRender();haptic("success");
  showUndoToast("👨‍👩‍👧 Merged update from "+(p.from||"family"),()=>{txns=before.txns;accounts=before.accounts;save();});
}
function ffxFamilyHTML(){
  return`<div class="ffx-hero"><div class="fz11 muted">Share a household ledger — no account, no cloud</div><div class="ffx-hero-num" style="font-size:22px">Family ledger</div><div class="fz11 muted">Mark the accounts you share (a house account, joint savings). Send an update file over WhatsApp; the other phone opens it here to merge.</div></div>
    <div class="st-label">Shared accounts</div><div class="card" style="padding:4px 14px">${accounts.map(a=>`<div class="toggle-wrap" style="padding:8px 0"><div class="fz12 fw6">${esc(a.name)}</div><label class="toggle"><input type="checkbox" ${a.shared?"checked":""} onchange="toggleSharedAccount('${escJs(a.id)}',this.checked)"><span class="toggle-slider"></span></label></div>`).join("")}</div>
    <div class="grid2 mt12"><button class="btn btn-p" style="justify-content:center;padding:13px" onclick="exportFamilyUpdate()">📤 Send update</button><button class="btn btn-g" style="justify-content:center;padding:13px" onclick="importFamilyUpdate()">📥 Receive update</button></div>
    <div class="fz10 muted mt10">${ffx.lastFamilySent?"Last sent "+fmtD(ffx.lastFamilySent.slice(0,10))+". ":""}${ffx.lastFamilyReceived?"Last received from "+esc(ffx.lastFamilyReceived.from||"family")+" "+fmtD(ffx.lastFamilyReceived.at.slice(0,10))+".":""}</div>
    <div class="card mt12"><div class="fz12 fw7 mb6">How it works</div><div class="fz11 muted" style="line-height:1.6">• Only transactions in shared accounts go in the file.<br>• New entries are added, edited ones take the sender's version, and deletions carry over.<br>• You confirm before anything changes, and can undo straight after.<br>• Both phones need FinanceFlow; the file is plain JSON, so share it only with people you trust.</div></div>`;
}

// register the new tools
FFX_TOOLS.push({id:"scan",icon:"📷",label:"Scan receipt",sub:"Photo or screenshot"},{id:"assistant",icon:"🤖",label:"AI assistant",sub:"Ask with your Claude key"},{id:"wifi",icon:"💻",label:"Wi-Fi editor",sub:"Edit on a computer"},{id:"family",icon:"👨‍👩‍👧",label:"Family ledger",sub:"Share via WhatsApp"});
FFX_RENDER.assistant=ffxAssistantHTML;FFX_RENDER.wifi=ffxLanHTML;FFX_RENDER.family=ffxFamilyHTML;
FFX_RENDER.scan=()=>`<div class="ffx-hero"><div class="fz11 muted">Read on this phone — nothing is uploaded</div><div class="ffx-hero-num" style="font-size:22px">Scan a receipt or transfer screenshot</div><div class="fz11 muted">Works with POS slips and screenshots from OPay, Moniepoint, Kuda, PalmPay and bank apps. FinanceFlow reads the amount, date, who you paid and the reference, then lets you check before saving.</div></div><button class="btn btn-p w100" style="justify-content:center;padding:13px" onclick="startReceiptScan()">📷 Choose a photo or screenshot</button><div class="fz10 muted mt10">Tip: take the photo first with your camera app, flat and well lit, then pick it here.</div>`;

// ════════════════ Tab upgrades: Stats, History, Projects, Settings ════════════════
// ── Stats ──
function ffxStatsData(type,mode,date){
  const r=getRangeFor(mode,date),p=ffxPrevRange(mode,date);
  const list=txns.filter(t=>t.type===type&&t.date>=r.startStr&&t.date<=r.endStr);
  const prev=p?txns.filter(t=>t.type===type&&t.date>=p.startStr&&t.date<=p.endStr):[];
  const sum=l=>l.reduce((s,t)=>s+ffxPA(t),0),today=ffxToday(),endCap=r.endStr<today?r.endStr:today;
  return{r,list,count:list.length,total:sum(list),prevTotal:sum(prev),hasPrev:!!p,days:Math.max(1,ffxDaysBetween(r.startStr,endCap)+1)};
}
function ffxStatsSummaryHTML(type){
  const d=ffxStatsData(type,pMode,pDate);if(!d.count&&!d.prevTotal)return"";
  const chg=d.prevTotal>0?(d.total-d.prevTotal)/d.prevTotal*100:null,good=type==="income"?chg>=0:chg<=0;
  const label={week:"last week",month:"last month",quarter:"last quarter",year:"last year",custom:"prior range"}[pMode]||"before";
  return`<div class="ffx-ssum"><div><span>Per day</span><b>${fmtK(d.total/d.days)}</b></div><div style="${d.hasPrev?"":"display:none"}"><span>vs ${label}</span><b class="${chg===null?"":good?"green":"red"}">${chg===null?"—":(chg>=0?"▲ ":"▼ ")+Math.abs(chg).toFixed(0)+"%"}</b></div><div><span>Entries</span><b>${d.count}</b></div></div>`;
}
function ffxViewCat(cat,type){fCat=cat;fType=type;fAcc="all";search="";ffxHist.flag="";ffxHist.min="";ffxHist.max="";goTo("transactions");}
function ffxViewSearch(text,type){fCat="all";fType=type;fAcc="all";search=text;ffxHist.flag="";ffxHist.min="";ffxHist.max="";goTo("transactions");}
function ffxStatsExtrasHTML(type){
  const d=ffxStatsData(type,pMode,pDate);if(!d.count)return"";
  const isExp=type==="expense",names=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],wd=[0,0,0,0,0,0,0];
  d.list.forEach(t=>{const dt=FinanceCore.date(t.date);if(dt)wd[(dt.getDay()+6)%7]+=ffxPA(t);});
  const wmax=Math.max(...wd,1),wtop=wd.indexOf(Math.max(...wd));
  const weekday=`<div class="card"><div class="flex-b mb8"><span class="fz12 fw7">${isExp?"Spending":"Income"} by weekday</span><span class="fz10 muted">Busiest: ${names[wtop]}</span></div><div class="ffx-bars" style="height:86px">${wd.map((v,i)=>`<div class="ffx-bar-col"><div class="ffx-bar-val">${v?fmtK(v):""}</div><div class="ffx-bar" style="height:${Math.max(v/wmax*100,v?4:0)}%;${i===wtop?"":"opacity:.45;"}background:${isExp?"var(--red)":"var(--green)"}"></div><div class="ffx-bar-lbl">${names[i]}</div></div>`).join("")}</div></div>`;
  const pm={};d.list.forEach(t=>{const lab=(t.description||"").trim();if(!lab)return;const o=pm[lab.toLowerCase()]=pm[lab.toLowerCase()]||{lab,total:0,n:0};o.total+=ffxPA(t);o.n++;});
  const top=Object.values(pm).sort((a,b)=>b.total-a.total).slice(0,5),tmax=top[0]?top[0].total:1;
  const payees=top.length?`<div class="card"><div class="fz12 fw7 mb8">${isExp?"Where it went":"Who paid you"}</div>${top.map(o=>`<button class="ffx-prow" onclick="ffxViewSearch('${escJs(o.lab)}','${type}')"><div class="flex-b"><span class="fz12 fw6 ellip">${esc(o.lab)}</span><span class="fz12 fw7">${fmt(o.total)}</span></div><div class="bar-track mt4"><div class="bar-fill" style="width:${o.total/tmax*100}%;background:${isExp?"var(--red)":"var(--green)"};opacity:.7"></div></div><div class="fz9 muted mt4">${o.n} time${o.n===1?"":"s"} · tap to see them</div></button>`).join("")}</div>`:"";
  const big=d.list.slice().sort((a,b)=>ffxPA(b)-ffxPA(a)).slice(0,3);
  const biggest=`<div class="card"><div class="fz12 fw7 mb4">Biggest ${isExp?"purchases":"payments"}</div>${big.map(t=>`<div class="ffx-row" style="cursor:pointer" onclick="showModal('edit','${escJs(t.id)}')"><div style="min-width:0"><div class="fz12 fw6 ellip">${esc(t.description||t.category)}</div><div class="fz10 muted">${fmtD(t.date)} · ${esc(t.category||"")}</div></div><div class="fz12 fw8 ${isExp?"red":"green"}">${fmtTxn(t)}</div></div>`).join("")}</div>`;
  const months=[],base0=getRangeFor("month",pDate);for(let i=5;i>=0;i--){const m=new Date(base0.start);m.setMonth(m.getMonth()-i);const r=getRangeFor("month",m);months.push({label:MO[m.getMonth()],cur:i===0,v:txns.filter(t=>t.type===type&&t.date>=r.startStr&&t.date<=r.endStr).reduce((s,t)=>s+ffxPA(t),0)});}
  const mmax=Math.max(...months.map(m=>m.v),1),avg=months.reduce((s,m)=>s+m.v,0)/6;
  const trend=`<div class="card"><div class="flex-b mb8"><span class="fz12 fw7">Last 6 months</span><span class="fz10 muted">Average ${fmtK(avg)}</span></div><div class="ffx-bars" style="height:96px">${months.map(m=>`<div class="ffx-bar-col"><div class="ffx-bar-val">${m.v?fmtK(m.v):""}</div><div class="ffx-bar" style="height:${Math.max(m.v/mmax*100,m.v?4:0)}%;${m.cur?"":"opacity:.45;"}background:${isExp?"var(--red)":"var(--green)"}"></div><div class="ffx-bar-lbl" style="${m.cur?"font-weight:800;color:var(--text)":""}">${m.label}</div></div>`).join("")}</div></div>`;
  return ffxCashFlowHTML(type,d)+trend+weekday+payees+ffxBudgetCheckHTML(type)+ffxBreakdownHTML(type,d)+biggest+`<button class="btn btn-g w100 mb12" style="justify-content:center" onclick="ffxExportStatsCsv()">⤓ Export this breakdown (CSV)</button>`;
}

// ── History ──
let ffxHist={open:false,sort:"new",min:"",max:"",flag:"",allTime:false,group:"day"};let ffxDupMemo=null,ffxSince=0;
function ffxLargeThreshold(){
  const from=ffxAddDays(ffxToday(),-120),a=txns.filter(t=>t.type==="expense"&&t.date>=from).map(ffxPA).sort((x,y)=>x-y);
  return a.length<10?Infinity:a[Math.floor(a.length*0.9)];
}
function ffxHistMatch(t){
  const f=ffxHist;if(!f.flag&&!f.min&&!f.max)return true;
  const a=t.type==="transfer"?(Number(t.amount)||0):ffxPA(t);
  if(f.min&&a<parseAmount(f.min))return false;
  if(f.max&&a>parseAmount(f.max))return false;
  if(f.flag==="review"&&!t.needsReview)return false;
  if(f.flag==="uncleared"&&(t.type==="transfer"||t.cleared))return false;
  if(f.flag==="receipt"&&!(t.receipt||t.source==="Receipt"))return false;
  if(f.flag==="large"&&!(t.type==="expense"&&a>=ffxLargeThreshold()))return false;
  if(f.flag==="new"&&!ffxIsNew(t))return false;
  if(f.flag==="dup"&&!ffxDupIds().has(t.id))return false;
  return true;
}
function ffxHistSorted(list){
  const a=list.slice(),amt=t=>t.type==="transfer"?(Number(t.amount)||0):ffxPA(t);
  if(ffxHist.sort==="big")return a.sort((x,y)=>amt(y)-amt(x));
  if(ffxHist.sort==="small")return a.sort((x,y)=>amt(x)-amt(y));
  if(ffxHist.sort==="old")return a.sort((x,y)=>x.date.localeCompare(y.date));
  return a.sort((x,y)=>y.date.localeCompare(x.date));
}
const ffxHistFlat=()=>ffxHist.sort==="big"||ffxHist.sort==="small";
function ffxHistActiveCount(){return(fType!=="all")+(fCat!=="all")+(fAcc!=="all")+(!!ffxHist.min)+(!!ffxHist.max)+(!!ffxHist.flag)+(ffxHist.sort!=="new");}
function ffxSetFlag(k){ffxHist.flag=ffxHist.flag===k?"":k;haptic("light");render();}
function ffxHistReset(){fType="all";fCat="all";fAcc="all";search="";ffxHist.min="";ffxHist.max="";ffxHist.flag="";ffxHist.sort="new";ffxHist.allTime=false;ffxHist.group="day";render();}
function ffxHistFilterBar(){
  const f=ffxHist,n=ffxHistActiveCount(),r=getRangeFor(pMode,pDate),inR=txns.filter(t=>t.date>=r.startStr&&t.date<=r.endStr);
  const cnt={review:inR.filter(t=>t.needsReview).length,uncleared:inR.filter(t=>t.type!=="transfer"&&!t.cleared).length,receipt:inR.filter(t=>t.receipt||t.source==="Receipt").length};
  const nNew=ffxSince?inR.filter(ffxIsNew).length:0,nDup=ffxDupIds().size;
  const chip=(k,label,c)=>`<button class="ffx-hchip ${f.flag===k?"on":""}" aria-pressed="${f.flag===k}" onclick="ffxSetFlag('${k}')">${label}${c!==undefined?` <i>${c}</i>`:""}</button>`;
  const sortName={new:"Newest first",old:"Oldest first",big:"Largest first",small:"Smallest first"};
  const tags=[];
  if(f.allTime)tags.push(["All time","ffxHist.allTime=false"]);
  if(fType!=="all")tags.push(["Type: "+fType,"fType='all'"]);
  if(fCat!=="all")tags.push([fCat,"fCat='all'"]);
  if(fAcc!=="all")tags.push([accName(fAcc)||"Account","fAcc='all'"]);
  if(f.min)tags.push(["Min "+f.min,"ffxHist.min=''"]);
  if(f.max)tags.push(["Max "+f.max,"ffxHist.max=''"]);
  if(f.sort!=="new")tags.push([sortName[f.sort],"ffxHist.sort='new'"]);
  const panel=f.open?`<div class="ffx-hpanel"><div class="tx-filters" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <select class="inp" aria-label="Type" style="font-size:12px" onchange="fType=this.value;render()"><option value="all">All types</option>${["income","expense","transfer"].map(x=>`<option value="${x}" ${fType===x?"selected":""}>${x[0].toUpperCase()+x.slice(1)}</option>`).join("")}</select>
      <select class="inp" aria-label="Category" style="font-size:12px" onchange="fCat=this.value;render()"><option value="all">All categories</option>${allCats().map(c=>`<option value="${esc(c)}" ${fCat===c?"selected":""}>${esc(c)}</option>`).join("")}</select>
      <select class="inp" aria-label="Account" style="font-size:12px" onchange="fAcc=this.value;render()"><option value="all">All accounts</option>${accounts.map(a=>`<option value="${esc(a.id)}" ${fAcc===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div>
    <div class="grid2 mt8" style="gap:8px"><input class="inp" inputmode="decimal" aria-label="Minimum amount" style="font-size:12px" placeholder="Min amount" value="${esc(f.min)}" onchange="ffxHist.min=this.value;render()"><input class="inp" inputmode="decimal" aria-label="Maximum amount" style="font-size:12px" placeholder="Max amount" value="${esc(f.max)}" onchange="ffxHist.max=this.value;render()"></div>
    <select class="inp mt8" aria-label="Sort" style="font-size:12px" onchange="ffxHist.sort=this.value;render()">${Object.entries(sortName).map(([k,v])=>`<option value="${k}" ${f.sort===k?"selected":""}>${v}</option>`).join("")}</select>
    <select class="inp mt8" aria-label="Group by" style="font-size:12px" onchange="ffxHist.group=this.value;render()">${[["day","Group by day"],["week","Group by week"],["cat","Group by category"]].map(([k,v])=>`<option value="${k}" ${f.group===k?"selected":""}>${v}</option>`).join("")}</select>
    <div class="flex g6 mt8"><button class="btn btn-g btn-sm" style="flex:1;justify-content:center" onclick="ffxSaveFilter()">☆ Save this filter</button>${(ffx.savedFilters||[]).length?`<button class="btn btn-g btn-sm" style="flex:1;justify-content:center" onclick="ffxManageSaved()">Manage saved</button>`:""}</div>
    <div class="flex g6 mt8"><button class="btn btn-g btn-sm" style="flex:1;justify-content:center" onclick="ffxHistReset()">Reset all</button><button class="btn btn-g btn-sm" style="flex:1;justify-content:center" onclick="exportFilteredCSV()">⤓ Export these</button></div></div>`:"";
  return`<div class="ffx-hf"><div class="flex g6"><div style="position:relative;flex:1"><span style="position:absolute;left:10px;top:11px;font-size:12px" class="muted">&#128269;</span><input class="inp" id="si" aria-label="Search transactions" style="padding-left:30px;font-size:13px" placeholder="Search description, category, tag…" value="${esc(search)}" oninput="doS(this.value)"></div><button class="ffx-hbtn ${n||f.open?"on":""}" aria-expanded="${f.open}" onclick="ffxHist.open=!ffxHist.open;render()">⚙ Filters${n?` <i>${n}</i>`:""}</button></div>
    <div class="ffx-hchips">${(ffx.savedFilters||[]).map(sf=>`<button class="ffx-hchip saved" onclick="ffxApplySaved('${escJs(sf.id)}')">★ ${esc(sf.name)}</button>`).join("")}${nNew?chip("new","🆕 New",nNew):""}${nDup?chip("dup","⚠ Duplicates",nDup):""}${chip("review","📥 Review",cnt.review)}${chip("uncleared","○ Uncleared",cnt.uncleared)}${chip("receipt","📷 Receipts",cnt.receipt)}${chip("large","⬆ Large")}<button class="ffx-hchip ${f.allTime?"on":""}" aria-pressed="${f.allTime}" onclick="ffxHist.allTime=!ffxHist.allTime;haptic('light');render()">🌐 All time</button></div>${ffxOutsideHint()}
    ${panel}${f.flag==="dup"?`<div class="ffx-dupbar"><span>Same account, amount and nearly the same date. Open an entry to delete the extra, or dismiss these.</span><button class="btn btn-sm btn-g" onclick="ffxDupDismissAll()">Dismiss all</button></div>`:""}${tags.length?`<div class="ffx-hchips">${tags.map(([l,c])=>`<button class="ffx-hchip tag" onclick="${c};render()">${esc(l)} ✕</button>`).join("")}${tags.length>1?`<button class="ffx-hchip" onclick="ffxHistReset()">Clear all</button>`:""}</div>`:""}</div>`;
}
function ffxFlatCardHTML(sorted){
  const shown=sorted.slice(0,txRenderLimit),left=sorted.length-shown.length;
  window._txShown=shown.length;
  return`<div class="card" style="padding:0;overflow:hidden"><div class="date-hdr flex-b"><span>${ffxHist.sort==="big"?"Largest first":"Smallest first"}</span><span class="date-hdr-tot"></span></div>${shown.length?shown.map(t=>txListRow(t,selectMode)).join(""):'<div class="muted fz12 tac" style="padding:40px">No transactions found</div>'}${left>0?`<button class="btn btn-g w100 ffx-more" onclick="txRenderLimit+=200;render()">Show ${Math.min(left,200)} more · ${left} older</button>`:""}</div>`;
}
function ffxCsv(list,filename){
  const q=v=>{let s=String(v??"");if(/^[=+\-@\t\r]/.test(s)&&isNaN(Number(s)))s="'"+s;return'"'+s.replace(/"/g,'""')+'"';};
  const rows=[["Date","Description","Type","Category","Subcategory","Account","Amount","Currency","Tags"],...list.map(t=>t.type==="transfer"?[t.date,t.description||"","transfer","Transfer","",accName(t.fromAccountId)+" -> "+accName(t.toAccountId),t.amount,txnCurrency(t),(t.tags||[]).join("; ")]:[t.date,t.description||"",t.type,t.category||"",t.subcategory||"",accName(t.accountId),t.amount,txnCurrency(t),(t.tags||[]).join("; ")])];
  saveOrDownload(filename,rows.map(r=>r.map(q).join(",")).join("\n"),"text/csv");
}
function exportFilteredCSV(){const l=ffxHistSorted(getF());if(!l.length)return showToast("Nothing to export","warn");ffxCsv(l,"financeflow-history-"+ffxToday()+".csv");}

// ── Projects ──
function ffxProjStats(p){
  const ex=txns.filter(t=>t.projectId===p.id&&t.type==="expense"),spent=ex.reduce((s,t)=>s+ffxPA(t),0);
  const committed=commitments.filter(c=>c.projectId===p.id&&c.status==="open").reduce((s,c)=>s+Number(c.amount||0),0);
  const budget=Number(p.budget)||0,today=ffxToday(),start=FinanceCore.date(p.startDate)?p.startDate:null,end=FinanceCore.date(p.expectedEndDate)?p.expectedEndDate:null;
  const elapsed=start?Math.max(0,ffxDaysBetween(start,today)+1):0,total=start&&end?Math.max(1,ffxDaysBetween(start,end)+1):0,left=end?ffxDaysBetween(today,end):null,burn=elapsed>0?spent/elapsed:0;
  const projected=end&&elapsed>=7&&left>0&&p.status==="active"?spent+burn*left+committed:null;
  return{ex,spent,committed,budget,start,end,elapsed,total,left,burn,projected,used:budget>0?(spent+committed)/budget*100:0};
}
function ffxProjectCard(p,selected){
  const s=ffxProjStats(p),over=s.budget>0&&s.spent+s.committed>s.budget;
  const due=p.status!=="active"||s.left===null?"":s.left<0?`<span class="ffx-pill bad">${-s.left}d overdue</span>`:s.left<=7?`<span class="ffx-pill warn">${s.left}d left</span>`:`<span class="ffx-pill">${s.left}d left</span>`;
  return`<button class="card ffx-pcard ${selected&&selected.id===p.id?"sel":""}" onclick="selectedProjectId='${escJs(p.id)}';render()"><div class="flex-b g6"><span class="fz12 fw7 ellip">${esc(p.name)}</span><span class="ffx-pill ${p.status==="active"?"ok":""}">${projectStatusLabel(p.status)}</span></div>
    <div class="fz14 fw8 mt6 ${over?"red":""}">${fmtK(s.spent+s.committed)}<span class="fz10 muted fw6"> of ${fmtK(s.budget)}</span></div>
    <div class="bar-track mt6"><div class="bar-fill" style="width:${Math.min(100,s.used)}%;background:${over?"var(--red)":s.used>=80?"var(--warn)":"var(--accent)"}"></div></div>
    <div class="flex-b mt6 fz9 muted g6"><span>${over?"▲ Over by "+fmtK(s.spent+s.committed-s.budget):s.budget>0?fmtK(s.budget-s.spent-s.committed)+" left":"No budget set"}</span>${due}</div></button>`;
}
function ffxProjectSummaryHTML(){
  if(!projects.length)return"";
  const act=projects.filter(p=>p.status==="active"),st=act.map(ffxProjStats);
  const budget=st.reduce((s,x)=>s+x.budget,0),used=st.reduce((s,x)=>s+x.spent+x.committed,0),over=st.filter(x=>x.budget>0&&x.spent+x.committed>x.budget).length;
  return`<div class="ffx-ssum mb10"><div><span>Active</span><b>${act.length}</b></div><div><span>Spent + committed</span><b>${fmtK(used)}</b></div><div><span>Of budgets</span><b>${fmtK(budget)}</b></div><div><span>Over budget</span><b class="${over?"red":""}">${over?"▲ ":""}${over}</b></div></div>`;
}
function ffxAddProjectExpense(id){showModal("addtx");const s=$("txProject");if(s)s.value=id;setTimeout(()=>{const a=$("txAmt");if(a)a.focus();},250);}
function ffxProjectInsightsHTML(p){
  const s=ffxProjStats(p),today=ffxToday();
  const start=s.start||(s.ex.length?s.ex.slice().sort((a,b)=>a.date.localeCompare(b.date))[0].date:today);
  const endD=s.end&&s.end>today?s.end:today,span=Math.max(1,ffxDaysBetween(start,endD));
  let cum=0;const pts=[[0,0]];
  s.ex.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{cum+=ffxPA(t);pts.push([Math.max(0,Math.min(span,ffxDaysBetween(start,t.date))),cum]);});
  const tx=Math.min(span,Math.max(0,ffxDaysBetween(start,today)));pts.push([tx,cum]);
  const maxV=Math.max(s.budget,cum+s.committed,s.projected||0,1)*1.06,W=300,H=84,X=d=>d/span*W,Y=v=>H-(v/maxV)*(H-6)-3;
  const line=pts.map((q,i)=>(i?"L":"M")+X(q[0]).toFixed(1)+","+Y(q[1]).toFixed(1)).join(" ");
  const over=s.budget>0&&cum+s.committed>s.budget;
  const chart=s.ex.length?`<svg viewBox="0 0 ${W} ${H}" class="ffx-pace" preserveAspectRatio="none" aria-hidden="true">
    ${s.budget>0?`<line x1="0" x2="${W}" y1="${Y(s.budget)}" y2="${Y(s.budget)}" stroke="var(--red)" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`:""}
    ${s.budget>0&&s.end?`<line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(s.budget)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 4" opacity=".5"/>`:""}
    ${s.projected!==null?`<line x1="${X(tx)}" y1="${Y(cum)}" x2="${W}" y2="${Y(s.projected)}" stroke="${over||s.projected>s.budget&&s.budget>0?"var(--red)":"var(--accent)"}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>`:""}
    <path d="${line}" fill="none" stroke="${over?"var(--red)":"var(--accent)"}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(tx)}" cy="${Y(cum)}" r="3.5" fill="${over?"var(--red)":"var(--accent)"}"/></svg>`:"";
  let msg="";
  if(s.projected!==null)msg=s.budget>0?(s.projected>s.budget?`<b class="red">▲ At this pace you'll reach ${fmt(s.projected)} by ${fmtD(s.end)} — ${fmt(s.projected-s.budget)} over budget.</b>`:`<b class="green">✓ At this pace you'll finish near ${fmt(s.projected)} — ${fmt(s.budget-s.projected)} under budget.</b>`):`At this pace you'll reach about ${fmt(s.projected)} by ${fmtD(s.end)}.`;
  else if(s.spent>0&&s.elapsed>0)msg=`Spending about ${fmt(s.burn)} a day so far.`;
  const prog=s.total?`Day ${Math.min(s.elapsed,s.total)} of ${s.total}`+(s.left!==null?` · ${s.left<0?-s.left+" days overdue":s.left+" days left"}`:""):"";
  const cats={};s.ex.forEach(t=>cats[t.category]=(cats[t.category]||0)+ffxPA(t));
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5),tmax=top[0]?top[0][1]:1;
  const catHTML=top.length?`<div class="fz11 fw7 mb6 mt12">Where the money went</div>${top.map(([c,v])=>`<button class="ffx-prow" onclick="projectCategory='${escJs(c)}';render()"><div class="flex-b"><span class="fz11 fw6"><span class="cat-dot" style="display:inline-block;background:${clr(c)};margin-right:6px"></span>${esc(c)}</span><span class="fz11 fw7">${fmt(v)} <span class="muted fw6">· ${(v/Math.max(cum,1)*100).toFixed(0)}%</span></span></div><div class="bar-track mt4"><div class="bar-fill" style="width:${v/tmax*100}%;background:${clr(c)}"></div></div></button>`).join("")}`:"";
  return`<div class="ffx-pins"><div class="flex-b mb4"><span class="fz11 fw7">Spending vs budget</span><span class="fz10 muted">${prog}</span></div>${chart||`<div class="fz10 muted">No expenses linked yet. Choose this project when you add an expense.</div>`}${chart?`<div class="flex g10 fz9 muted mt4"><span><span class="ffx-key" style="background:var(--accent)"></span>Spent</span>${s.budget>0?`<span><span class="ffx-key" style="background:var(--red)"></span>Budget</span>`:""}${s.budget>0&&s.end?`<span><span class="ffx-key dashed"></span>Planned pace</span>`:""}</div>`:""}
    ${msg?`<div class="fz11 mt8">${msg}</div>`:""}${catHTML}
    ${ffxProjectFundingHTML(p)}${ffxProjectMilestonesHTML(p)}${ffxProjectReceiptsHTML(p)}
    <div class="grid2 mt12" style="gap:8px"><button class="btn btn-p" style="justify-content:center" onclick="ffxAddProjectExpense('${escJs(p.id)}')">+ Expense</button><button class="btn btn-g" style="justify-content:center" onclick="ffxAddProjectFunding('${escJs(p.id)}')">+ Funding</button></div>
    <div class="grid2 mt8" style="gap:8px"><button class="btn btn-g" style="justify-content:center" onclick="ffxShareProjectReport('${escJs(p.id)}')">📤 Share report</button><button class="btn btn-g" style="justify-content:center" onclick="ffxExportProjectCsv('${escJs(p.id)}')">⤓ CSV</button></div></div>`;
}

// ── Settings ──
function ffxVersionLabel(){try{if(window.Android&&window.Android.getAppVersion)return"Version "+window.Android.getAppVersion();}catch(e){}return"Version (preview)";}
function ffxBackupAge(){const t=Number(appStorage.getItem("ffd_lastbackup"))||0;return t?Math.floor((Date.now()-t)/864e5):null;}
const FFX_SET_GROUPS=[
  {title:"Your money",items:[["accounts","🏦","Accounts"],["budgets","🎯","Budgets"],["goals","🏆","Goals"],["recurring","🔁","Recurring"],["categories","🗂️","Categories"],["tags","🏷️","Tags"],["rules","📝","Auto-categorize rules"]]},
  {title:"The app",items:[["tools","🧰","Money tools"],["appearance","🎨","Appearance"],["preferences","🎚️","Preferences"],["security","🔒","Security & privacy"],["notifications","🔔","Bank Alerts"]]},
  {title:"Your data",items:[["backup","☁️","Backup & Restore"],["import","📥","Import from another app"],["about","ℹ️","About"]]}];
function ffxSetTileSub(id){
  if(id==="tools")return"Forecast, ajo, IOUs, scan, AI…";
  if(id==="preferences")return(ffxMonthStart()>1?"Month from "+ffxMonthStart()+ffxOrd(ffxMonthStart())+" · ":"")+(FFX_LANGS[uxPrefs.lang||"en"])+(uxPrefs.lite?" · Lite":"");
  if(id==="security"){const base=settingsItemSub("security");return privacyMode?base+" · amounts hidden":base;}
  if(id==="import")return"Money Manager, Wallet, Monefy, CSV";
  if(id==="rules")return importRules.length?importRules.length+" rule"+(importRules.length===1?"":"s"):"Teach it your payees";
  if(id==="backup"){const a=ffxBackupAge();return a===null?"Never backed up":a===0?"Backed up today":"Last backup "+a+"d ago";}
  return settingsItemSub(id);
}
function ffxSetTilesHTML(q){
  q=String(q||"").trim().toLowerCase();let out="";
  FFX_SET_GROUPS.forEach(g=>{
    const items=g.items.filter(([id,,label])=>!q||(label+" "+ffxSetTileSub(id)+" "+id).toLowerCase().includes(q));if(!items.length)return;
    out+=`<div class="ffx-sgroup">${esc(g.title)}</div><div class="settings-grid">${items.map(([id,icon,label])=>`<button class="settings-card" onclick="${id==="tools"?"closeSettings();openTool('hub')":id==="import"?"ffxImportStart()":`setSTTab('${id}')`}"><div class="settings-card-icon">${icon}</div><div class="settings-card-label">${esc(label)}</div><div class="settings-card-sub ellip">${ffxSetTileSub(id)}</div></button>`).join("")}</div>`;
  });
  return out||`<div class="empty-state mt12"><div class="empty-ic">🔎</div><div class="fz13 fw7">No settings match “${esc(q)}”</div></div>`;
}
function ffxSetSearch(v){ffxState.setQ=v;const g=$("stGrid");if(g)g.innerHTML=ffxSetTilesHTML(v);}
function ffxSettingsHomeHTML(){
  const age=ffxBackupAge(),needsBackup=ffxBackupDays()>0&&txns.length>=10&&(age===null||age>=ffxBackupDays());
  const initial=(profile.name||"?").trim().charAt(0).toUpperCase()||"?";
  const lock=biometricEnabled||pinHash;
  return`<div class="st-section">
    <button class="ffx-prof" onclick="setSTTab('profile')"><div class="ffx-prof-av">${esc(initial)}</div><div style="flex:1;min-width:0;text-align:left"><div class="fz14 fw8 ellip">${esc(profile.name)||"Set up your profile"}</div>
      <div class="ffx-prof-chips"><span class="${lock?"ok":"warn"}">${lock?"🔒 Locked":"🔓 No lock"}</span><span>${currency.code}</span><span>${accounts.length} account${accounts.length===1?"":"s"}</span><span>${txns.length.toLocaleString()} entries</span></div></div><span class="muted" style="font-size:18px">›</span></button>
    ${needsBackup?`<button class="ffx-backup-warn" onclick="setSTTab('backup')"><span style="font-size:20px">💾</span><div style="text-align:left;flex:1"><div class="fz12 fw8">${age===null?"You haven't backed up yet":"Last backup was "+age+" days ago"}</div><div class="fz10" style="opacity:.85">Your data lives only on this phone. Tap to save a copy.</div></div><span>›</span></button>`:""}
    <div class="ffx-ssearch"><span>🔎</span><input id="stSearch" aria-label="Search settings" placeholder="Search settings" autocomplete="off" value="${esc(ffxState.setQ||"")}" oninput="ffxSetSearch(this.value)"></div>
    <div id="stGrid">${ffxSetTilesHTML(ffxState.setQ)}</div></div>`;
}
function ffxPreferencesHTML(){
  return`<div class="st-section">${ffxMonthStartHTML()}${ffxFormatsHTML()}${ffxBudgetAlertHTML()}${ffxRemindersHTML()}${ffxBackupFreqHTML()}${uxFeelHTML()}
    <span class="st-label" style="margin-top:6px">Language <span class="ffx-beta">beta</span></span>
    <select class="inp mb6" onchange="setLang(this.value)">${Object.entries(FFX_LANGS).map(([k,v])=>`<option value="${k}" ${(uxPrefs.lang||"en")===k?"selected":""}>${v}</option>`).join("")}</select>
    <div class="fz10 muted mb16">Translates the main tabs, buttons and Home headings. These are first-draft translations.</div>
    <div class="toggle-wrap mb6"><div><div class="fz12 fw6">⚡ Lite mode</div><div class="fz10 muted mt4">For older or low-memory phones: no animations, blur or shadows, and fewer rows at once.</div></div><label class="toggle"><input type="checkbox" ${uxPrefs.lite?"checked":""} onchange="setLite(this.checked)"><span class="toggle-slider"></span></label></div></div>`;
}

// ════════════════ Header: greeting / page title + period selector ════════════════
const FFX_PAGE_TITLES={stats:"Stats",transactions:"History",budgets:"Budgets",projects:"Projects"};
function ffxCustomizeHome(){closeSettings();goTo("dashboard");homeCustomize=true;render();}
function ffxAppearanceExtras(){
  return`<span class="st-label" style="margin-top:16px">Home screen</span>
    <button class="btn btn-g w100 mb6" style="justify-content:center" onclick="ffxCustomizeHome()">&#9881; Rearrange or hide Home cards</button>
    <div class="fz10 muted mb16">Reorder, hide or bring back the cards on Home. Tap Done at the top of Home when finished.</div>
    <div class="fz10 muted">Language, tone, vibration and Lite mode are under <b>Settings › Preferences</b>.</div>`;
}


// ════════════════ Shared period model: month start day, custom range, all time ════════════════
function ffxMonthStart(){const d=Number(ffx&&ffx.monthStart);return d>=1&&d<=28?Math.floor(d):1;}
function ffxAllBounds(){
  let min=null,max=null;for(const t of txns){if(!FinanceCore.date(t.date))continue;if(min===null||t.date<min)min=t.date;if(max===null||t.date>max)max=t.date;}
  const today=toLocalISODate(new Date());if(min===null)min=today;if(max===null||max<today)max=today;
  return{start:FinanceCore.date(min),end:FinanceCore.date(max)};
}
function ffxCustomRange(){
  const c=ffx&&ffx.custom;
  if(c&&FinanceCore.date(c.from)&&FinanceCore.date(c.to)&&c.from<=c.to)return{start:FinanceCore.date(c.from),end:FinanceCore.date(c.to)};
  const e=new Date(),s=new Date();s.setDate(s.getDate()-29);
  return{start:new Date(s.getFullYear(),s.getMonth(),s.getDate()),end:new Date(e.getFullYear(),e.getMonth(),e.getDate())};
}
function ffxPrevRange(mode,date){
  if(mode==="all")return null;
  if(mode==="custom"){
    const c=ffxCustomRange(),cs=toLocalISODate(c.start),len=ffxDaysBetween(cs,toLocalISODate(c.end))+1;
    const s=FinanceCore.date(ffxAddDays(cs,-len)),e=FinanceCore.date(ffxAddDays(cs,-1));
    return{start:s,end:e,startStr:toLocalISODate(s),endStr:toLocalISODate(e)};
  }
  const a=new Date(getRangeFor(mode,date).start);
  if(mode==="week")a.setDate(a.getDate()-7);else if(mode==="month")a.setMonth(a.getMonth()-1);else if(mode==="quarter")a.setMonth(a.getMonth()-3);else a.setFullYear(a.getFullYear()-1);
  return getRangeFor(mode,a);
}
function ffxShortDate(d){return d.getDate()+" "+MO[d.getMonth()];}
function ffxPeriodLabel(mode,date){
  const d=new Date(date);
  if(mode==="all")return"All time";
  if(mode==="custom"){const c=ffxCustomRange(),y=new Date().getFullYear();return ffxShortDate(c.start)+(c.start.getFullYear()!==y?" "+c.start.getFullYear():"")+" – "+ffxShortDate(c.end)+(c.end.getFullYear()!==y?" "+c.end.getFullYear():"");}
  if(mode==="week"){const r=getRangeFor("week",d),a=r.start,b=r.end;return a.getMonth()===b.getMonth()?`${a.getDate()}–${b.getDate()} ${MO[b.getMonth()]}`:`${a.getDate()} ${MO[a.getMonth()]}–${b.getDate()} ${MO[b.getMonth()]}`;}
  if(mode==="month"){if(ffxMonthStart()>1){const r=getRangeFor("month",d);return ffxShortDate(r.start)+"–"+ffxShortDate(r.end);}return MO[d.getMonth()]+" "+d.getFullYear();}
  if(mode==="quarter")return"Q"+(Math.floor(d.getMonth()/3)+1)+" "+d.getFullYear();
  return String(d.getFullYear());
}
// Budgets have their own per-budget periods, so "All time" / "Custom" don't apply there: show months.
function ffxEffMode(){return V==="budgets"&&(pMode==="all"||pMode==="custom")?"month":pMode;}
function ffxNavPeriod(dir){
  const mode=ffxEffMode();
  if(mode==="all")return;
  if(mode==="custom"){
    const c=ffxCustomRange(),a=toLocalISODate(c.start),b=toLocalISODate(c.end),len=ffxDaysBetween(a,b)+1;
    ffx.custom={from:ffxAddDays(a,dir*len),to:ffxAddDays(b,dir*len)};ffxSave();ppOpen=false;render();return;
  }
  let d=new Date(pDate);
  if(mode==="week")d.setDate(d.getDate()+dir*7);
  else if(mode==="month"){d=new Date(getRangeFor("month",d).start);d.setMonth(d.getMonth()+dir);}
  else if(mode==="quarter"){d.setDate(1);d.setMonth(d.getMonth()+dir*3);}
  else d.setFullYear(d.getFullYear()+dir);
  pDate=d;ppOpen=false;render();
}
function ffxPickMode(m){if(m==="custom"){ppOpen=false;ffxOpenRange();return;}closePP();setPMode(m);}
function ffxOpenRange(){
  const c=ffxCustomRange();
  $("modal-container").innerHTML=`<div class="modal-bg" onclick="showModal('close')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-handle"></div>
    <div class="flex-b mb12"><span class="fz16 fw7">Custom date range</span><button class="btn" style="padding:2px;color:var(--muted)" onclick="showModal('close')">&#10005;</button></div>
    <div class="grid2" style="gap:10px"><div><span class="edit-label">From</span><input class="inp" type="date" id="rngFrom" value="${toLocalISODate(c.start)}"></div><div><span class="edit-label">To</span><input class="inp" type="date" id="rngTo" value="${toLocalISODate(c.end)}"></div></div>
    <div class="ffx-hchips mt8">${[["Last 7 days",7],["Last 30 days",30],["Last 90 days",90],["Year to date","ytd"],["Last year","ly"]].map(([l,v])=>`<button class="ffx-hchip" onclick="ffxRangePreset('${v}')">${l}</button>`).join("")}</div>
    <div id="rngMsg" class="fz11 red mt8"></div>
    <button class="btn btn-p w100 mt12" style="justify-content:center;padding:13px" onclick="ffxApplyRange()">Apply</button></div></div>`;
}
function ffxRangePreset(v){
  const today=new Date();let a,b=toLocalISODate(today);
  if(v==="ytd")a=today.getFullYear()+"-01-01";
  else if(v==="ly"){a=(today.getFullYear()-1)+"-01-01";b=(today.getFullYear()-1)+"-12-31";}
  else a=ffxAddDays(b,-(Number(v)-1));
  $("rngFrom").value=a;$("rngTo").value=b;
}
function ffxApplyRange(){
  const a=$("rngFrom").value,b=$("rngTo").value;
  if(!FinanceCore.date(a)||!FinanceCore.date(b))return $("rngMsg").textContent="Pick both dates.";
  if(a>b)return $("rngMsg").textContent="The start date must be before the end date.";
  ffx.custom={from:a,to:b};ffxSave();pMode="custom";ppOpen=false;showModal("close");render();haptic("light");
}
function setMonthStart(d){
  d=Math.max(1,Math.min(28,Math.floor(Number(d))||1));ffx.monthStart=d;ffxSave();pDate=new Date();
  haptic("light");render();if(settingsOpen)renderSettings();
  showToast(d===1?"Months start on the 1st":"Months now run from the "+d+ffxOrd(d),"green");
}
const ffxOrd=n=>{const v=n%100;return["th","st","nd","rd"][(v-20)%10]||["th","st","nd","rd"][v]||"th";};
function ffxHeaderUpdate(){
  const t=$("hdrTitle"),sub=$("txCount"),per=$("hdrPeriod");if(!t||!sub||!per)return;
  const first=(profile.name||"").trim().split(/\s+/)[0];
  if(V==="dashboard"&&first){t.textContent=T("Hi")+", "+first;sub.textContent=new Date().toLocaleDateString("en-NG",{weekday:"long",day:"numeric",month:"short"});}
  else{t.textContent=FFX_PAGE_TITLES[V]?T(FFX_PAGE_TITLES[V]):"FinanceFlow";sub.textContent="FinanceFlow";}
  const show=["dashboard","stats","transactions","budgets"].includes(V)&&!(cmpMode&&(V==="stats"||V==="budgets"))&&!needsOnboarding();
  per.hidden=!show;if(!show)return;
  const mode=ffxEffMode(),isAll=mode==="all";
  const modes=[["week","Week"],["month","Month"],["quarter","Quarter"],["year","Year"]].concat(V==="budgets"?[]:[["all","All time"],["custom","Custom range…"]]);
  const nav=(dir,ch,lbl)=>isAll?`<span class="hp-nav" style="visibility:hidden"></span>`:`<button class="hp-nav" aria-label="${lbl}" onclick="navPeriod(${dir},event)">${ch}</button>`;
  per.innerHTML=nav(-1,"&#9664;","Previous period")+`<button class="hp-label" aria-haspopup="true" aria-expanded="${ppOpen}" onclick="togglePP(event)">${esc(ffxPeriodLabel(mode,pDate))} <span>${ppOpen?"&#9652;":"&#9662;"}</span></button>`+nav(1,"&#9654;","Next period")+(ppOpen?`<div class="pp-menu" onclick="event.stopPropagation()">${modes.map(([m,l])=>`<div class="pp-menu-item ${mode===m?"active":""}" onclick="ffxPickMode('${m}')"><span style="font-size:14px">${mode===m?"&#9679;":"&#9675;"}</span>${l}</div>`).join("")}</div>`:"");
}

function ffxOutsideHint(){
  if(ffxHist.allTime||!search||!search.trim())return"";
  const r=getRangeFor(pMode,pDate),q=search.toLowerCase();
  const hit=t=>(t.description||"").toLowerCase().includes(q)||(t.category||"").toLowerCase().includes(q)||(t.subcategory||"").toLowerCase().includes(q)||(t.tags||[]).some(x=>x.toLowerCase().includes(q));
  const n=txns.filter(t=>(t.date<r.startStr||t.date>r.endStr)&&hit(t)).length;
  return n?`<div class="ffx-hint">${n} more match${n===1?"":"es"} for “${esc(search)}” outside this period <button class="ffx-link" onclick="ffxHist.allTime=true;render()">Search all time</button></div>`:"";
}
function ffxMonthStartHTML(){
  const D=ffxMonthStart(),r=getRangeFor("month",new Date());
  return`<div class="card mb12"><div class="fz12 fw7 mb6">Month starts on</div><div class="fz10 muted mb8">If you're paid on the 25th, start your month on the 25th so budgets and reports follow your pay cycle.</div>
    <select class="inp" aria-label="Month start day" onchange="setMonthStart(this.value)">${Array.from({length:28},(_,i)=>i+1).map(d=>`<option value="${d}" ${d===D?"selected":""}>${d===1?"1st (calendar month)":d+ffxOrd(d)}</option>`).join("")}</select>
    <div class="fz10 muted mt6">Current period: <b>${ffxShortDate(r.start)} – ${ffxShortDate(r.end)}</b>. Trend charts on Home still use calendar months.</div></div>`;
}

// ════════════════ Budgets: pace, summary, unbudgeted spending, edit-in-place ════════════════
const ffxAlertWarn=()=>{const v=Number(ffx.prefs&&ffx.prefs.alertWarn);return v>=50&&v<=95?v:80;};
function setAlertWarn(v){ffx.prefs=ffx.prefs||{};ffx.prefs.alertWarn=Number(v);ffxSave();haptic("light");showToast("Budget alerts start at "+v+"%","green");}
function ffxBudgetPace(b,bp,date){
  const r=getRangeFor(bp,date),today=ffxToday(),total=ffxDaysBetween(r.startStr,r.endStr)+1;
  const cur=today>=r.startStr&&today<=r.endStr;
  const elapsed=today<r.startStr?0:today>r.endStr?total:ffxDaysBetween(r.startStr,today)+1;
  const eff=budgetEffLimit(b,bp,date),spent=budgetSpent(b,bp,date),frac=total?elapsed/total:0,spentFrac=eff>0?spent/eff:0;
  const over=eff>0&&spent>eff;
  const state=over?"over":cur&&(spentFrac>frac+0.10||(spentFrac>=0.95&&frac<1))?"ahead":"ok";
  const daysLeft=cur?total-elapsed+1:0;
  return{eff,spent,pct:eff>0?spent/eff*100:0,frac,state,cur,daysLeft,total,elapsed,perDay:cur&&eff>spent&&daysLeft>0?(eff-spent)/daysLeft:0,projected:cur&&elapsed>=3&&spent>0?spent/elapsed*total:null};
}
const ffxStateColor=(state,spent)=>state==="over"?"var(--red)":state==="ahead"?"var(--warn)":spent>0?"var(--green)":"var(--accent)";
// used by the Home budget list too: colour by pace, not by fixed 80% / 50% thresholds
function ffxBudgetColor(bp,date,pct,over){
  if(over)return"var(--red)";
  const r=getRangeFor(bp,date),today=ffxToday();if(today<r.startStr||today>r.endStr)return pct>0?"var(--green)":"var(--accent)";
  const total=ffxDaysBetween(r.startStr,r.endStr)+1,frac=(ffxDaysBetween(r.startStr,today)+1)/total;
  return pct/100>frac+0.10?"var(--warn)":pct>0?"var(--green)":"var(--accent)";
}
function ffxBudFilter(k){ffxState.budFilter=ffxState.budFilter===k?"":k;haptic("light");render();}
function ffxBudgetCard(x,i){
  const {b,P}=x,bp=b.period||"month",base=budgetBaseLimit(b),col=ffxStateColor(P.state,P.spent);
  const isRollup=!(b.limit>0)&&(b.subs||[]).reduce((s,y)=>s+(y.limit||0),0)>0,isE=exCats["b_"+b.id],hs=b.subs&&b.subs.length>0;
  const sub=hs&&isE?`<div class="exp-cat-subs" style="margin-top:10px;padding:8px 0 0 0;border-top:1px solid var(--border)">${b.subs.map(s=>{const ss=getSpent(bp,pDate,b.cat,s.name),sp=s.limit>0?ss/s.limit:0,so=s.limit>0&&ss>s.limit,st=so?"over":P.cur&&sp>P.frac+0.10?"ahead":"ok",sc=ffxStateColor(st,ss);return`<div class="mb8"><div class="flex-b fz10"><span class="muted">${esc(s.name)}</span><span><span style="color:${sc}">${fmtK(ss)}</span> / ${fmtK(s.limit)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,sp*100)}%;background:${sc}"></div></div></div>`;}).join("")}</div>`:"";
  const paceLine=!P.cur?"":P.state==="over"?`<span class="red fw7">▲ Over budget</span>`:P.state==="ahead"?`<span class="warn fw7">▲ Ahead of pace</span>${P.projected?` · on course for ${fmtK(P.projected)}`:""}`:`<span class="green fw7">✓ On pace</span>${P.perDay>0?` · ${fmtK(P.perDay)}/day for ${P.daysLeft} day${P.daysLeft===1?"":"s"}`:""}`;
  return`<div class="card anim-card ffx-bcard ${P.state}" style="animation-delay:${i*45}ms"><div class="flex-b" style="cursor:pointer" onclick="toggleCat('b_${b.id}')"><div class="flex g6" style="min-width:0"><div class="cat-dot" style="background:${clr(b.cat)}"></div><span class="fw7 fz13 ellip">${esc(b.cat)}</span><span class="rec-badge">${PERIOD_LABELS[bp]}</span>${b.rollover?`<span class="rec-badge" title="Carry starts ${esc(b.rolloverStart||"")}">&#8635;</span>`:""}<span class="fz10 muted">${hs?isE?"&#9650;":"&#9660;":""}</span></div><div class="flex g6"><button class="btn btn-g btn-sm" style="padding:4px 8px" onclick="event.stopPropagation();viewBudgetTx('${escJs(b.cat)}')" title="View transactions" aria-label="View ${esc(b.cat)} transactions">&#128269;</button><button class="ffx-limit" onclick="event.stopPropagation();ffxEditBudget('${escJs(b.id)}')" aria-label="Edit ${esc(b.cat)} budget">${base>0?fmt(P.eff):"Set limit"} ✎</button></div></div>
    ${base>0?`<div class="flex-b fz10 muted mt4 mb4"><span style="color:${col}">${fmt(P.spent)} spent</span><span>${Math.round(P.pct)}% · ${P.state==="over"?"Over "+fmtK(P.spent-P.eff):fmtK(P.eff-P.spent)+" left"}</span></div><div class="bar-track ffx-bt"><div class="bar-fill" style="width:${Math.min(100,P.pct)}%;background:${col};height:100%"></div>${P.cur&&P.frac<1?`<i class="ffx-tick" style="left:${P.frac*100}%" title="Where you'd be if spending were even"></i>`:""}</div>${paceLine?`<div class="fz10 mt6">${paceLine}</div>`:""}${isRollup?`<div class="fz9 muted mt4">Total of ${b.subs.length} subcategory limit${b.subs.length>1?"s":""} below</div>`:""}`:`<div class="fz10 muted mt4 mb4">${fmt(P.spent)} spent · no limit set</div>`}${sub}</div>`;
}
function ffxBudgetSummaryHTML(items){
  const act=items.filter(x=>x.P.eff>0);if(!act.length)return"";
  const limit=act.reduce((s,x)=>s+x.P.eff,0),spent=act.reduce((s,x)=>s+x.P.spent,0),left=limit-spent;
  const perDay=act.reduce((s,x)=>s+x.P.perDay,0),frac=act.reduce((s,x)=>s+x.P.eff*x.P.frac,0)/limit,pct=limit>0?spent/limit*100:0;
  const st=left<0?"over":pct/100>frac+0.10?"ahead":"ok",col=ffxStateColor(st,spent);
  const cnt={over:items.filter(x=>x.P.state==="over").length,ahead:items.filter(x=>x.P.state==="ahead").length,ok:items.filter(x=>x.P.state==="ok"&&x.P.eff>0).length};
  const f=ffxState.budFilter||"";
  const chip=(k,l,n,cls)=>`<button class="ffx-hchip ${f===k?"on":""} ${cls||""}" aria-pressed="${f===k}" onclick="ffxBudFilter('${k}')">${l} <i>${n}</i></button>`;
  return`<div class="card ffx-bsum ${st}"><div class="ffx-eyebrow">${left>=0?"Left across your budgets":"Over across your budgets"}</div>
    <div class="ffx-left ${left<0?"bad":st==="ahead"?"warn":"good"}">${fmt(Math.abs(left))}</div>
    <div class="fz11 muted">${left>=0&&perDay>0?`<b class="${st==="ahead"?"warn":"green"}">${fmtK(perDay)}/day</b> available · `:""}${st==="over"?"▲ over your plan":st==="ahead"?"▲ spending faster than planned":"✓ on pace"}</div>
    <div class="bar-track ffx-bt mt8"><div class="bar-fill" style="width:${Math.min(100,pct)}%;background:${col};height:100%"></div>${frac<1?`<i class="ffx-tick" style="left:${frac*100}%"></i>`:""}</div>
    <div class="flex-b fz10 muted mt4"><span>${fmtK(spent)} spent of ${fmtK(limit)}</span><span>${Math.round(pct)}% used</span></div>
    <div class="ffx-hchips" style="padding-top:10px">${chip("over","▲ Over",cnt.over,"bad")}${chip("ahead","⚠ Ahead of pace",cnt.ahead,"warnc")}${chip("ok","✓ On pace",cnt.ok)}</div></div>`;
}
function ffxQuickLimit(cat){
  const per=[ffxMonthRange(-1),ffxMonthRange(-2),ffxMonthRange(-3)];let tot=0,n=0;
  per.forEach(p=>{const v=txns.filter(t=>t.type==="expense"&&t.category===cat&&t.date>=p.start&&t.date<=p.end).reduce((s,t)=>s+ffxPA(t),0);if(v>0){tot+=v;n++;}});
  const r=getRangeFor("month",pDate),cur=txns.filter(t=>t.type==="expense"&&t.category===cat&&t.date>=r.startStr&&t.date<=r.endStr).reduce((s,t)=>s+ffxPA(t),0);
  const avg=n?tot/n:cur*1.1;if(!(avg>0))return 0;const step=avg<10000?1000:avg<100000?5000:10000;return Math.ceil(avg/step)*step;
}
function ffxSuggestBudgets(){
  const EC=getEC(),have=new Set(budgets.map(b=>b.cat)),cats=[...new Set(txns.filter(t=>t.type==="expense"&&Object.hasOwn(EC,t.category)).map(t=>t.category))].filter(c=>!have.has(c));
  const rows=cats.map(c=>[c,ffxQuickLimit(c)]).filter(([,l])=>l>0).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if(!rows.length)return showToast("No spending history to base budgets on yet","warn");
  if(!confirm("Create "+rows.length+" monthly budget"+(rows.length>1?"s":"")+" from your recent average spending?\n\n"+rows.map(([c,l])=>c+": "+fmt(l)).join("\n")))return;
  rows.forEach(([c,l])=>budgets.push({id:uid(),cat:c,limit:l,period:"month",subs:[]}));save();render();haptic("success");showToast("🎯 "+rows.length+" budgets created","green");
}
function ffxUnbudgetedHTML(){
  const mode=["week","month","quarter","year"].includes(pMode)?pMode:"month",r=getRangeFor(mode,pDate),have=new Set(budgets.map(b=>b.cat));
  const spent={};let total=0,unb=0;
  txns.filter(t=>t.type==="expense"&&t.date>=r.startStr&&t.date<=r.endStr).forEach(t=>{const v=ffxPA(t);total+=v;if(!have.has(t.category)){spent[t.category]=(spent[t.category]||0)+v;unb+=v;}});
  const rows=Object.entries(spent).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(!rows.length)return budgets.length&&total>0?`<div class="fz10 muted tac mt8">✓ Every category you spent in has a budget.</div>`:"";
  return`<div class="card"><div class="flex-b mb4"><span class="fz12 fw7">Spending without a budget</span><span class="fz11 fw7">${fmt(unb)}</span></div><div class="fz10 muted mb8">${total>0?Math.round(unb/total*100):0}% of this period's spending isn't covered by a budget.</div>
    ${rows.map(([c,v])=>`<div class="ffx-row"><div class="flex g8" style="min-width:0"><span class="cat-dot" style="background:${clr(c)}"></span><div style="min-width:0"><div class="fz12 fw6 ellip">${catIcon(c)} ${esc(c)}</div><div class="fz10 muted">${fmt(v)}</div></div></div><button class="btn btn-sm btn-g" onclick="ffxEditBudget(null,'${escJs(c)}')">Set budget</button></div>`).join("")}
    <button class="btn btn-g w100 mt8" style="justify-content:center" onclick="ffxSuggestBudgets()">✨ Create budgets from my average spending</button></div>`;
}
function ffxBudgetsBodyHTML(){
  if(!budgets.length)return`<div class="card tac" style="padding:28px"><div style="font-size:32px;margin-bottom:8px">&#127919;</div><div class="fz13 fw6 mb4">No budgets yet</div><div class="fz11 muted mb12">Set spending limits to stay on track</div><div class="flex g6" style="justify-content:center"><button class="btn btn-p btn-sm" onclick="toggleBudgetManage()">+ Create Budget</button><button class="btn btn-g btn-sm" onclick="ffxSuggestBudgets()">✨ Suggest from my spending</button></div></div>`+ffxUnbudgetedHTML();
  const items=budgets.map(b=>({b,P:ffxBudgetPace(b,b.period||"month",pDate)}));
  const f=ffxState.budFilter||"",shown=f?items.filter(x=>x.P.eff>0&&x.P.state===f):items;
  return ffxBudgetSummaryHTML(items)+(shown.length?shown.map((x,i)=>ffxBudgetCard(x,i)).join(""):`<div class="empty-state mb12"><div class="fz12 fw7">No budgets match</div><button class="btn btn-g btn-sm mt8" onclick="ffxBudFilter('${f}')">Show all</button></div>`)+ffxUnbudgetedHTML();
}
function ffxEditBudget(id,newCat){
  const b=id?budgets.find(x=>x.id===id):null;if(id&&!b)return;
  const cat=b?b.cat:newCat,rollup=!!b&&!(b.limit>0)&&(b.subs||[]).length>0,sug=b?0:ffxQuickLimit(cat);
  window._ebId=id||null;window._ebCat=cat;
  $("modal-container").innerHTML=`<div class="modal-bg" onclick="showModal('close')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-handle"></div>
    <div class="flex-b mb12"><span class="fz16 fw7">${b?"Edit":"New"} budget · ${esc(cat)}</span><button class="btn" style="padding:2px;color:var(--muted)" onclick="showModal('close')">&#10005;</button></div>
    ${rollup?`<div class="msg msg-ok fz11 mb8" style="display:block">This budget's limit is the sum of its subcategory limits. Change those under “Subcategories & more”.</div>`:""}
    <span class="edit-label">Limit (${esc(currency.symbol)})</span><input class="inp mb8" id="ebLim" inputmode="decimal" ${rollup?"disabled":""} value="${b&&b.limit>0?esc(b.limit):sug||""}" placeholder="e.g. 50,000">
    ${sug?`<div class="fz10 accent mb8">✨ Suggested from your recent spending</div>`:""}
    <span class="edit-label">Resets</span><select class="inp mb8" id="ebPer">${Object.entries(PERIOD_LABELS).map(([k,v])=>`<option value="${k}" ${(b?b.period||"month":"month")===k?"selected":""}>${v}</option>`).join("")}</select>
    <label class="flex g6 fz12 mb12"><input type="checkbox" id="ebRoll" ${b&&b.rollover?"checked":""}> Carry unspent (or overspent) money into the next period</label>
    <button class="btn btn-p w100" style="justify-content:center;padding:13px" onclick="ffxSaveBudget()">Save</button>
    <div class="flex g6 mt8">${b?`<button class="btn btn-g" style="flex:1;justify-content:center" onclick="showModal('close');budgetManageOpen=true;expandedBudget='${escJs(b.id)}';render()">Subcategories & more</button><button class="btn btn-rd" onclick="showModal('close');deleteBudget('${escJs(b.id)}')">Delete</button>`:""}</div></div></div>`;
  setTimeout(()=>{const i=$("ebLim");if(i&&!i.disabled)i.focus();},250);
}
function ffxSaveBudget(){
  const id=window._ebId,cat=window._ebCat,per=$("ebPer").value,roll=$("ebRoll").checked,raw=$("ebLim");
  let b=id?budgets.find(x=>x.id===id):null;
  const lim=raw.disabled?(b?b.limit:0):parseAmount(raw.value);
  if(!raw.disabled&&!(lim>0))return alert("Enter a limit above zero");
  if(b){
    const before=JSON.stringify([b.limit,b.period,b.rollover]);
    if(!raw.disabled)b.limit=lim;b.period=per;b.rollover=roll;
    if(before!==JSON.stringify([b.limit,b.period,b.rollover])){b.rolloverStart=getRangeFor(per,new Date()).startStr;b.rolloverPeriod=per;}
  }else{
    if(budgets.some(x=>x.cat===cat))return alert("A budget for this category already exists");
    b={id:uid(),cat,limit:lim,period:per,rollover:roll,subs:[]};if(roll){b.rolloverStart=getRangeFor(per,new Date()).startStr;b.rolloverPeriod=per;}budgets.push(b);
  }
  save();showModal("close");render();haptic("success");showToast("🎯 Budget saved","green");
}

function ffxBudgetAlertHTML(){
  return`<div class="card mb12"><div class="fz12 fw7 mb6">Budget alerts</div><div class="fz10 muted mb8">Get a warning when a budget reaches this share of its limit. You always get one when it's exceeded.</div>
    <select class="inp" aria-label="Budget alert threshold" onchange="setAlertWarn(this.value)">${[50,60,70,75,80,85,90,95].map(v=>`<option value="${v}" ${ffxAlertWarn()===v?"selected":""}>${v}% of the limit</option>`).join("")}</select></div>`;
}

function ffxBudgetPill(cat){
  if(typeof statsType==="undefined"||statsType!=="expense")return"";
  const b=budgets.find(x=>x.cat===cat&&budgetBaseLimit(x)>0);if(!b)return"";
  const P=ffxBudgetPace(b,b.period||"month",pDate);return`<span class="ffx-bpill ${P.state}">${Math.round(P.pct)}% of budget</span>`;
}
function ffxCashFlowHTML(type,d){
  if(type!=="expense"&&type!=="income")return"";
  const r=d.r,inc=txns.filter(t=>t.type==="income"&&t.date>=r.startStr&&t.date<=r.endStr).reduce((s,t)=>s+ffxPA(t),0);
  const expList=txns.filter(t=>t.type==="expense"&&t.date>=r.startStr&&t.date<=r.endStr),exp=expList.reduce((s,t)=>s+ffxPA(t),0);
  if(!(inc>0)&&!(exp>0))return"";
  const cats={};expList.forEach(t=>cats[t.category]=(cats[t.category]||0)+ffxPA(t));
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5),topSum=top.reduce((s,x)=>s+x[1],0),other=exp-topSum,saved=inc-exp;
  const base=Math.max(inc,exp,1);
  const seg=top.map(([c,v])=>({l:c,v,c:clr(c)}));if(other>0.5)seg.push({l:"Other spending",v:other,c:"var(--muted)"});if(saved>0)seg.push({l:"Saved",v:saved,c:"var(--green)"});
  return`<div class="card"><div class="flex-b mb4"><span class="fz12 fw7">Where your income went</span><span class="fz10 muted">${fmtK(inc)} in · ${fmtK(exp)} out</span></div>
    <div class="ffx-flow mb10" role="img" aria-label="Income split into spending and savings">${seg.map(x=>`<div style="flex:${x.v/base};background:${x.c}" title="${esc(x.l)}"></div>`).join("")}</div>
    ${seg.map(x=>`<div class="ffx-row" style="padding:6px 0"><span class="fz11"><span class="cat-dot" style="display:inline-block;background:${x.c};margin-right:6px"></span>${esc(x.l)}</span><span class="fz11 fw7">${fmtK(x.v)} <span class="muted fw6">· ${base>0?Math.round(x.v/(inc>0?inc:exp)*100):0}%</span></span></div>`).join("")}
    ${saved<0?`<div class="fz11 red fw7 mt6">▲ You spent ${fmt(-saved)} more than you earned in this period.</div>`:inc>0?`<div class="fz11 green fw7 mt6">✓ You kept ${Math.round(saved/inc*100)}% of your income.</div>`:""}</div>`;
}
function ffxBudgetCheckHTML(type){
  if(type!=="expense"||!budgets.length)return"";
  const rows=budgets.filter(b=>budgetBaseLimit(b)>0).map(b=>({b,P:ffxBudgetPace(b,b.period||"month",pDate)})).sort((a,b)=>b.P.pct-a.P.pct).slice(0,5);
  if(!rows.length)return"";
  return`<div class="card"><div class="flex-b mb8"><span class="fz12 fw7">Against your budgets</span><button class="ffx-link" onclick="goTo('budgets')">All budgets ›</button></div>${rows.map(({b,P})=>{const col=ffxStateColor(P.state,P.spent);return`<button class="ffx-prow" onclick="goTo('budgets')"><div class="flex-b"><span class="fz12 fw6 ellip">${esc(b.cat)}</span><span class="fz11 fw7" style="color:${col}">${Math.round(P.pct)}%</span></div><div class="bar-track ffx-bt mt4"><div class="bar-fill" style="width:${Math.min(100,P.pct)}%;background:${col};height:100%"></div>${P.cur&&P.frac<1?`<i class="ffx-tick" style="left:${P.frac*100}%"></i>`:""}</div><div class="fz9 muted mt4">${fmtK(P.spent)} of ${fmtK(P.eff)}${P.state==="over"?" · over budget":""}</div></button>`;}).join("")}</div>`;
}
function ffxSetStatsBy(k){ffxState.statsBy=k;haptic("light");render();}
function ffxBreakdownHTML(type,d){
  const by=ffxState.statsBy||"account",isExp=type==="expense",m={};
  d.list.forEach(t=>{const v=ffxPA(t);if(by==="account"){const k=accName(t.accountId)||"Unknown";m[k]=(m[k]||0)+v;}else{const tg=t.tags&&t.tags.length?t.tags:["(no tag)"];tg.forEach(x=>m[x]=(m[x]||0)+v);}});
  const rows=Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,8),max=rows[0]?rows[0][1]:1;
  return`<div class="card"><div class="flex-b mb8"><span class="fz12 fw7">Breakdown by</span><div class="tab-row" style="width:160px"><button class="tab-btn ${by==="account"?"active":""}" onclick="ffxSetStatsBy('account')">Account</button><button class="tab-btn ${by==="tag"?"active":""}" onclick="ffxSetStatsBy('tag')">Tag</button></div></div>
    ${rows.length?rows.map(([k,v])=>`<div class="ffx-prow" style="cursor:default"><div class="flex-b"><span class="fz12 fw6 ellip">${esc(k)}</span><span class="fz12 fw7">${fmt(v)}</span></div><div class="bar-track mt4"><div class="bar-fill" style="width:${v/max*100}%;background:${isExp?"var(--red)":"var(--green)"};opacity:.7"></div></div></div>`).join(""):`<div class="fz11 muted">Nothing to show.</div>`}${by==="tag"?`<div class="fz9 muted mt6">An entry with several tags counts under each one.</div>`:""}</div>`;
}
function ffxExportStatsCsv(){
  const type=statsType,d=ffxStatsData(type,pMode,pDate),m={};
  d.list.forEach(t=>{const k=(t.category||"")+"\u0001"+(t.subcategory||"");const o=m[k]=m[k]||{c:t.category||"",s:t.subcategory||"",total:0,n:0};o.total+=ffxPA(t);o.n++;});
  const q=v=>{let s=String(v??"");if(/^[=+\-@\t\r]/.test(s)&&isNaN(Number(s)))s="'"+s;return'"'+s.replace(/"/g,'""')+'"';};
  const rows=[["Category","Subcategory","Total ("+currency.code+")","Entries","Share %"],...Object.values(m).sort((a,b)=>b.total-a.total).map(o=>[o.c,o.s,o.total.toFixed(2),o.n,d.total>0?(o.total/d.total*100).toFixed(1):"0"])];
  saveOrDownload("financeflow-"+type+"-"+ffxPeriodLabel(pMode,pDate).replace(/[^a-z0-9]+/gi,"-").toLowerCase()+".csv",rows.map(r=>r.map(q).join(",")).join("\n"),"text/csv");
}

// ── History: grouping, saved filters, new-since-visit, duplicates, bulk tags ──
function ffxGroupKey(t){
  if(ffxHist.group==="week"){const d=FinanceCore.date(t.date);return d?getRangeFor("week",d).startStr:t.date;}
  if(ffxHist.group==="cat")return t.type==="transfer"?"Transfers":(t.category||"Uncategorised");
  return t.date;
}
function ffxGroupOrder(keys,groups){
  if(ffxHist.group==="cat"){const tot=k=>groups[k].reduce((s,t)=>s+(t.type==="transfer"?0:ffxPA(t)),0);return keys.sort((a,b)=>tot(b)-tot(a));}
  return keys.sort((a,b)=>ffxHist.sort==="old"?a.localeCompare(b):b.localeCompare(a));
}
function ffxGroupLabel(k){
  if(ffxHist.group==="week"){const d=FinanceCore.date(k);return d?"Week of "+ffxShortDate(d):k;}
  if(ffxHist.group==="cat")return(k==="Transfers"?"⇄ ":catIcon(k)+" ")+k;
  return fmtD(k);
}
function ffxSaveFilter(){
  const name=prompt("Name this filter",fCat!=="all"?fCat:search||"My filter");if(!name||!name.trim())return;
  ffx.savedFilters=ffx.savedFilters||[];
  ffx.savedFilters.push({id:uid(),name:name.trim().slice(0,20),type:fType,cat:fCat,acc:fAcc,search,min:ffxHist.min,max:ffxHist.max,flag:ffxHist.flag,sort:ffxHist.sort,group:ffxHist.group,allTime:ffxHist.allTime});
  if(ffx.savedFilters.length>10)ffx.savedFilters.shift();
  save();haptic("success");showToast("★ Filter saved","green");render();
}
function ffxApplySaved(id){
  const f=(ffx.savedFilters||[]).find(x=>x.id===id);if(!f)return;
  fType=f.type||"all";fCat=f.cat||"all";fAcc=f.acc||"all";search=f.search||"";
  Object.assign(ffxHist,{min:f.min||"",max:f.max||"",flag:f.flag||"",sort:f.sort||"new",group:f.group||"day",allTime:!!f.allTime});
  haptic("light");render();
}
function ffxManageSaved(){
  $("modal-container").innerHTML=`<div class="modal-bg" onclick="showModal('close')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-handle"></div><div class="flex-b mb12"><span class="fz16 fw7">Saved filters</span><button class="btn" style="padding:2px;color:var(--muted)" onclick="showModal('close')">&#10005;</button></div>
    ${(ffx.savedFilters||[]).map(sf=>`<div class="ffx-row"><span class="fz13 fw6">★ ${esc(sf.name)}</span><button class="btn btn-rd btn-sm" onclick="ffxDeleteSaved('${escJs(sf.id)}')">Delete</button></div>`).join("")||'<div class="fz11 muted">None yet.</div>'}</div></div>`;
}
function ffxDeleteSaved(id){ffx.savedFilters=(ffx.savedFilters||[]).filter(x=>x.id!==id);save();showModal("close");render();}
function ffxCreatedAt(t){const m=/^([0-9a-z]{8})[0-9a-z]{5}$/.exec(String(t.id||""));if(!m)return 0;const v=parseInt(m[1],36);return v>1.5e12&&v<4.2e12?v:0;}
const ffxIsNew=t=>ffxSince>0&&(t.needsReview||t.source||t.bankAlertId)&&ffxCreatedAt(t)>ffxSince;
function ffxInitVisit(){
  try{ffxSince=Number(appStorage.getItem("ffd_lastseen"))||0;}catch(e){}
  const stamp=()=>{try{appStorage.setItem("ffd_lastseen",String(Date.now()));}catch(e){}};
  if(!ffxSince)stamp();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){stamp();ffxHiddenAt=Date.now();}});
  window.addEventListener("pagehide",()=>{stamp();ffxHiddenAt=Date.now();});
  window.ffxOnPause=()=>{stamp();ffxHiddenAt=Date.now();};
}
function ffxDupIds(){
  if(ffxDupMemo)return ffxDupMemo;
  const ids=new Set(),by={};
  txns.forEach(t=>{if(t.type==="transfer"||t.dupOk||t.splitGroupId||t.occurrenceKey)return;const k=t.accountId+"|"+t.type+"|"+Number(t.amount).toFixed(2);(by[k]=by[k]||[]).push(t);});
  for(const list of Object.values(by)){
    if(list.length<2)continue;list.sort((a,b)=>a.date.localeCompare(b.date));
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      if(ffxDaysBetween(list[i].date,list[j].date)>1)break;
      const a=ffxNormDesc(list[i].description),b=ffxNormDesc(list[j].description);
      if(!a||!b||a===b||(a.length>=4&&b.includes(a))||(b.length>=4&&a.includes(b))){ids.add(list[i].id);ids.add(list[j].id);}
    }
  }
  return ffxDupMemo=ids;
}
function ffxDupDismissAll(){const ids=ffxDupIds();txns.forEach(t=>{if(ids.has(t.id))t.dupOk=true;});ffxHist.flag="";save();render();showToast("Marked as not duplicates","green");}
function ffxSelectAllShown(){if(selectedTxIds.size){selectedTxIds=new Set();}else getF().forEach(t=>selectedTxIds.add(t.id));render();}
function ffxBulkTagsHTML(){
  const tags=[...new Set([...(userTags||[]),...txns.flatMap(t=>t.tags||[])])].sort();
  const opts=`<option value="">—</option>${tags.map(t=>`<option>${esc(t)}</option>`).join("")}`;
  return`<div><div class="fz12 fw6 mb8">Tags (optional)</div><div class="grid2" style="gap:8px"><div><span class="edit-label">Add tag</span><input class="inp" id="bulkTagAdd" list="bulkTagList" placeholder="e.g. work"><datalist id="bulkTagList">${tags.map(t=>`<option value="${esc(t)}">`).join("")}</datalist></div><div><span class="edit-label">Remove tag</span><select class="inp" id="bulkTagRemove">${opts}</select></div></div></div>`;
}

// ── Projects: linked funding, milestones, templates, report, receipts ──
const FFX_PROJ_TPL={
  reno:{label:"🏠 Renovation",name:"Home renovation",desc:"Materials, labour and finishing",ms:["Plan & get quotes","Buy materials","Main work","Finishing","Final payment"]},
  wedding:{label:"💍 Wedding",name:"Wedding",desc:"Venue, attire, catering and logistics",ms:["Set date & budget","Book venue","Attire","Catering","Wedding day"]},
  trip:{label:"✈️ Trip",name:"Trip",desc:"Travel, stay and spending money",ms:["Book flights","Book stay","Visa & documents","Spending money","Travel day"]},
  event:{label:"🎉 Event",name:"Event",desc:"Planning an event or party",ms:["Plan & budget","Book venue","Invite guests","Catering & drinks","Event day"]},
  school:{label:"🎓 School fees",name:"School fees",desc:"Tuition, books and uniforms",ms:["Pay tuition","Books & uniforms","Transport"]},
  biz:{label:"💼 Business",name:"Business project",desc:"Startup costs and operations",ms:["Registration","Equipment","Marketing","Launch"]}
};
function ffxProjTemplateChips(){
  if(!$("projectName"))window._ffxProjTpl=null;
  return`<div class="fz10 muted mb6">Start from a template (optional)</div><div class="ffx-tplrow">${Object.entries(FFX_PROJ_TPL).map(([k,t])=>`<button type="button" class="ffx-hchip ${window._ffxProjTpl===k?"on":""}" onclick="ffxProjTemplate('${k}')">${t.label}</button>`).join("")}</div>`;
}
function ffxProjTemplate(k){
  const t=FFX_PROJ_TPL[k];if(!t)return;window._ffxProjTpl=k;
  const n=$("projectName"),d=$("projectDescription");if(n&&!n.value.trim())n.value=t.name;if(d&&!d.value.trim())d.value=t.desc;
  document.querySelectorAll(".ffx-tplrow .ffx-hchip").forEach(b=>b.classList.toggle("on",b.textContent.trim()===t.label));haptic("light");
}
function ffxProjectCreated(project){
  const k=window._ffxProjTpl;window._ffxProjTpl=null;const t=FFX_PROJ_TPL[k];if(!t)return;
  const a=FinanceCore.date(project.startDate),b=FinanceCore.date(project.expectedEndDate);
  ffx.milestones=ffx.milestones||[];
  t.ms.forEach((title,i)=>{let due="";if(a&&b&&b>a){const span=ffxDaysBetween(project.startDate,project.expectedEndDate);due=ffxAddDays(project.startDate,Math.round(span*(i+1)/t.ms.length));}ffx.milestones.push({id:uid(),projectId:project.id,title,due,done:false});});
}
const ffxLinkedFunding=pid=>txns.filter(t=>t.projectId===pid&&t.type==="income").reduce((s,t)=>s+ffxPA(t),0);
function ffxAddProjectFunding(id){
  const p=projects.find(x=>x.id===id);if(!p)return;
  showModal("addtx");window._ffxFund=id;if(typeof setTT==="function")setTT("income");
  const body=document.querySelector(".entry-modal .entry-body");
  if(body&&!$("fundNote")){const n=document.createElement("div");n.id="fundNote";n.className="msg msg-ok fz11";n.style.display="block";n.textContent="💰 This income will count as funding for “"+p.name+"”.";body.parentElement.insertBefore(n,body);}
}
function ffxProjectFundingHTML(p){
  const list=txns.filter(t=>t.projectId===p.id&&t.type==="income").sort((a,b)=>b.date.localeCompare(a.date)),typed=Number(p.fundedAmount)||0,linked=list.reduce((s,t)=>s+ffxPA(t),0);
  if(!list.length&&!typed)return"";
  return`<div class="fz11 fw7 mb6 mt12">Funding received</div><div class="fz10 muted mb6">${typed?`${fmt(typed)} entered on the project`:""}${typed&&linked?" + ":""}${linked?`${fmt(linked)} from linked income`:""}</div>${list.slice(0,4).map(t=>`<div class="ffx-row" style="padding:6px 0;cursor:pointer" onclick="showModal('edit','${escJs(t.id)}')"><span class="fz11">${fmtD(t.date)} · ${esc(t.description||"Funding")}</span><span class="fz11 fw7 green">+${fmtTxn(t)}</span></div>`).join("")}`;
}
// milestones
function ffxMilestonesFor(pid){return(ffx.milestones||[]).filter(m=>m.projectId===pid);}
function addMilestone(pid){
  const t=($("msTitle")?.value||"").trim(),due=$("msDue")?.value||"";
  if(!t)return alert("Give the milestone a name");if(due&&!FinanceCore.date(due))return alert("Pick a valid due date");
  ffx.milestones=ffx.milestones||[];ffx.milestones.push({id:uid(),projectId:pid,title:t.slice(0,60),due,done:false});save();haptic("light");render();
}
function toggleMilestone(id){const m=(ffx.milestones||[]).find(x=>x.id===id);if(!m)return;m.done=!m.done;m.doneAt=m.done?ffxToday():"";save();haptic(m.done?"success":"light");render();}
function deleteMilestone(id){const i=(ffx.milestones||[]).findIndex(x=>x.id===id);if(i<0)return;const m=ffx.milestones[i];ffx.milestones.splice(i,1);save();render();showUndoToast("Milestone removed",()=>{ffx.milestones.splice(i,0,m);save();});}
function ffxProjectMilestonesHTML(p){
  const list=ffxMilestonesFor(p.id).sort((a,b)=>(a.done-b.done)||(a.due||"9").localeCompare(b.due||"9")),done=list.filter(m=>m.done).length,today=ffxToday();
  return`<div class="flex-b mb6 mt12"><span class="fz11 fw7">Milestones</span><span class="fz10 muted">${list.length?done+" of "+list.length+" done":"Track the steps"}</span></div>
    ${list.length?`<div class="bar-track mb6"><div class="bar-fill" style="width:${done/list.length*100}%;background:var(--green)"></div></div>`:""}
    ${list.map(m=>{const od=!m.done&&m.due&&m.due<today;return`<div class="ffx-ms ${m.done?"done":""}"><button class="ffx-ms-box" aria-label="${m.done?"Mark not done":"Mark done"}" onclick="toggleMilestone('${escJs(m.id)}')">${m.done?"✓":""}</button><div style="flex:1;min-width:0"><div class="fz12 fw6 ffx-ms-t ellip">${esc(m.title)}</div>${m.due?`<div class="fz9 ${od?"red fw7":"muted"}">${od?"Overdue · ":"Due "}${fmtD(m.due)}</div>`:""}</div><button class="btn btn-g btn-sm" style="padding:2px 8px" aria-label="Delete milestone" onclick="deleteMilestone('${escJs(m.id)}')">✕</button></div>`;}).join("")}
    <div class="grid2 mt6" style="gap:6px;grid-template-columns:1fr 120px"><input class="inp" id="msTitle" placeholder="Add a milestone…" style="font-size:12px"><input class="inp" id="msDue" type="date" style="font-size:12px"></div><button class="btn btn-g btn-sm mt6" onclick="addMilestone('${escJs(p.id)}')">+ Add milestone</button>`;
}
function ffxScanProjects(){
  const today=ffxToday(),soon=ffxAddDays(today,2);
  (ffx.milestones||[]).forEach(m=>{
    if(m.done||!m.due||m.due>soon)return;const p=projects.find(x=>x.id===m.projectId);if(!p||p.status!=="active")return;
    pushNotif(`ms:${m.id}:${m.due<today?"od":m.due}`,"project",(m.due<today?"Overdue: ":"Due soon: ")+m.title,`${p.name} · ${m.due<today?"was due ":"due "}${fmtD(m.due)}`,"projects");
  });
}
// receipts gallery
const FFX_IMG_OK=/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+\/=]+$/;
function ffxProjectReceiptsHTML(p){
  const list=txns.filter(t=>t.projectId===p.id&&t.receipt&&FFX_IMG_OK.test(t.receipt)).sort((a,b)=>b.date.localeCompare(a.date));
  if(!list.length)return"";
  return`<div class="fz11 fw7 mb4 mt12">Receipts (${list.length})</div><div class="ffx-thumbs">${list.slice(0,20).map(t=>`<img alt="Receipt: ${esc(t.description||t.category)}" src="${t.receipt}" onclick="ffxShowReceipt('${escJs(t.id)}')">`).join("")}</div>`;
}
function ffxShowReceipt(id){
  const t=txns.find(x=>x.id===id);if(!t||!FFX_IMG_OK.test(t.receipt||""))return;
  $("modal-container").innerHTML=`<div class="modal-bg" onclick="showModal('close')" style="align-items:center"><div onclick="event.stopPropagation()" style="max-width:92%;max-height:88%;overflow:auto;background:var(--card);border-radius:16px;padding:10px"><img alt="Receipt" src="${t.receipt}" style="max-width:100%;border-radius:10px;display:block"><div class="flex-b mt8"><span class="fz11 muted">${fmtD(t.date)} · ${esc(t.description||t.category)} · ${fmtTxn(t)}</span><button class="btn btn-g btn-sm" onclick="showModal('close')">Close</button></div></div></div>`;
}
// report
function ffxProjectNumbers(p){const s=ffxProjStats(p),funded=(Number(p.fundedAmount)||0)+ffxLinkedFunding(p.id);return{...s,funded,balance:funded-s.spent-s.committed,remaining:s.budget-s.spent-s.committed};}
function ffxProjectReportText(p){
  const n=ffxProjectNumbers(p),cats={};n.ex.forEach(t=>cats[t.category]=(cats[t.category]||0)+ffxPA(t));
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5),ms=ffxMilestonesFor(p.id),done=ms.filter(m=>m.done).length;
  return[`📋 ${p.name} — project report`,`${projectStatusLabel(p.status)} · started ${p.startDate}${p.expectedEndDate?" · due "+p.expectedEndDate:""}`,"",
    `Budget: ${fmt(n.budget)}`,`Funding received: ${fmt(n.funded)}`,`Spent: ${fmt(n.spent)}`,`Committed: ${fmt(n.committed)}`,`Balance: ${fmt(n.balance)}`,`Budget remaining: ${fmt(n.remaining)}`,
    ...(top.length?["","Where it went:",...top.map(([c,v])=>`• ${c}: ${fmt(v)}`)]:[]),
    ...(ms.length?["",`Milestones: ${done}/${ms.length} done`,...ms.map(m=>`${m.done?"✅":"⬜"} ${m.title}${m.due?" (due "+m.due+")":""}`)]:[]),"","Made with FinanceFlow"].join("\n");
}
function ffxShareProjectReport(id){const p=projects.find(x=>x.id===id);if(p)ffxShareText(ffxProjectReportText(p));}
function ffxExportProjectCsv(id){
  const p=projects.find(x=>x.id===id);if(!p)return;
  const q=v=>{let s=String(v??"");if(/^[=+\-@\t\r]/.test(s)&&isNaN(Number(s)))s="'"+s;return'"'+s.replace(/"/g,'""')+'"';};
  const rows=[["Type","Date","Description","Category","Account","Amount","Status"]];
  txns.filter(t=>t.projectId===id).sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.type==="income"?"Funding":"Expense",t.date,t.description||"",t.category||"",accName(t.accountId),t.amount,""]));
  commitments.filter(c=>c.projectId===id).forEach(c=>rows.push(["Commitment",c.dueDate||"",c.description,"","",c.amount,c.status]));
  ffxMilestonesFor(id).forEach(m=>rows.push(["Milestone",m.due||"",m.title,"","","",m.done?"done":"open"]));
  saveOrDownload("project-"+p.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase()+".csv",rows.map(r=>r.map(q).join(",")).join("\n"),"text/csv");
}
function ffxProjectPeriodSelect(p){
  const start=(FinanceCore.date(p.startDate)?p.startDate:ffxToday()).slice(0,7),now=ffxToday().slice(0,7),months=[];
  let [y,m]=now.split("-").map(Number);for(let i=0;i<60;i++){const k=y+"-"+String(m).padStart(2,"0");months.push(k);if(k<=start)break;m--;if(m<1){m=12;y--;}}
  if(projectPeriod!=="all"&&!months.includes(projectPeriod))months.unshift(projectPeriod);
  return`<select class="inp" aria-label="Report period" onchange="projectPeriod=this.value;render()"><option value="all" ${projectPeriod==="all"?"selected":""}>All time</option>${months.map(k=>`<option value="${k}" ${projectPeriod===k?"selected":""}>${MO[Number(k.slice(5,7))-1]} ${k.slice(0,4)}</option>`).join("")}</select>`;
}

// ════════════════ Settings: formats, reminders, lock grace, backup reminders, import ════════════════
const ffxPref=(k,d)=>{const v=ffx.prefs&&ffx.prefs[k];return v===undefined||v===null?d:v;};
function ffxSetPref(k,v){ffx.prefs=ffx.prefs||{};ffx.prefs[k]=v;ffxSave();}
const ffxWeekStart=()=>({mon:1,sun:0,sat:6}[ffxPref("weekStart","mon")]??1);
function ffxCalHeader(){const n=["S","M","T","W","T","F","S"],w=ffxWeekStart();return Array.from({length:7},(_,i)=>`<div>${n[(w+i)%7]}</div>`).join("");}
const ffxNumLocale=l=>({us:"en-US",eu:"de-DE",fr:"fr-FR"}[ffxPref("numFmt","")]||l);
const ffxBillLead=()=>{const v=Number(ffxPref("billLead",3));return v>=1&&v<=14?v:3;};
const ffxBackupDays=()=>{const v=Number(ffxPref("backupDays",30));return v>=0&&v<=365?v:30;};
let ffxHiddenAt=0;
function ffxLockGraceActive(){const g=Number(ffxPref("lockGrace",0));return g>0&&ffxHiddenAt>0&&Date.now()-ffxHiddenAt<g*60000;}
function ffxPrefChanged(k,v){ffxSetPref(k,v);haptic("light");if(k==="weekStart"||k==="numFmt")render();if(settingsOpen)renderSettings();if(k==="billLead"&&remindersEnabled)syncUpcomingBills();}
const ffxSel=(label,sub,key,opts,cur)=>`<div class="mb10"><div class="fz12 fw6">${label}</div>${sub?`<div class="fz10 muted mb6 mt4">${sub}</div>`:""}<select class="inp" aria-label="${esc(label)}" onchange="ffxPrefChanged('${key}',this.value)">${opts.map(([v,l])=>`<option value="${v}" ${String(cur)===String(v)?"selected":""}>${l}</option>`).join("")}</select></div>`;
function ffxFormatsHTML(){
  const defAcc=ffxPref("defaultAcc","");
  return`<div class="card mb12"><div class="fz12 fw7 mb10">Formats & defaults</div>
    ${ffxSel("First day of the week","Weeks, the History calendar and weekly budgets start on this day.","weekStart",[["mon","Monday"],["sun","Sunday"],["sat","Saturday"]],ffxPref("weekStart","mon"))}
    ${ffxSel("Number format","How amounts are written.","numFmt",[["","Default for your currency"],["us","1,234.56"],["eu","1.234,56"],["fr","1 234,56"]],ffxPref("numFmt",""))}
    ${ffxSel("Default account for new entries","Pre-selected in the Add sheet. Otherwise it uses the account you used last.","defaultAcc",[["","Last used"],...accounts.map(a=>[a.id,esc(a.name)])],defAcc)}</div>`;
}
function ffxBackupFreqHTML(){
  return`<div class="card mb12"><div class="fz12 fw7 mb6">Backup reminders</div>${ffxSel("Remind me to back up","You'll get a notification and a banner in Settings when your last backup is older than this.","backupDays",[[7,"Every week"],[14,"Every 2 weeks"],[30,"Every month"],[60,"Every 2 months"],[0,"Never"]],ffxBackupDays())}</div>`;
}
function ffxHourLabel(h){const x=h%12||12;return x+":00 "+(h<12?"am":"pm");}
function ffxSetReminderHours(){
  const m=Number($("remM")?.value),e=Number($("remE")?.value);ffxSetPref("remMorning",m);ffxSetPref("remEvening",e);
  try{window.Android.setReminderHours(m,e);}catch(x){}haptic("light");if(settingsOpen)renderSettings();showToast("Reminders set for "+ffxHourLabel(m)+" and "+ffxHourLabel(e),"green");
}
function ffxRemindersHTML(){
  const nat=window.Android&&typeof window.Android.setReminderHours==="function";
  if(!nat)return`<div class="card mb12"><div class="fz12 fw7 mb6">Reminders</div>${ffxSel("Remind me about bills","How many days before a bill is due.","billLead",[[1,"1 day before"],[2,"2 days before"],[3,"3 days before"],[5,"5 days before"],[7,"A week before"]],ffxBillLead())}</div>`;
  const m=ffxPref("remMorning",6),e=ffxPref("remEvening",18);
  return`<div class="card mb12"><div class="fz12 fw7 mb6">Reminders</div>
    <div class="fz10 muted mb8">${remindersEnabled?"Daily nudges to log your transactions.":"Turn on daily reminders in Settings › Security to use these times."}</div>
    <div class="grid2" style="gap:8px"><div><span class="edit-label">Morning</span><select class="inp" id="remM" onchange="ffxSetReminderHours()">${[5,6,7,8,9,10,11].map(h=>`<option value="${h}" ${Number(m)===h?"selected":""}>${ffxHourLabel(h)}</option>`).join("")}</select></div><div><span class="edit-label">Evening</span><select class="inp" id="remE" onchange="ffxSetReminderHours()">${[16,17,18,19,20,21,22].map(h=>`<option value="${h}" ${Number(e)===h?"selected":""}>${ffxHourLabel(h)}</option>`).join("")}</select></div></div>
    <div class="mt10">${ffxSel("Remind me about bills","How many days before a bill is due.","billLead",[[1,"1 day before"],[2,"2 days before"],[3,"3 days before"],[5,"5 days before"],[7,"A week before"]],ffxBillLead())}</div></div>`;
}
function ffxLockGraceHTML(){
  if(!(pinHash||biometricEnabled))return"";
  return`<div class="card mb12"><div class="fz12 fw7 mb6">Lock timing</div>${ffxSel("Ask for PIN or fingerprint","Reopening the app within this time won't ask again. Starting the app fresh always asks.","lockGrace",[[0,"Every time I leave the app"],[1,"After 1 minute away"],[5,"After 5 minutes away"],[15,"After 15 minutes away"]],ffxPref("lockGrace",0))}</div>`;
}
// default account for new entries
(function(){const orig=ffxEnhanceAddSheet;ffxEnhanceAddSheet=function(){orig();const d=ffxPref("defaultAcc","");if(d&&accounts.some(a=>a.id===d)&&!window._bankAlertId&&!window._ffxFund){window._txAcc=d;const l=$("txAccLabel");if(l)l.textContent=accName(d);}};})();

// ── import from another app (Money Manager, Wallet, Monefy, generic CSV) ──
let ffxImp=null;
function ffxCsvParse(text){
  text=String(text).replace(/^\uFEFF/,"");
  const first=text.split(/\r?\n/,1)[0]||"",commas=first.split(",").length,semis=first.split(";").length,tabs=first.split("\t").length;
  const delim=semis>commas&&semis>=tabs?";":tabs>commas?"\t":",";
  const rows=[];let row=[],cur="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else if(c==='"')q=true;else if(c===delim){row.push(cur);cur="";}else if(c==="\n"){row.push(cur);rows.push(row);row=[];cur="";}else if(c!=="\r")cur+=c;}
  if(cur!==""||row.length){row.push(cur);rows.push(row);}
  return rows.filter(r=>r.some(x=>String(x).trim()!==""));
}
function ffxParseNum(v){
  let s=String(v??"").trim();if(!s)return NaN;let neg=false;
  if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}
  s=s.replace(/[^0-9,.\-]/g,"");if(s.startsWith("-")){neg=!neg;s=s.slice(1);}s=s.replace(/-/g,"");
  const lc=s.lastIndexOf(","),ld=s.lastIndexOf(".");
  if(lc>=0&&ld>=0)s=lc>ld?s.replace(/\./g,"").replace(",","."):s.replace(/,/g,"");
  else if(lc>=0)s=/^\d{1,3}(,\d{3})+$/.test(s)?s.replace(/,/g,""):s.replace(",",".");
  const n=parseFloat(s);return Number.isFinite(n)?(neg?-n:n):NaN;
}
function ffxParseDate(str,order){
  str=String(str||"").trim();let m;
  if((m=str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/)))return ffxIsoOk(+m[1],+m[2],+m[3]);
  if((m=str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))){let y=+m[3];if(y<100)y+=2000;return order==="mdy"?ffxIsoOk(y,+m[1],+m[2]):ffxIsoOk(y,+m[2],+m[1]);}
  return null;
}
function ffxIsoOk(y,mo,d){const iso=y+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0");return FinanceCore.date(iso)?iso:null;}
function ffxImportMap(header){
  const h=header.map(x=>String(x).trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim());
  const find=(...names)=>{for(const n of names){const i=h.findIndex(x=>x===n);if(i>=0)return i;}for(const n of names){const i=h.findIndex(x=>x.includes(n)&&!x.includes("converted")&&!x.includes("ref"));if(i>=0)return i;}return -1;};
  const m={date:find("date","datetime","time"),amount:find("amount","value","sum"),type:find("income expense","transaction type","type"),category:find("category"),sub:find("subcategory","sub category"),account:find("account","wallet"),note:find("note"),desc:find("description","memo","payee","title","name")};
  if(m.note===m.desc)m.desc=-1;
  const hj=h.join("|");
  m.format=/ref currency amount|payment type/.test(hj)?"Wallet":/converted amount/.test(hj)?"Monefy":/income expense/.test(hj)&&/sub ?category/.test(hj)?"Money Manager":"CSV";
  return m;
}
function ffxImportPlan(rows,opts){
  const map=ffxImportMap(rows[0]),body=rows.slice(1);
  if(map.date<0||map.amount<0)return{error:"Couldn't find Date and Amount columns in that file."};
  // date order
  let order=opts.order;if(!order){let a12=false,b12=false;body.slice(0,2000).forEach(r=>{const m=String(r[map.date]||"").match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/);if(m){if(+m[1]>12)a12=true;if(+m[2]>12)b12=true;}});order=a12?"dmy":b12?"mdy":"dmy";opts.ambiguous=!a12&&!b12&&body.some(r=>/^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/.test(String(r[map.date]||"")));opts.order=order;}
  const EC=getEC(),IC=getIC(),ci=(o,n)=>Object.keys(o).find(k=>k.toLowerCase()===String(n).toLowerCase());
  const items=[],skip={transfer:0,invalid:0,dup:0},newAcc=new Set(),newCat=new Set(),accIdx=new Map(accounts.map(a=>[a.name.trim().toLowerCase(),a]));
  const exist=new Set(txns.map(t=>[t.date,t.accountId,t.type,Number(t.amount).toFixed(2),(t.description||"").toLowerCase()].join("|")));
  const seen=new Set();let min="9999",max="0000";
  body.forEach(r=>{
    const date=ffxParseDate(r[map.date],order),raw=ffxParseNum(r[map.amount]);
    if(!date||!Number.isFinite(raw)||raw===0){skip.invalid++;return;}
    const tcol=map.type>=0?String(r[map.type]||"").toLowerCase():"";
    if(/transfer/.test(tcol)){skip.transfer++;return;}
    let type=/income|credit|deposit|received|^in$/.test(tcol)?"income":/expense|debit|spend|^out$/.test(tcol)?"expense":(raw<0?"expense":"income");
    if(!tcol&&raw>0&&map.format==="Monefy")type="income";
    const amount=Math.abs(raw);
    const accName0=map.account>=0?String(r[map.account]||"").trim():"";let acc=accName0?accIdx.get(accName0.toLowerCase()):accounts.find(a=>a.id===opts.dest);
    if(accName0&&!acc){newAcc.add(accName0);}
    const cats=type==="income"?IC:EC;let cat=map.category>=0?String(r[map.category]||"").trim():"",sub=map.sub>=0?String(r[map.sub]||"").trim():"";
    let canon=cat?ci(cats,cat):null;if(cat&&!canon){newCat.add(type[0]+":"+cat);canon=cat;}
    if(!canon)canon=ci(cats,"Other")||Object.keys(cats)[0];
    const desc=[map.note>=0?String(r[map.note]||"").trim():"",map.desc>=0?String(r[map.desc]||"").trim():""].filter(Boolean).join(" — ").slice(0,120);
    const key=[date,(acc?acc.id:"new:"+accName0.toLowerCase()),type,amount.toFixed(2),desc.toLowerCase()].join("|");
    if(exist.has(key)||seen.has(key)){skip.dup++;return;}seen.add(key);
    if(date<min)min=date;if(date>max)max=date;
    items.push({date,amount,type,accName:accName0,accId:acc?acc.id:null,category:canon,sub,desc});
  });
  return{format:map.format,items,skip,newAcc:[...newAcc],newCat:[...newCat],range:[min,max],order,ambiguous:opts.ambiguous,total:body.length,hasAcc:map.account>=0};
}
function ffxImportStart(){
  if(settingsOpen)closeSettings();
  let inp=$("ffxImpInput");
  if(!inp){inp=document.createElement("input");inp.type="file";inp.accept=".csv,.txt,text/csv";inp.id="ffxImpInput";inp.style.display="none";
    inp.onchange=()=>{const f=inp.files[0];if(!f)return;if(f.size>8*1024*1024)return alert("That file is too large (8 MB maximum).");const r=new FileReader();r.onload=()=>ffxImportLoaded(String(r.result),f.name);r.readAsText(f);};document.body.appendChild(inp);}
  inp.value="";inp.click();
}
function ffxImportLoaded(text,name){
  const rows=ffxCsvParse(text);if(rows.length<2)return alert("That file looks empty.");if(rows.length>30001)return alert("That file has too many rows (30,000 maximum).");
  ffxImp={rows,name,opts:{order:"",dest:accounts[0]?.id||"",ambiguous:false}};ffxImportPreview();
}
function ffxImportOpt(k,v){ffxImp.opts[k]=v;if(k==="order")ffxImp.opts.fixedOrder=true;ffxImportPreview();}
function ffxImportPreview(){
  const o=ffxImp.opts,keep=o.fixedOrder?o.order:"";if(!o.fixedOrder)o.order="";
  const plan=ffxImp.plan=ffxImportPlan(ffxImp.rows,o);
  const box=h=>{$("modal-container").innerHTML=`<div class="modal-bg" onclick="showModal('close')"><div class="modal modal-lg" onclick="event.stopPropagation()"><div class="modal-handle"></div><div class="flex-b mb12"><span class="fz16 fw7">Import from another app</span><button class="btn" style="padding:2px;color:var(--muted)" onclick="showModal('close')">&#10005;</button></div>${h}</div></div>`;};
  if(plan.error)return box(`<div class="msg msg-err" style="display:block">${esc(plan.error)}</div><div class="fz11 muted mt8">Export your data as CSV from the other app (it needs at least a date and an amount for each row).</div>`);
  const n=plan.items.length,sk=plan.skip;
  box(`<div class="fz12 mb8">Found <b>${plan.total}</b> rows in “${esc(ffxImp.name)}” · looks like <b>${esc(plan.format)}</b></div>
    <div class="ffx-ssum mb10"><div><span>To import</span><b>${n}</b></div><div><span>Dates</span><b style="font-size:11px">${n?esc(plan.range[0])+"<br>→ "+esc(plan.range[1]):"—"}</b></div><div><span>Skipped</span><b>${sk.dup+sk.transfer+sk.invalid}</b></div></div>
    ${sk.dup||sk.transfer||sk.invalid?`<div class="fz10 muted mb8">Skipped: ${sk.dup} already in FinanceFlow, ${sk.transfer} transfers (add those by hand), ${sk.invalid} unreadable rows.</div>`:""}
    ${plan.newAcc.length?`<div class="fz11 mb6">New accounts to create: <b>${plan.newAcc.map(esc).join(", ")}</b></div>`:""}
    ${plan.newCat.length?`<div class="fz11 mb6">New categories to create: <b>${plan.newCat.slice(0,12).map(x=>esc(x.slice(2))).join(", ")}${plan.newCat.length>12?" …":""}</b></div>`:""}
    ${plan.hasAcc?"":`<span class="edit-label">Put everything in account</span><select class="inp mb8" onchange="ffxImportOpt('dest',this.value)">${accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===o.dest?"selected":""}>${esc(a.name)}</option>`).join("")}</select>`}
    <span class="edit-label">Dates are written as</span><select class="inp mb4" onchange="ffxImportOpt('order',this.value)"><option value="dmy" ${plan.order==="dmy"?"selected":""}>Day / Month / Year</option><option value="mdy" ${plan.order==="mdy"?"selected":""}>Month / Day / Year</option></select>
    ${plan.ambiguous?`<div class="fz10 warn mb8">⚠ These dates could be read either way. Check the range above looks right.</div>`:`<div style="height:8px"></div>`}
    <div class="fz10 muted mb10">Amounts are read in ${esc(currency.code)}. You can undo right after importing.</div>
    <button class="btn btn-p w100" style="justify-content:center;padding:13px" ${n?"":"disabled"} onclick="ffxImportCommit()">Import ${n} transaction${n===1?"":"s"}</button>`);
}
function ffxEnsureCategory(type,cat,sub){
  const map=type==="income"?userIC:userEC,cur=type==="income"?getIC():getEC();
  if(!Object.hasOwn(cur,cat))map[cat]=[];
  if(sub){const list=type==="income"?getIC()[cat]:getEC()[cat];if(!(list||[]).includes(sub))map[cat]=[...(list||[]),sub];}
}
function ffxImportCommit(){
  const plan=ffxImp&&ffxImp.plan;if(!plan||!plan.items.length)return;
  const before={txns:JSON.parse(JSON.stringify(txns)),accounts:JSON.parse(JSON.stringify(accounts)),userEC:JSON.parse(JSON.stringify(userEC)),userIC:JSON.parse(JSON.stringify(userIC))};
  const byName=new Map(accounts.map(a=>[a.name.trim().toLowerCase(),a.id]));
  plan.newAcc.forEach((name,i)=>{if(byName.has(name.toLowerCase()))return;const a={id:uid(),name,type:"bank",color:ACC_COLORS[(accounts.length+i)%ACC_COLORS.length],currency:currency.code};accounts.push(a);byName.set(name.toLowerCase(),a.id);});
  const tag="Import ("+plan.format+")";
  plan.items.forEach(it=>{
    const accId=it.accId||byName.get(it.accName.toLowerCase())||ffxImp.opts.dest;ffxEnsureCategory(it.type,it.category,it.sub);
    txns.push({id:uid(),date:it.date,amount:FinanceCore.round(it.amount),type:it.type,category:it.category,subcategory:it.sub||"",accountId:accId,description:it.desc,tags:[],source:tag});
  });
  const n=plan.items.length;save();showModal("close");render();haptic("success");
  showUndoToast("📥 Imported "+n+" transaction"+(n===1?"":"s"),()=>{txns=before.txns;accounts=before.accounts;userEC=before.userEC;userIC=before.userIC;save();});
}
