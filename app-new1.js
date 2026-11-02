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

  // Shared order engine used by the live paper ticket and isolated tests.
  function processPaperOrder({ wallet, prices: quote, side, coin, amount, paused }) {
    if (!wallet || !wallet.holdings || !quote ||
        !["BTC", "ETH", "SOL"].includes(coin) ||
        !["buy", "sell"].includes(side) ||
        !Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER) {
      return { ok: false, reason: "invalid-order" };
    }

    const next = {
      ...wallet,
      holdings: { BTC: 0, ETH: 0, SOL: 0, ...wallet.holdings },
      history: Array.isArray(wallet.history) ? [...wallet.history] : []
    };
    const fee = amount * FEE;
    const quantity = amount / quote[coin];
    const currentExposure = Object.entries(next.holdings)
      .reduce((sum, [c, qty]) => sum + qty * quote[c], 0);

    if (side === "buy") {
      const reason = buyBlockReason({
        paused, amount, fee, cash: next.cash, currentExposure
      });
      if (reason) return { ok: false, reason };
      next.cash -= amount + fee;
      next.holdings[coin] += quantity;
    } else {
      if (quantity > next.holdings[coin]) {
        return { ok: false, reason: "insufficient-coins" };
      }
      next.holdings[coin] -= quantity;
      next.cash += amount - fee;
    }

    next.history.unshift({
      time: Date.now(), side: side.toUpperCase(), coin, amount, fee
    });
    return { ok: true, next, fee, quantity };
  }

  async function trade() {
    if (!prices) {
      say("orderMessage", "Refresh prices first.");
      return;
    }

    const coin = $("symbol")?.value;
    const side = $("side")?.value;
    const amount = Number($("amount")?.value);
    checkDailyLimit();

    const result = processPaperOrder({
      wallet: state, prices, side, coin, amount, paused: state.paused
    });
    if (!result.ok) {
      const messages = {
        "invalid-order": "Enter a valid order between €0.01 and €50.",
        "daily-loss": "Buying paused by the simulated daily loss limit.",
        "insufficient-cash": "Insufficient virtual cash including fees.",
        "exposure-limit": "Virtual exposure limit would be exceeded.",
        "insufficient-coins": "Insufficient virtual coins to sell."
      };
      say("orderMessage", messages[result.reason] || "Simulated order rejected.");
      return;
    }

    state = { ...state, ...result.next };
    save();
    render();
    say("orderMessage",
      `Simulated ${side} completed. Fee: ${eur(result.fee)}. No real order was sent.`);
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
    return `Fictional ${kind} scenario (${steps} steps): ${eur(value)}. Change: ${eur(value - START)}. Not historical data or a prediction; your portfolio was not changed.`;
  }

  function buyBlockReason({ paused, amount, fee, cash, currentExposure }) {
    if (paused) return "daily-loss";
    if (amount + fee > cash) return "insufficient-cash";
    if (currentExposure + amount > MAX_EXPOSURE) return "exposure-limit";
    return null;
  }

  function testDailyLossGuard() {
    const cases = [
      { loss: 9.99, paused: false, expectedBuy: true },
      { loss: 10.00, paused: true, expectedBuy: false },
      { loss: 12.00, paused: true, expectedBuy: false }
    ];
    const testPrices = { BTC: 10, ETH: 2, SOL: 1 };
    const results = cases.map(({ loss, paused, expectedBuy }) => {
      const wallet = {
        cash: 500, holdings: { BTC: 1, ETH: 0, SOL: 0 }, history: []
      };
      const before = JSON.stringify(wallet);
      const buy = processPaperOrder({
        wallet, prices: testPrices, side: "buy", coin: "ETH",
        amount: 10, paused
      });
      const sell = processPaperOrder({
        wallet, prices: testPrices, side: "sell", coin: "BTC",
        amount: 10, paused
      });
      const rejectedBuyUnchanged = expectedBuy || JSON.stringify(wallet) === before;
      const passed = buy.ok === expectedBuy && sell.ok && rejectedBuyUnchanged;
      return { loss, buy: buy.ok ? "ALLOWED" : "BLOCKED",
        sell: sell.ok ? "ALLOWED" : "BLOCKED", passed };
    });
    const passed = results.every(x => x.passed);
    return `Shared paper-order engine test: ${passed ? "PASS" : "FAIL"}\n` +
      results.map(x => `Loss €${x.loss.toFixed(2)}: BUY ${x.buy}, SELL ${x.sell} — ${x.passed ? "PASS" : "FAIL"}`).join("\n") +
      "\nIsolated test wallet only; no real or main-portfolio order was placed.";
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
      say("scenarioResult", scenario() + "\n\n" + testDailyLossGuard());
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
