// Agent1 learning journal — paper analytics only; never places or changes orders.
(() => {
  "use strict";
  const KEY = "agent1-learning-journal-v1";
  const START = 500;
  const LIMITS = Object.freeze({ maxOrder: 50, maxExposure: 250, dailyLoss: 10, feeRate: 0.002 });
  const $ = id => document.getElementById(id);
  const eur = n => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{"sessions":[],"reviews":0}');
      if (!value || !Array.isArray(value.sessions) || !Number.isFinite(value.reviews)) throw new Error("invalid");
      if (!Array.isArray(value.quotes)) value.quotes = [];
      return value;
    } catch {
      return { sessions: [], quotes: [], reviews: 0 };
    }
  }

  function observe(data) {
    if (!data || !Number.isFinite(data.equity) || !Number.isFinite(data.cash) ||
        !Number.isFinite(data.exposure) || !Number.isFinite(data.orderCount) ||
        !Number.isFinite(data.fees) || !Number.isFinite(data.time) || !data.prices || !["BTC", "ETH", "SOL"].every(c => Number.isFinite(data.prices[c]) && data.prices[c] > 0)) return;
    const journal = load();
    const last = journal.sessions[journal.sessions.length - 1];
    // One checkpoint per minute; update the current minute instead of creating duplicates.
    const point = {
      time: data.time, equity: data.equity, cash: data.cash,
      exposure: data.exposure, orderCount: data.orderCount, fees: data.fees
    };
    if (last && Math.floor(last.time / 60000) === Math.floor(point.time / 60000)) {
      journal.sessions[journal.sessions.length - 1] = point;
    } else {
      journal.sessions.push(point);
    }
    journal.sessions = journal.sessions.slice(-1440);
    const lastQuote = journal.quotes[journal.quotes.length - 1];
    if (!lastQuote || data.time - lastQuote.time >= 5 * 60 * 1000) {
      journal.quotes.push({ time: data.time, BTC: data.prices.BTC, ETH: data.prices.ETH, SOL: data.prices.SOL });
      journal.quotes = journal.quotes.slice(-500);
    }
    journal.reviews += 1;
    try { localStorage.setItem(KEY, JSON.stringify(journal)); } catch (e) {
      console.warn("Learning journal could not be saved", e);
    }
    render();
  }

  function insights() {
    const journal = load();
    const points = journal.sessions;
    if (!points.length) return { journal, points, message: "Waiting for the first paper portfolio observation." };
    const first = points[0], latest = points[points.length - 1];
    const change = latest.equity - first.equity;
    const peak = Math.max(...points.map(p => p.equity));
    const drawdown = peak > 0 ? (peak - latest.equity) / peak : 0;
    const feeShare = latest.fees / START;
    const lessons = [];
    if (points.length < 3) lessons.push("Collect more observations before judging the strategy.");
    else if (change < 0) lessons.push("The observed paper portfolio is below its first checkpoint; review losing periods before changing any strategy.");
    else lessons.push("The observed paper portfolio is above its first checkpoint; repeat testing before treating this as a durable result.");
    if (feeShare >= 0.002) lessons.push("Fees are a measurable drag. Include them in every strategy comparison.");
    if (latest.exposure >= LIMITS.maxExposure * 0.9) lessons.push("Exposure is near the fixed €250 cap; avoid increasing risk.");
    if (latest.orderCount >= 20) lessons.push("Order activity is high. Compare net results after fees with a lower-activity paper baseline.");
    if (drawdown >= 0.01) lessons.push("A drawdown has occurred; inspect the timeline and test downside scenarios.");
    return {
      journal, points, latest, change, drawdown, lessons,
      message: points.length + " checkpoints saved. " + lessons.length + " learning observations."
    };
  }

  function compareStrategies() {
    const quotes = load().quotes;
    const out = $("strategyDetails");
    if (!out) return;
    if (quotes.length < 4) { out.textContent = "Collect at least 4 time-separated public price observations. No historical data is invented."; return; }
    const simulate = kind => {
      let cash = 500, units = 0, fees = 0, trades = 0;
      for (let i = 0; i < quotes.length; i++) {
        const price = quotes[i].BTC;
        const prior = quotes.slice(Math.max(0, i - 3), i).map(q => q.BTC);
        let action = null;
        if (kind === "hold" && i === 0) action = "buy";
        if (kind === "average" && prior.length === 3) {
          const avg = prior.reduce((s, p) => s + p, 0) / 3;
          if (price > avg && units === 0) action = "buy";
          if (price < avg && units > 0) action = "sell";
        }
        if (action === "buy" && cash >= 25 * (1 + LIMITS.feeRate) && units === 0) { units = 25 / price; cash -= 25 * (1 + LIMITS.feeRate); fees += 25 * LIMITS.feeRate; trades++; }
        else if (action === "sell" && units > 0) { const gross = units * price; const charge = gross * LIMITS.feeRate; cash += gross - charge; fees += charge; units = 0; trades++; }
      }
      return { value: cash + units * quotes[quotes.length - 1].BTC, fees, trades };
    };
    const rows = [["Cash baseline", { value: 500, fees: 0, trades: 0 }], ["€25 BTC hold", simulate("hold")], ["3-observation average rule", simulate("average")]];
    const winner = rows.reduce((best, row) => row[1].value > best[1].value ? row : best);
    out.textContent = ["Replay: " + quotes.length + " saved BTC/EUR observations", ...rows.map(([name, r]) => name + ": " + eur(r.value) + " | net change " + eur(r.value - 500) + " | fees " + eur(r.fees) + " | actions " + r.trades), "Highest in this sample: " + winner[0] + ".", "In-sample educational replay only; not a forecast or proof of a useful strategy.", "Isolated simulation: main wallet unchanged; fixed safeguards unchanged."].join("\n");
  }
  // Heuristic risk/price estimator. Descriptive paper analytics, not a validated forecast.
  function estimateSignals() {
    const quotes = load().quotes;
    const out = $("riskSignals");
    if (!out) return;
    const hurdle = LIMITS.feeRate * 2 + 0.002;
    if (quotes.length < 4) {
      out.textContent = "Collect at least 4 time-separated quotes per asset. Estimates remain unavailable until then.";
      return;
    }
    const lines = [
      "Directional estimate for the next observation (based on the last 3 returns):",
      "Fee hurdle: " + (hurdle * 100).toFixed(2) + "% estimated move to cover illustrative entry/exit fees plus buffer.",
      ""
    ];
    for (const coin of ["BTC", "ETH", "SOL"]) {
      const values = quotes.slice(-4).map(q => q[coin]).filter(v => Number.isFinite(v) && v > 0);
      if (values.length < 4) { lines.push(coin + ": insufficient valid quotes."); continue; }
      const returns = values.slice(1).map((v, i) => v / values[i] - 1);
      const estimate = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const volatility = Math.sqrt(returns.reduce((sum, r) => sum + (r - estimate) ** 2, 0) / returns.length);
      const risk = Math.min(100, Math.round(volatility / 0.02 * 100));
      const riskLabel = risk >= 70 ? "HIGH" : risk >= 35 ? "MEDIUM" : "LOW";
      let signal = "WAIT — estimated move does not clear the fee hurdle";
      if (estimate <= -hurdle) signal = "BUY WATCH — model estimates a possible lower entry; wait for confirmation";
      else if (estimate >= hurdle) signal = "SELL WATCH — model estimates a possible higher exit";
      lines.push(coin + " | estimate " + (estimate >= 0 ? "+" : "") + (estimate * 100).toFixed(3) +
        "% | volatility risk " + riskLabel + " (" + risk + "/100) | " + signal);
    }
    lines.push("Simple momentum extrapolation from 3 recent intervals; not a calibrated probability and can be wrong.");
    lines.push("Fee hurdle excludes spread, slippage, taxes and price gaps. SELL WATCH does not prove a position is profitable.");
    lines.push("Advisory only: no orders are created; wallet and fixed safeguards remain unchanged.");
    out.textContent = lines.join("\n");
  }

  function render() {
    const out = insights();
    const status = $("learningStatus");
    const details = $("learningDetails");
    compareStrategies();
    estimateSignals();
    if (!status || !details) return;
    status.textContent = out.message;
    if (!out.latest) {
      details.textContent = "The learning journal starts collecting checkpoints as the paper dashboard updates. It does not change orders or risk controls.";
      return;
    }
    details.textContent = [
      "Observed change since first checkpoint: " + (out.change >= 0 ? "+" : "") + eur(out.change),
      "Current drawdown from observed peak: " + (out.drawdown * 100).toFixed(2) + "%",
      "Saved checkpoints: " + out.points.length,
      "Learning notes:",
      ...out.lessons.map((s, i) => (i + 1) + ". " + s),
      "Fixed safeguards: €50 max order · €250 max exposure · €10 daily-loss threshold · 0.20% illustrative fee.",
      "No automatic strategy changes, no real orders, and no forecasts."
    ].join("\n");
  }

  window.AgentLearning = Object.freeze({ observe, render, compareStrategies, estimateSignals });
  document.addEventListener("DOMContentLoaded", render);
})();