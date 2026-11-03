/* Agent1 market discovery + watch/hold decision support.
 * Public Crypto.com Exchange ticker data only. No credentials, account access, or order endpoints.
 */
export const CRYPTOCOM_TICKERS_URL =
  "https://api.crypto.com/exchange/v1/public/get-tickers";

export function discoverSpotMarkets(payload) {
  const rows = payload?.result?.data;
  if (payload?.code !== 0 || !Array.isArray(rows)) {
    throw new Error("Invalid Crypto.com ticker payload");
  }

  return rows
    .filter(row => row && typeof row.i === "string" && /^[A-Z0-9]+_(EUR|USD|USDT|BTC|USDC)$/.test(row.i))
    .map(row => {
      const [base, quote] = row.i.split("_");
      const ask = Number(row.a);
      const bid = Number(row.b);
      const last = Number(row.k);
      const timestamp = Number(row.t);
      return {
        pair: row.i,
        base,
        quote,
        ask: Number.isFinite(ask) && ask > 0 ? ask : null,
        bid: Number.isFinite(bid) && bid > 0 ? bid : null,
        last: Number.isFinite(last) && last > 0 ? last : null,
        timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
      };
    })
    .filter(market => market.last !== null);
}

/* User-maintained position notes; alerts are informational, never orders. */
export function evaluateHoldSignals(position, price, now = Date.now()) {
  if (!position || !Number.isFinite(position.entryPrice) || position.entryPrice <= 0 ||
      !Number.isFinite(price) || price <= 0) {
    return { status: "UNAVAILABLE", pnlPercent: null, alerts: [] };
  }

  const pnlPercent = ((price / position.entryPrice) - 1) * 100;
  const alerts = [];
  if (Number.isFinite(position.takeProfitPercent) &&
      pnlPercent >= position.takeProfitPercent) alerts.push("TAKE-PROFIT LEVEL REACHED");
  if (Number.isFinite(position.stopReviewPercent) &&
      pnlPercent <= -Math.abs(position.stopReviewPercent)) alerts.push("RISK REVIEW LEVEL REACHED");
  if (Number.isFinite(position.reviewAfter) && now >= position.reviewAfter)
    alerts.push("TIME-BASED REVIEW DUE");

  return {
    status: alerts.length ? "REVIEW SIGNAL" : "HOLD / MONITOR",
    pnlPercent,
    alerts
  };
}

export function validateMarketModule() {
  const sample = {
    code: 0,
    result: { data: [
      { i: "BTC_EUR", a: "62000", b: "61950", k: "61980", t: 1700000000000 },
      { i: "NEWCOIN_USDT", a: "0.12", b: "0.11", k: "0.115", t: 1700000000000 },
      { i: "INVALID_PAIR", a: "1", b: "1", k: "1", t: 1700000000000 },
      { i: "BAD_EUR", a: "0", b: "0", k: "0", t: 1700000000000 }
    ]}
  };
  const markets = discoverSpotMarkets(sample);
  const signal = evaluateHoldSignals({
    entryPrice: 100, takeProfitPercent: 5, stopReviewPercent: 3
  }, 106);
  return {
    dynamicDiscovery: markets.length === 2 && markets.some(m => m.base === "NEWCOIN"),
    ignoresInvalidPairsAndPrices: markets.length === 2,
    takeProfitAlert: signal.alerts.includes("TAKE-PROFIT LEVEL REACHED"),
    noOrderExecution: !("order" in signal) && !("execute" in signal)
  };
}
