(() => {
"use strict";
const core=window.AdviserCore, endpoint="https://api.crypto.com/exchange/v1/public/get-tickers";
const REFRESH_MS=15000,STALE_MS=60000;
const $=id=>document.getElementById(id), history=new Map(),lastAlertState=new Map();let busy=false,lastSuccess=0,lastMarkets=[],notificationsEnabled=false;
const eur=n=>Number.isFinite(n)?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumSignificantDigits:8}).format(n):"—";
const num=core.finitePositive;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const displaySignal=s=>s==="BUY"?"UPWARD":s==="SELL"?"DOWNWARD":"HOLD";

function notifySignalChanges(markets){
 if(!notificationsEnabled||!("Notification"in window)||Notification.permission!=="granted")return;
 for(const m of markets){
  const s=m.fresh?core.signalFor(m,history):core.suppressStale(core.signalFor(m,history));
  const current=m.fresh?displaySignal(s.signal):"HOLD",previous=lastAlertState.get(m.pair);
  lastAlertState.set(m.pair,current);
  if((current==="UPWARD"||current==="DOWNWARD")&&current!==previous){
   const title=current==="UPWARD"?"Upward momentum observed":"Downward momentum observed";
   const body=m.pair+" · observed net movement "+(Number.isFinite(s.net)?s.net.toFixed(2)+"% after illustrative fees/spread":"not available")+". Market information only; not an instruction to trade.";
   try{new Notification(title,{body,tag:"market-observation-"+m.pair,renotify:false});}catch(e){console.warn("Notification could not be shown",e);}
  }
 }
}
function renderFeaturedAlert(markets,stale=false){
 const candidates=markets.map(m=>({...m,...(stale||!m.fresh?core.suppressStale(core.signalFor(m,history)):core.signalFor(m,history))}))
  .filter(m=>m.signal!=="HOLD"&&Number.isFinite(m.net))
  .sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));
 const box=$("featured-alert");
 if(stale){box.innerHTML='<div class="row"><strong>Market alert</strong><span class="pill amber">STALE FEED</span></div><div class="alert-title flat">NO CURRENT ALERT</div><p>Market data is stale or unavailable. Previous directional observations are suppressed until fresh timestamps return.</p>';return;}
 const best=candidates[0];
 if(!best){box.innerHTML='<div class="row"><strong>Market alert</strong><span class="pill amber">OBSERVATION ONLY</span></div><div class="alert-title flat">NO CLEAR DIRECTION</div><p>No market currently meets the short-term observation threshold after estimated fees and spread. Continue monitoring; this is not a buy or sell instruction.</p>';return;}
 const up=best.signal==="BUY",direction=up?"UPWARD MOMENTUM OBSERVED":"DOWNWARD MOMENTUM OBSERVED";
 box.innerHTML='<div class="row"><strong>Market alert</strong><span class="pill amber">OBSERVATION ONLY</span></div><div class="alert-title '+(up?"up":"down")+'">'+direction+'</div><div class="alert-meta"><span>Market<strong>'+esc(best.pair)+'</strong></span><span>Observed move after estimated costs<strong>'+best.net.toFixed(2)+'%</strong></span><span>Illustrative round-trip cost<strong>'+Number(best.estimatedCost||0).toFixed(2)+'%</strong></span><span>Confidence<strong>'+esc(best.confidence)+'</strong></span></div><p>'+esc(best.why)+'. This describes recent market behaviour; it is not a personal recommendation or an instruction to trade.</p>';
}
function renderSignals(markets,stale=false){
 const sigs=markets.map(m=>{const s=(stale||!m.fresh)?core.suppressStale(core.signalFor(m,history)):core.signalFor(m,history);return {...m,...s};});
 $("signals").innerHTML=sigs.length?'<table><thead><tr><th>Market</th><th>Observation</th><th>Reason · confidence · observed net move</th></tr></thead><tbody>'+sigs.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td class="signal '+displaySignal(m.signal)+'">'+displaySignal(m.signal)+'</td><td>'+esc(m.why)+' · '+m.confidence+(m.net!==null?' · observed '+m.net.toFixed(2)+'% after estimated fees/spread':'')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">Market observations unavailable.</div>';
 renderFeaturedAlert(markets,stale);
}
async function refresh(){
 if(busy)return;busy=true; $("status").textContent="Refreshing Crypto.com public market data…";
 try{
 const res=await fetch(endpoint,{cache:"no-store"});if(!res.ok)throw Error("HTTP "+res.status);
 const payload=await res.json();if(payload?.code!==0||!Array.isArray(payload?.result?.data))throw Error("Unexpected ticker response");
 const tickers=payload.result.data,map=new Map(tickers.map(t=>[t.i,t]));
 const eurUsdt=num(map.get("EUR_USDT")?.a),eurUsd=num(map.get("EUR_USD")?.a),markets=[];
 for(const t of tickers){
  if(!t||typeof t.i!=="string")continue;const parsed=core.parseTicker(t);if(!parsed)continue;
  const {base,quote,last,bid,ask}=parsed,rate=core.eurRate(quote,{eurUsdt,eurUsd}),price=Number.isFinite(rate)?last*rate:NaN;
  const m={pair:t.i,base,quote,last,bid,ask,price,timestamp:parsed.timestamp,fresh:core.tickerFresh(parsed.timestamp)};markets.push(m);
  if(m.fresh)core.addSample(history,m.pair,last);
 }
 markets.sort((a,b)=>a.base.localeCompare(b.base)||a.quote.localeCompare(b.quote));lastMarkets=markets;
 $("markets").innerHTML=markets.length?'<table><thead><tr><th>Market</th><th>Last</th><th>Bid / ask</th><th>EUR reference</th><th>Feed</th></tr></thead><tbody>'+markets.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td>'+m.last+'</td><td>'+(Number.isFinite(m.bid)&&Number.isFinite(m.ask)?m.bid+' / '+m.ask:'—')+'</td><td>'+eur(m.price)+'</td><td>'+ (m.fresh?'Fresh':'Stale / unknown')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No markets returned by the public feed.</div>';
 notifySignalChanges(markets);renderSignals(markets,false);lastSuccess=Date.now();
 const staleCount=markets.filter(m=>!m.fresh).length;
 $("status").textContent="Updated "+new Date(lastSuccess).toLocaleTimeString()+" · "+markets.length+" public quote markets · "+staleCount+" stale/unknown ticker timestamps"+(staleCount?" · stale observations suppressed":"")+".";
 }catch(e){renderSignals(lastMarkets,true);$("status").textContent="Market feed unavailable: "+e.message+" · old observations suppressed; please retry.";console.warn(e)}finally{busy=false}
}
$("enable-notifications").addEventListener("click",async()=>{
 if(!("Notification"in window)){$("notification-status").textContent="This browser does not support notifications.";return;}
 if(!window.isSecureContext){$("notification-status").textContent="Notifications require a secure HTTPS page.";return;}
 try{
  const permission=await Notification.requestPermission();
  notificationsEnabled=permission==="granted";
  $("notification-status").textContent=notificationsEnabled?"Notifications enabled. Alerts appear only when an observed market direction changes while this page is open.":permission==="denied"?"Notifications were blocked in browser settings.":"Notifications were not enabled.";
  $("enable-notifications").textContent=notificationsEnabled?"Notifications enabled":"Enable notifications";
 }catch(e){$("notification-status").textContent="Could not enable notifications in this browser.";}
});
$("refresh").addEventListener("click",refresh);refresh();setInterval(()=>{if(document.visibilityState==="visible"){if(lastSuccess&&Date.now()-lastSuccess>STALE_MS){renderSignals(lastMarkets,true);$("status").textContent="Feed stale · previous observations suppressed · attempting refresh"}refresh()}},REFRESH_MS);
})();