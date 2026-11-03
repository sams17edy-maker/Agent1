(() => {
"use strict";
const core=window.AdviserCore, endpoint="https://api.crypto.com/exchange/v1/public/get-tickers";
const REFRESH_MS=15000,STALE_MS=60000;
const $=id=>document.getElementById(id), history=new Map();let busy=false,lastSuccess=0,lastMarkets=[];
const eur=n=>Number.isFinite(n)?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumSignificantDigits:8}).format(n):"—";
const num=core.finitePositive;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function renderSignals(markets,stale=false){
 const sigs=markets.map(m=>{const s=(stale||!m.fresh)?core.suppressStale(core.signalFor(m,history)):core.signalFor(m,history);return {...m,...s};});
 $("signals").innerHTML=sigs.length?'<table><thead><tr><th>Market</th><th>Signal</th><th>Reason · confidence · observed net move</th></tr></thead><tbody>'+sigs.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td class="signal '+m.signal+'">'+m.signal+'</td><td>'+esc(m.why)+' · '+m.confidence+(m.net!==null?' · observed '+m.net.toFixed(2)+'% after estimated fees/spread':'')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">Signals unavailable.</div>';
}
async function refresh(){
 if(busy)return;busy=true;$("status").textContent="Refreshing Crypto.com public market data…";
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
 renderSignals(markets,false);lastSuccess=Date.now();
 const staleCount=markets.filter(m=>!m.fresh).length;
 $("status").textContent="Updated "+new Date(lastSuccess).toLocaleTimeString()+" · "+markets.length+" public quote markets · "+staleCount+" stale/unknown ticker timestamps"+(staleCount?" · all signals suppressed":"")+".";
 }catch(e){renderSignals(lastMarkets,true);$("status").textContent="Market feed unavailable: "+e.message+" · old signals suppressed; please retry.";console.warn(e)}finally{busy=false}
}
$("refresh").addEventListener("click",refresh);refresh();setInterval(()=>{if(document.visibilityState==="visible"){if(lastSuccess&&Date.now()-lastSuccess>STALE_MS){renderSignals(lastMarkets,true);$("status").textContent="Feed stale · old signals suppressed · attempting refresh"}refresh()}},REFRESH_MS);
})();