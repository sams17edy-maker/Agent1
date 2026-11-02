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
      return value;
    } catch {
      return { sessions: [], reviews: 0 };
    }
  }

  function observe(data) {
    if (!data || !Number.isFinite(data.equity) || !Number.isFinite(data.cash) ||
        !Number.isFinite(data.exposure) || !Number.isFinite(data.orderCount) ||
        !Number.isFinite(data.fees) || !Number.isFinite(data.time)) return;
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

  function render() {
    const out = insights();
    const status = $("learningStatus");
    const details = $("learningDetails");
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

  window.AgentLearning = Object.freeze({ observe, render });
  document.addEventListener("DOMContentLoaded", render);
})();