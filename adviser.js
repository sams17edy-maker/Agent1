(() => {
"use strict";
const core=window.AdviserCore, endpoint="https://api.crypto.com/exchange/v1/public/get-tickers";
const REFRESH_MS=15000;
const $=id=>document.getElementById(id), history=new Map(); let busy=false;
const eur=n=>Number.isFinite(n)?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumSignificantDigits:8}).format(n):"—";
const num=core.finitePositive;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function refresh(){
 if(busy)return;busy=true;$("status").textContent="Refreshing Crypto.com public market data…";
 try{
 const res=await fetch(endpoint,{cache:"no-store"});if(!res.ok)throw Error("HTTP "+res.status);
 const payload=await res.json();if(payload?.code!==0||!Array.isArray(payload?.result?.data))throw Error("Unexpected ticker response");
 const tickers=payload.result.data, map=new Map(tickers.map(t=>[t.i,t]));
 const eurUsdt=num(map.get("EUR_USDT")?.a),eurUsd=num(map.get("EUR_USD")?.a);
 const markets=[];
 for(const t of tickers){
  if(!t||typeof t.i!=="string")continue;
  const match=t.i.match(/^([A-Z0-9]+)_([A-Z0-9]+)$/);if(!match)continue;
  const parsed=core.parseTicker(t);if(!parsed)continue;const base=parsed.base,quote=parsed.quote,last=parsed.last,bid=parsed.bid,ask=parsed.ask;
  if(!Number.isFinite(last))continue;
  const rate=core.eurRate(quote,{eurUsdt,eurUsd});
  const price=Number.isFinite(rate)?last*rate:NaN;
  const m={pair:t.i,base,quote,last,bid,ask,price};
  markets.push(m);
  core.addSample(history,m.pair,last);
 }
 markets.sort((a,b)=>a.base.localeCompare(b.base)||a.quote.localeCompare(b.quote));
 $("markets").innerHTML=markets.length?'<table><thead><tr><th>Market</th><th>Last</th><th>Bid / ask</th><th>EUR reference</th></tr></thead><tbody>'+markets.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td>'+m.last+'</td><td>'+(Number.isFinite(m.bid)&&Number.isFinite(m.ask)?m.bid+' / '+m.ask:'—')+'</td><td>'+eur(m.price)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No markets returned by the public feed.</div>';
 const sigs=markets.map(m=>({...m,...core.signalFor(m,history)}));
 $("signals").innerHTML=sigs.length?'<table><thead><tr><th>Market</th><th>Signal</th><th>Reason · confidence · estimated net</th></tr></thead><tbody>'+sigs.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td class="signal '+m.signal+'">'+m.signal+'</td><td>'+esc(m.why)+' · '+m.confidence+(m.net!==null?' · '+m.net.toFixed(2)+'% after estimated fees/spread':'')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">Signals unavailable.</div>';
 $("status").textContent="Updated "+new Date().toLocaleTimeString()+" · "+markets.length+" public quote markets · "+sigs.filter(x=>x.signal!=="HOLD").length+" non-HOLD advisories.";
 }catch(e){$("status").textContent="Market feed unavailable: "+e.message+" · Please retry.";console.warn(e)}finally{busy=false}
}
$("refresh").addEventListener("click",refresh);refresh();setInterval(()=>{if(document.visibilityState==="visible")refresh()},REFRESH_MS);
})();