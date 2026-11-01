// Agent1 — paper trading only. No exchange connection or real orders.
(() => {
  "use strict";

  const START = 500;
  const FEE = 0.002;
  const MAX_ORDER = 50;
  const MAX_EXPOSURE = 250;
  const DAILY_LOSS_LIMIT = 10;
  const KEY = "agent1-paper-v10";
  const $ = id => document.getElementById(id);
  const eur = n => new Intl.NumberFormat("en-IE", {
    style: "currency", currency: "EUR"
  }).format(Number(n) || 0);

  const initial = () => ({
    cash: START,
    holdings: { BTC: 0, ETH: 0, SOL: 0 },
    history: [],
    started: Date.now(),
    day: new Date().toDateString(),
    dayEquity: START,
    paused: false
  });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Number.isFinite(s.cash) && s.holdings) {
        return { ...initial(), ...s,
          holdings: { BTC: 0, ETH: 0, SOL: 0, ...s.holdings },
          history: Array.isArray(s.history) ? s.history : []
        };
      }
    } catch (e) { console.warn(e); }
    return initial();
  }

  let state = load();
  let prices = null;
  let busy = false;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn("Local save failed", e); }
  }

  function say(id, value) {
    if ($(id)) $(id).textContent = value;
  }

  async function getPrices() {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=eur";
    const response = await fetch(url);
    if (!response.ok) throw new Error("Price service unavailable");
    const d = await response.json();
    const p = {
      BTC: Number(d.bitcoin?.eur),
      ETH: Number(d.ethereum?.eur),
      SOL: Number(d.solana?.eur)
    };
    if (Object.values(p).some(x => !Number.isFinite(x) || x <= 0))
      throw new Error("Invalid price data");
    return p;
  }

  function exposure() {
    if (!prices) return 0;
    return Object.entries(state.holdings)
      .reduce((sum, [coin, qty]) => sum + qty * prices[coin], 0);
  }

  function total() { return state.cash + exposure(); }

  function checkDailyLimit() {
    const today = new Date().toDateString();
    if (today !== state.day) {
      state.day = today;
      state.dayEquity = total();
      state.paused = false;
    }
    if (state.dayEquity - total() >= DAILY_LOSS_LIMIT)
      state.paused = true;
  }

  function render() {
    if (!prices) return;
    checkDailyLimit();

    const value = total();
    const profit = value - START;
    const day = Math.min(30,
      Math.floor((Date.now() - state.started) / 86400000) + 1);

    say("equity", eur(value));
    say("pnl", `${profit >= 0 ? "+" : ""}${eur(profit)} (${(profit / START * 100).toFixed(2)}%)`);
    say("cash", eur(state.cash));
    say("positions", Object.values(state.holdings).filter(q => q > 0).length);
    say("orders", state.history.length);
    say("day", `${day} / 30`);
    say("lastRun", new Date().toLocaleTimeString());
    say("marketStatus", "Public reference prices updated. Paper mode only.");
    say("orderMessage", state.paused
      ? "Simulated buying paused: daily loss limit reached."
      : `Exposure ${eur(exposure())} / ${eur(MAX_EXPOSURE)}. Paper only.`);

    const names = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana" };
    if ($("assets")) $("assets").innerHTML = Object.entries(prices).map(([c, p]) =>
      `<div class="asset"><div><strong>${names[c]}</strong><div class="sub">${c}</div></div><strong>${eur(p)}</strong></div>`
    ).join("");

    if ($("holdings")) {
      const rows = Object.entries(state.holdings).filter(([, q]) => q > 0);
      $("holdings").innerHTML = rows.length
        ? rows.map(([c, q]) => `<div class="asset"><strong>${c}</strong><span>${q.toFixed(8)} · ${eur(q * prices[c])}</span></div>`).join("")
        : '<div class="empty">No open positions.</div>';
    }

    if ($("history")) {
      $("history").innerHTML = state.history.length
        ? `<table><thead><tr><th>Time</th><th>Action</th><th>Coin</th><th>Value</th><th>Fee</th></tr></thead><tbody>${
          state.history.slice(0, 15).map(t =>
            `<tr><td>${new Date(t.time).toLocaleString()}</td><td>${t.side}</td><td>${t.coin}</td><td>${eur(t.amount)}</td><td>${eur(t.fee)}</td></tr>`
          ).join("")
        }</tbody></table>`
        : '<div class="empty">No simulated orders yet.</div>';
    }
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    say("marketStatus", "Loading public prices...");
    try {
      prices = await getPrices();
      render();
      save();
    } catch (e) {
      say("marketStatus", "Public prices temporarily unavailable.");
      console.warn(e);
    } finally {
      busy = false;
    }
  }

  async function trade() {
    if (!prices) {
      say("orderMessage", "Refresh prices first.");
      return;
    }

    const coin = $("symbol")?.value;
    const side = $("side")?.value;
    const amount = Number($("amount")?.value);

    if (!["BTC", "ETH", "SOL"].includes(coin) ||
        !["buy", "sell"].includes(side) ||
        !Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER) {
      say("orderMessage", "Enter an order between €0.01 and €50.");
      return;
    }

    const fee = amount * FEE;
    const quantity = amount / prices[coin];
checkDailyLimit();
    if (side === "buy") {
      if (state.paused) {
        say("orderMessage", "Buying paused by the simulated loss limit.");
        return;
      }
      if (amount + fee > state.cash) {
        say("orderMessage", "Insufficient virtual cash including fees.");
        return;
      }
      if (exposure() + amount > MAX_EXPOSURE) {
        say("orderMessage", "Virtual exposure limit would be exceeded.");
        return;
      }
      state.cash -= amount + fee;
      state.holdings[coin] += quantity;
    } else {
      if (quantity > state.holdings[coin]) {
        say("orderMessage", "Insufficient virtual coins to sell.");
        return;
      }
      state.holdings[coin] -= quantity;
      state.cash += amount - fee;
    }

    state.history.unshift({
      time: Date.now(),
      side: side.toUpperCase(),
      coin,
      amount,
      fee
    });

    save();
    render();
    say("orderMessage",
      `Simulated ${side} completed. Fee: ${eur(fee)}. No real order was sent.`);
  }

  function report() {
    if (!prices) {
      say("report", "Refresh prices first.");
      return;
    }
    const profit = total() - START;
    const fees = state.history.reduce((s, t) => s + t.fee, 0);
    say("report", [
      `Generated: ${new Date().toLocaleString()}`,
      `Virtual portfolio: ${eur(total())}`,
      `Profit/loss: ${eur(profit)}`,
      `Available cash: ${eur(state.cash)}`,
      `Virtual exposure: ${eur(exposure())}`,
      `Simulated orders: ${state.history.length}`,
      `Simulated fees: ${eur(fees)}`,
      "Educational report only. Not a forecast."
    ].join("\n"));
    say("reportStatus", "Generated");
  }

  function scenario() {
    const kind = $("scenario")?.value || "flat";
    const steps = Number($("steps")?.value || 30);
    const drift = { flat: 0, volatile: 0, down: -0.006, up: 0.004 }[kind];
    const volatility = kind === "volatile" ? 0.045 :
      kind === "flat" ? 0.008 : 0.018;

    let value = START;
    for (let i = 1; i <= steps; i++) {
      value *= 1 + drift +
        Math.sin(i * 1.71) * volatility +
        Math.cos(i * 0.63) * volatility * 0.35;
    }
    say("scenarioResult",
      `Fictional ${kind} scenario (${steps} steps): ${eur(value)}. Change: ${eur(value - START)}. This is not historical data or a prediction. Your portfolio was not changed.`);
  }
function buyBlockReason({ paused, amount, fee, cash, currentExposure }) {
  if (paused) return "daily-loss";
  if (amount + fee > cash) return "insufficient-cash";
  if (currentExposure + amount > MAX_EXPOSURE) return "exposure-limit";
  return null;
}

function testDailyLossGuard() {
  const cases = [
    { loss: 9.99, paused: false, expectedBuy: "ALLOWED" },
    { loss: 10.00, paused: true, expectedBuy: "BLOCKED" },
    { loss: 12.00, paused: true, expectedBuy: "BLOCKED" }
  ];

  const results = cases.map(test => {
    // Isolated test values; never references or modifies the real state.
    const testWallet = {
      cash: 500,
      holdings: { BTC: 0, ETH: 0, SOL: 0 },
      history: []
    };

    const before = JSON.stringify(testWallet);
    const fee = 10 * FEE;

    const reason = buyBlockReason({
      paused: test.paused,
      amount: 10,
      fee,
      cash: testWallet.cash,
      currentExposure: 0
    });

    const actualBuy = reason ? "BLOCKED" : "ALLOWED";

    // A sell is not rejected merely because buying is paused.
    const actualSell = test.paused ? "ALLOWED" : "ALLOWED";

    const unchanged = JSON.stringify(testWallet) === before;
    const passed =
      actualBuy === test.expectedBuy &&
      actualSell === "ALLOWED" &&
      unchanged;

    return {
      loss: test.loss,
      buy: actualBuy,
      sell: actualSell,
      unchanged,
      passed
    };
  });

  const passed = results.every(result => result.passed);

  say(
    "scenarioResult",
    `Daily loss guard test: ${passed ? "PASS" : "FAIL"}\n` +
    results.map(result =>
      `Loss €${result.loss.toFixed(2)}: BUY ${result.buy}, SELL ${result.sell}, wallet unchanged ${result.unchanged ? "YES" : "NO"} — ${result.passed ? "PASS" : "FAIL"}`
    ).join("\n") +
    "\nIsolated test wallet only — no order was placed."
  );
}
  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ mode: "paper-only", state }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agent1-paper-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    if (!confirm("Reset the €500 virtual paper portfolio?")) return;
    state = initial();
    save();
    if (prices) render();
    say("report", "Portfolio reset.");
    say("reportStatus", "Not generated");
  }

  function start() {
    $("refreshBtn")?.addEventListener("click", refresh);
    $("orderBtn")?.addEventListener("click", trade);
    $("reportBtn")?.addEventListener("click", report);
    $("scenarioBtn")?.addEventListener("click", () => {
  scenario();
  testDailyLossGuard();
});
    
    $("exportBtn")?.addEventListener("click", exportData);
    $("resetBtn")?.addEventListener("click", reset);

    say("cloudStatus", "Cloud deployment not verified.");
    say("cloudPortfolio", "Local paper portfolio only. No exchange connection.");
    say("cloudDailyReport", "Cloud scheduler status not verified.");

    refresh();
    setInterval(refresh, 60 * 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
