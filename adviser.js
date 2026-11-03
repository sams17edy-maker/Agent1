(() => {
"use strict";
const FEE=0.002, endpoint="https://api.crypto.com/exchange/v1/public/get-tickers";
const $=id=>document.getElementById(id), history=new Map(); let busy=false;
const eur=n=>Number.isFinite(n)?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumSignificantDigits:8}).format(n):"—";
function signalFor(m, now){
 const arr=history.get(m.pair)||[]; if(arr.length<4)return {signal:"HOLD",why:"Collecting price history",net:null};
 const first=arr[0].price,last=arr[arr.length-1].price,change=(last-first)/first;
 const move=change*100, feeHurdle=FEE*2*100;
 const signal=move>feeHurdle*1.5?"BUY":move< -feeHurdle*1.5?"SELL":"HOLD";
 return {signal,why:"Observed move "+(move>=0?"+":"")+move.toFixed(2)+"% · round-trip fee estimate "+feeHurdle.toFixed(2)+"%",net:move-feeHurdle};
}
async function refresh(){
 if(busy)return;busy=true;$("status").textContent="Refreshing Crypto.com public market data…";
 try{
 const res=await fetch(endpoint,{cache:"no-store"});if(!res.ok)throw Error("HTTP "+res.status);
 const payload=await res.json();if(payload?.code!==0||!Array.isArray(payload?.result?.data))throw Error("Unexpected ticker response");
 const tickers=payload.result.data, map=new Map(tickers.map(t=>[t.i,t]));
 const eurUsdt=Number(map.get("EUR_USDT")?.a),eurUsd=Number(map.get("EUR_USD")?.a);
 const markets=[];
 for(const t of tickers){if(!t||typeof t.i!=="string")continue;const match=t.i.match(/^([A-Z0-9]+)_(EUR|USDT|USD)$/);if(!match)continue;
 const base=match[1],quote=match[2],last=Number(t.a||t.l),stamp=Number(t.t);if(!(last>0)||!Number.isFinite(stamp))continue;
 const price=quote==="EUR"?last:quote==="USDT"&&eurUsdt>0?last/eurUsdt:quote==="USD"&&eurUsd>0?last/eurUsd:NaN;if(!(price>0))continue;
 const m={pair:t.i,base,quote,price,bid:Number(t.b),ask:Number(t.a),timestamp:stamp};markets.push(m);
 const arr=history.get(m.pair)||[];if(!arr.length||arr[arr.length-1].timestamp!==stamp){arr.push({price,timestamp:stamp});while(arr.length>8)arr.shift();history.set(m.pair,arr);}
 }
 markets.sort((a,b)=>a.base.localeCompare(b.base)||a.quote.localeCompare(b.quote));
 $("markets").innerHTML=markets.length?'<table><thead><tr><th>Market</th><th>Reference (EUR)</th><th>Bid / ask</th></tr></thead><tbody>'+markets.map(m=>'<tr><td><b>'+m.pair+'</b></td><td>'+eur(m.price)+'</td><td>'+(m.bid>0&&m.ask>0?m.bid+' / '+m.ask:'—')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No EUR-convertible markets in this response.</div>';
 const sigs=markets.map(m=>({...m,...signalFor(m,Date.now())}));
 $("signals").innerHTML=sigs.length?'<table><thead><tr><th>Market</th><th>Signal</th><th>Reason / fee estimate</th></tr></thead><tbody>'+sigs.map(m=>'<tr><td><b>'+m.pair+'</b></td><td class="signal '+m.signal+'">'+m.signal+'</td><td>'+m.why+(m.net!==null?' · net estimate '+m.net.toFixed(2)+'%':'')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">Signals unavailable.</div>';
 $("status").textContent="Updated "+new Date().toLocaleTimeString()+" · "+markets.length+" discovered quote markets · public data only.";
 }catch(e){$("status").textContent="Market feed unavailable: "+e.message+" · Please retry.";console.warn(e)}finally{busy=false}
}
$("refresh").addEventListener("click",refresh);refresh();setInterval(()=>{if(document.visibilityState==="visible")refresh()},15000);
})();