(() => {
"use strict";
const FEE=0.002, endpoint="https://api.crypto.com/exchange/v1/public/get-tickers";
const MIN_SAMPLES=4, MAX_HISTORY=24, REFRESH_MS=15000;
const $=id=>document.getElementById(id), history=new Map(); let busy=false;
const eur=n=>Number.isFinite(n)?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumSignificantDigits:8}).format(n):"—";
const num=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:NaN};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function signalFor(m){
 const arr=history.get(m.pair)||[];
 if(arr.length<MIN_SAMPLES)return {signal:"HOLD",why:"Collecting "+(MIN_SAMPLES-arr.length)+" distinct price samples",net:null,confidence:"LOW"};
 const first=arr[0].price,last=arr[arr.length-1].price;
 const move=(last/first-1)*100, changes=arr.slice(1).map((p,i)=>(p.price/arr[i].price-1)*100);
 const positive=changes.filter(x=>x>0).length,negative=changes.filter(x=>x<0).length;
 const momentum=(last/arr.at(-4).price-1)*100;
 const spreadPct=Number.isFinite(m.bid)&&Number.isFinite(m.ask)&&m.bid>0&&m.ask>0?(m.ask-m.bid)/((m.ask+m.bid)/2)*100:0;
 const estimatedCost=FEE*2*100+spreadPct,net=move-estimatedCost;
 let signal="HOLD",why="Observed move does not clear estimated fee-and-spread hurdle";
 if(momentum>estimatedCost*1.5&&positive>=Math.ceil(changes.length*.6)){signal="BUY";why="Short-term upward momentum; review entry risk";}
 else if(momentum< -estimatedCost*1.5&&negative>=Math.ceil(changes.length*.6)){signal="SELL";why="Short-term downward momentum; review exit risk";}
 return {signal,why,net,confidence:arr.length>=16?"MEDIUM":"LOW",estimatedCost};
}
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
  const base=match[1],quote=match[2],last=num(t.l)||num(t.a),bid=num(t.b),ask=num(t.a);
  if(!Number.isFinite(last))continue;
  const rate=quote==="EUR"?1:quote==="USDT"&&eurUsdt?1/eurUsdt:quote==="USD"&&eurUsd?1/eurUsd:NaN;
  const price=Number.isFinite(rate)?last*rate:NaN;
  const m={pair:t.i,base,quote,last,bid,ask,price};
  markets.push(m);
  const arr=history.get(m.pair)||[],now=Date.now(),prev=arr.at(-1);
  // Keep a new observation only when price changes or at least 60 seconds elapsed.
  if(!prev||prev.price!==last||now-prev.sampledAt>=60000){
   arr.push({price:last,sampledAt:now});while(arr.length>MAX_HISTORY)arr.shift();history.set(m.pair,arr);
  }
 }
 markets.sort((a,b)=>a.base.localeCompare(b.base)||a.quote.localeCompare(b.quote));
 $("markets").innerHTML=markets.length?'<table><thead><tr><th>Market</th><th>Last</th><th>Bid / ask</th><th>EUR reference</th></tr></thead><tbody>'+markets.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td>'+m.last+'</td><td>'+(Number.isFinite(m.bid)&&Number.isFinite(m.ask)?m.bid+' / '+m.ask:'—')+'</td><td>'+eur(m.price)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No markets returned by the public feed.</div>';
 const sigs=markets.map(m=>({...m,...signalFor(m)}));
 $("signals").innerHTML=sigs.length?'<table><thead><tr><th>Market</th><th>Signal</th><th>Reason · confidence · estimated net</th></tr></thead><tbody>'+sigs.map(m=>'<tr><td><b>'+esc(m.pair)+'</b></td><td class="signal '+m.signal+'">'+m.signal+'</td><td>'+esc(m.why)+' · '+m.confidence+(m.net!==null?' · '+m.net.toFixed(2)+'% after estimated fees/spread':'')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">Signals unavailable.</div>';
 $("status").textContent="Updated "+new Date().toLocaleTimeString()+" · "+markets.length+" public quote markets · "+sigs.filter(x=>x.signal!=="HOLD").length+" non-HOLD advisories.";
 }catch(e){$("status").textContent="Market feed unavailable: "+e.message+" · Please retry.";console.warn(e)}finally{busy=false}
}
$("refresh").addEventListener("click",refresh);refresh();setInterval(()=>{if(document.visibilityState==="visible")refresh()},REFRESH_MS);
})();