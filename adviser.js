(() => {
"use strict";
const FEE=0.002, endpoint="https://api.crypto.com/exchange/v1/public/get-tickers";
const MIN_SAMPLES=4, MAX_HISTORY=24, REFRESH_MS=15000;
const $=id=>document.getElementById(id), history=new Map(); let busy=false;
const eur=n=>Number.isFinite(n)?new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR",maximumSignificantDigits:8}).format(n):"—";
function signalFor(m){
 const arr=history.get(m.pair)||[];
 if(arr.length<MIN_SAMPLES)return {signal:"HOLD",why:"Collecting "+(MIN_SAMPLES-arr.length)+" more distinct quote samples",net:null,confidence:"LOW"};
 const first=arr[0].price,last=arr[arr.length-1].price;
 const move=(last/first-1)*100, feeHurdle=FEE*2*100;
 const changes=arr.slice(1).map((p,i)=>(p.price/arr[i].price-1)*100);
 const positive=changes.filter(x=>x>0).length, negative=changes.filter(x=>x<0).length;
 const momentum=(arr.at(-1).price/arr.at(-4).price-1)*100;
 const spreadPct=m.bid>0&&m.ask>0?(m.ask-m.bid)/((m.ask+m.bid)/2)*100:NaN;
 const estimatedCost=feeHurdle+(Number.isFinite(spreadPct)?spreadPct:0);
 const net=move-estimatedCost;
 let signal="HOLD",why="Movement does not clear estimated trading-cost hurdle";
 if(momentum>estimatedCost*1.5&&positive>=Math.ceil(changes.length*.6)){signal="BUY";why="Positive short-term momentum; review entry risk";}
 else if(momentum< -estimatedCost*1.5&&negative>=Math.ceil(changes.length*.6)){signal="SELL";why="Negative short-term momentum; review exit risk";}
 return {signal,why,net,confidence:arr.length>=12?"MEDIUM":"LOW",estimatedCost};
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
 const arr=history.get(m.pair)||[];if(!arr.length||arr[arr.length-1].timestamp!==stamp){arr.push({price,timestamp:stamp});while(arr.length>MAX_HISTORY)arr.shift();history.set(m.pair,arr);}
 }
 markets.sort((a,b)=>a.base.localeCompare(b.base)||a.quote.localeCompare(b.quote));
 $("markets").innerHTML=markets.length?'<table><thead><tr><th>Market</th><th>Reference (EUR)</th><th>Bid / ask</th></tr></thead><tbody>'+markets.map(m=>'<tr><td><b>'+m.pair+'</b></td><td>'+eur(m.price)+'</td><td>'+(m.bid>0&&m.ask>0?m.bid+' / '+m.ask:'—')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No EUR-convertible markets in this response.</div>';
 const sigs=markets.map(m=>({...m,...signalFor(m)}));
 $("signals").innerHTML=sigs.length?'<table><thead><tr><th>Market</th><th>Signal</th><th>Reason · confidence · estimated net</th></tr></thead><tbody>'+sigs.map(m=>'<tr><td><b>'+m.pair+'</b></td><td class="signal '+m.signal+'">'+m.signal+'</td><td>'+m.why+' · '+m.confidence+(m.net!==null?' · net after fee/spread estimate '+m.net.toFixed(2)+'%':'')+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">Signals unavailable.</div>';
 $("status").textContent="Updated "+new Date().toLocaleTimeString()+" · "+markets.length+" discovered quote markets · public data only.";
 }catch(e){$("status").textContent="Market feed unavailable: "+e.message+" · Please retry.";console.warn(e)}finally{busy=false}
}
$("refresh").addEventListener("click",refresh);refresh();setInterval(()=>{if(document.visibilityState==="visible")refresh()},REFRESH_MS);
})();