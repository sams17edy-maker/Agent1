const test=require("node:test"),assert=require("node:assert/strict"),core=require("./adviser-core.js");
test("Crypto.com ticker parses latest trade, bid, ask and timestamp from documented fields",()=>{const m=core.parseTicker({i:"BTC_USDT",l:"64000",a:"65000",b:"64990",k:"65010",t:"1700000000000"});assert.equal(m.last,65000);assert.equal(m.bid,64990);assert.equal(m.ask,65010);assert.equal(m.timestamp,1700000000000);});
test("rejects malformed pair or missing/invalid latest trade",()=>{assert.equal(core.parseTicker({i:"BTCUSDT",a:"2"}),null);assert.equal(core.parseTicker({i:"BTC_USDT",l:"2"}),null);assert.equal(core.parseTicker({i:"BTC_USDT",a:"0"}),null);});
test("EUR conversion and unsupported quote handling",()=>{assert.equal(core.eurRate("EUR",{}),1);assert.equal(core.eurRate("USDT",{eurUsdt:1.1}),1/1.1);assert.ok(Number.isNaN(core.eurRate("BTC",{})));});
test("deduplicates samples for 60s and caps history",()=>{const h=new Map();core.addSample(h,"X",10,1000);core.addSample(h,"X",10,2000);assert.equal(h.get("X").length,1);core.addSample(h,"X",10,61000);assert.equal(h.get("X").length,2);for(let i=1;i<30;i++)core.addSample(h,"X",10+i,70000+i);assert.equal(h.get("X").length,core.MAX_HISTORY);});
test("invalid prices are ignored",()=>{const h=new Map();core.addSample(h,"X",0,1);core.addSample(h,"X",NaN,2);assert.equal(h.has("X"),false);});
test("insufficient history yields HOLD",()=>{const h=new Map([["X",[1,2,3].map((price,i)=>({price,sampledAt:i}))]]);assert.equal(core.signalFor({pair:"X"},h).signal,"HOLD");});
test("rising momentum can yield BUY after estimated costs",()=>{const h=new Map([["X",[100,101,102,104].map((price,i)=>({price,sampledAt:i}))]]);const s=core.signalFor({pair:"X",bid:103.9,ask:104},h);assert.equal(s.signal,"BUY");assert.ok(s.estimatedCost>=0.4);});
test("falling momentum can yield SELL",()=>{const h=new Map([["X",[104,102,101,100].map((price,i)=>({price,sampledAt:i}))]]);assert.equal(core.signalFor({pair:"X",bid:99.9,ask:100.1},h).signal,"SELL");});
test("flat market stays HOLD and net deducts costs",()=>{const h=new Map([["X",[100,100,100,100].map((price,i)=>({price,sampledAt:i}))]]);const s=core.signalFor({pair:"X",bid:99.9,ask:100.1},h);assert.equal(s.signal,"HOLD");assert.ok(s.net<0);});
test("missing spread is not negative",()=>{const h=new Map([["X",[100,101,102,104].map((price,i)=>({price,sampledAt:i}))]]);assert.equal(core.signalFor({pair:"X"},h).estimatedCost,0.4);});

test("ticker freshness accepts seconds or milliseconds and rejects stale, future, missing timestamps",()=>{const now=1700000000000;assert.equal(core.tickerFresh(1699999999000,now),true);assert.equal(core.tickerFresh(1699999999,now),true);assert.equal(core.tickerFresh(1699999900000,now),false);assert.equal(core.tickerFresh(null,now),false);assert.equal(core.tickerFresh(now+60000,now),false);});
test("stale/unknown ticker signal is suppressed to HOLD",()=>{const s=core.suppressStale({signal:"BUY",why:"momentum",confidence:"MEDIUM",net:1.2});assert.equal(s.signal,"HOLD");assert.equal(s.net,null);assert.equal(s.confidence,"LOW");assert.equal(s.stale,true);});

const fs=require("node:fs"),vm=require("node:vm");
const discoverySource=fs.readFileSync(require.resolve("./market-discovery.js"),"utf8")
  .replace(/^export const /gm,"const ")
  .replace(/^export function /gm,"function ")
  + "\nglobalThis.__marketDiscovery={discoverSpotMarkets,evaluateHoldSignals,calculateNetPosition,validateFeeAccounting};";
const discoverySandbox={};
vm.runInNewContext(discoverySource,discoverySandbox);
const discovery=discoverySandbox.__marketDiscovery;

test("market discovery uses latest trade a, bid b and ask k",()=>{
  const markets=discovery.discoverSpotMarkets({code:0,result:{data:[
    {i:"BTC_EUR",a:"65000",b:"64990",k:"65010",t:"1700000000000"}
  ]}});
  assert.equal(markets.length,1);
  assert.equal(markets[0].last,65000);
  assert.equal(markets[0].bid,64990);
  assert.equal(markets[0].ask,65010);
});

test("market discovery accepts supported quote pairs and filters invalid rows",()=>{
  const markets=discovery.discoverSpotMarkets({code:0,result:{data:[
    {i:"BTC_EUR",a:"65000",b:"64990",k:"65010"},
    {i:"TOKEN_USDT",a:"0.12",b:"0.119",k:"0.121"},
    {i:"BAD_PAIR",a:"1",b:"1",k:"1"},
    {i:"ZERO_USD",a:"0",b:"0",k:"0"}
  ]}});
  assert.equal(Array.from(markets,m=>m.pair).join(","),"BTC_EUR,TOKEN_USDT");
});

test("fee accounting calculates net after entry and exit fees",()=>{
  const result=discovery.calculateNetPosition({buyNotional:100,buyFeeRate:0.004,sellNotional:110,sellFeeRate:0.004});
  assert.equal(result.valid,true);
  assert.ok(Math.abs(result.totalEntryCost-100.4)<1e-9);
  assert.ok(Math.abs(result.netSaleProceeds-109.56)<1e-9);
  assert.ok(Math.abs(result.netProfit-9.16)<1e-9);
  assert.ok(Math.abs(result.breakEvenSellNotional-(100.4/0.996))<1e-9);
});
