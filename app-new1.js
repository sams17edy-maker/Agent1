// Agent1 — paper trading only. No exchange connection or real orders.
(() => {
  "use strict";

  const START = 500;
  const FEE = 0.002;
  const MAX_ORDER = 50;
  const MAX_EXPOSURE = 250;
  const DAILY_LOSS_LIMIT = 10;
  const MAX_PRICE_AGE_MS = 2 * 60 * 60 * 1000;
  const KEY = "agent1-paper-v10";
  const $ = id => document.getElementById(id);
  const eur = n => new Intl.NumberFormat("en-IE", {
    style: "currency", currency: "EUR"
  }).format(Number(n) || 0);

  const initial = () => ({
    cash: START,
    holdings: { BTC: 0, ETH: 0, SOL: 0 },
    history: [],
    portfolioHistory: [{ time: Date.now(), value: START }],
    started: Date.now(),
    day: new Date().toDateString(),
    dayEquity: START,
    paused: false
  });

  function validSavedState(s, now = Date.now()) {
    if (!s || typeof s !== "object" || Array.isArray(s) || !Number.isFinite(now)) return false;
    if (!Number.isFinite(s.cash) || s.cash < 0) return false;
    if (!s.holdings || typeof s.holdings !== "object" || Array.isArray(s.holdings)) return false;
    const supportedCoins = ["BTC", "ETH", "SOL"];
    if (Object.keys(s.holdings).some(c => !supportedCoins.includes(c))) return false;
    if (!supportedCoins.every(c =>
      Number.isFinite(s.holdings[c] ?? 0) && (s.holdings[c] ?? 0) >= 0)) return false;
    if (!Array.isArray(s.history) || s.history.length > 10000) return false;
    // Older saves may not contain portfolioHistory; when present, validate every point.
    if (s.portfolioHistory !== undefined &&
        (!Array.isArray(s.portfolioHistory) || s.portfolioHistory.length > 10000 ||
         !s.portfolioHistory.every(p => p && Number.isFinite(p.time) && p.time > 0 &&
           p.time <= now && Number.isFinite(p.value) && p.value >= 0))) return false;
    if (!Number.isFinite(s.started) || s.started <= 0 || s.started > now) return false;
    if (typeof s.day !== "string" || !Number.isFinite(s.dayEquity) || s.dayEquity < 0) return false;
    if (typeof s.paused !== "boolean") return false;
    if (!s.history.every(t => t && Number.isFinite(t.time) &&
      t.time > 0 && t.time <= now &&
      ["BUY", "SELL"].includes(t.side) && ["BTC", "ETH", "SOL"].includes(t.coin) &&
      Number.isFinite(t.amount) && t.amount > 0 && t.amount <= MAX_ORDER &&
      Number.isFinite(t.fee) && t.fee >= 0 &&
      t.fee <= t.amount * FEE + 1e-9)) return false;
    // Transactions are stored newest-first; reject timestamps out of that order.
    if (s.history.some((t, i, a) => i > 0 && t.time > a[i - 1].time)) return false;
    // Portfolio snapshots are stored oldest-first.
    if (Array.isArray(s.portfolioHistory) &&
        s.portfolioHistory.some((p, i, a) => i > 0 && p.time < a[i - 1].time)) return false;
    return true;
  }

  // Pure recovery helper: validates a supplied serialized snapshot without touching browser storage.
  function recoverSnapshot(raw, now = Date.now()) {
    if (raw == null) return { recovered: false, reason: "missing" };
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return { recovered: true, reason: "malformed-json", state: initial() }; }
    if (!validSavedState(parsed, now)) {
      return { recovered: true, reason: "invalid-state", state: initial() };
    }
    return {
      recovered: false,
      reason: "valid",
      state: {
        ...initial(),
        ...parsed,
        holdings: { BTC: 0, ETH: 0, SOL: 0, ...parsed.holdings },
        history: [...parsed.history]
      }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return initial();
      const s = JSON.parse(raw);
      if (!validSavedState(s)) {
        console.warn("Saved paper portfolio is invalid; safely starting a fresh virtual portfolio.");
        return initial();
      }
      return {
        ...initial(),
        ...s,
        holdings: { BTC: 0, ETH: 0, SOL: 0, ...s.holdings },
        history: [...s.history]
      };
    } catch (e) {
      console.warn("Saved paper portfolio could not be read; safely starting fresh.", e);
      return initial();
    }
  }

  let state = load();
  let prices = null;
  let pricesUpdatedAt = null;
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

  function pricesUsable(quote, updatedAt, now = Date.now()) {
    return !!quote && ["BTC", "ETH", "SOL"].every(c => Number.isFinite(quote[c]) && quote[c] > 0) && Number.isFinite(updatedAt) && updatedAt <= now && now - updatedAt <= MAX_PRICE_AGE_MS;
  }

  function exposure() {
    if (!prices) return 0;
    return ["BTC", "ETH", "SOL"]
      .reduce((sum, coin) => sum + (state.holdings[coin] || 0) * prices[coin], 0);
  }

  function total() { return state.cash + exposure(); }

  function dailyLimitState(previous, equity, today) {
    if (!previous || previous.day !== today) {
      return { day: today, dayEquity: equity, paused: false };
    }
    return {
      day: previous.day,
      dayEquity: previous.dayEquity,
      paused: previous.paused || previous.dayEquity - equity >= DAILY_LOSS_LIMIT
    };
  }

  function checkDailyLimit() {
    const next = dailyLimitState(state, total(), new Date().toDateString());
    state.day = next.day;
    state.dayEquity = next.dayEquity;
    state.paused = next.paused;
  }

  function recordPortfolioSnapshot() {
    if (!prices) return;
    const now = Date.now();
    const value = total();
    if (!Array.isArray(state.portfolioHistory)) state.portfolioHistory = [];
    const last = state.portfolioHistory[state.portfolioHistory.length - 1];
    if (!last || now - last.time >= 60000) {
      state.portfolioHistory.push({ time: now, value });
      if (state.portfolioHistory.length > 31) state.portfolioHistory = state.portfolioHistory.slice(-31);
      save();
    }
  }

  function drawPortfolioHistory() {
    const canvas = $("chart");
    if (!canvas || !Array.isArray(state.portfolioHistory) || !state.portfolioHistory.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height, pad = 22;
    ctx.clearRect(0, 0, w, h);
    const points = state.portfolioHistory.slice(-31);
    const vals = points.map(p => p.value);
    const lo = Math.min(...vals, START) - 1, hi = Math.max(...vals, START) + 1;
    ctx.strokeStyle = "#26364d"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, h-pad); ctx.lineTo(w-pad, h-pad); ctx.stroke();
    ctx.strokeStyle = "#43d39e"; ctx.lineWidth = 3; ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad + (points.length <= 1 ? 0 : i * (w - 2*pad) / (points.length - 1));
      const y = h-pad - ((p.value-lo)/(hi-lo))*(h-2*pad);
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.fillStyle = "#9aabc2"; ctx.font = "12px system-ui";
    ctx.fillText(`${points.length} minute snapshots`, pad, 14);
    ctx.fillText(eur(points[points.length-1].value), w-pad-90, 14);
  }

  function render() {
    if (!prices) return;
    checkDailyLimit();
    recordPortfolioSnapshot();

    const value = total();
    const profit = value - START;
    window.AgentLearning?.observe({
      time: Date.now(), equity: value, cash: state.cash,
      exposure: exposure(), orderCount: state.history.length,
      fees: state.history.reduce((sum, order) => sum + order.fee, 0),
      prices
    });
    const elapsedMinutes = Math.min(30,
      Math.floor((Date.now() - state.started) / 60000));

    say("equity", eur(value));
    say("pnl", `${profit >= 0 ? "+" : ""}${eur(profit)} (${(profit / START * 100).toFixed(2)}%)`);
    say("cash", eur(state.cash));
    say("positions", Object.values(state.holdings).filter(q => q > 0).length);
    say("orders", state.history.length);
    say("day", `${elapsedMinutes} / 30 min`);
    if (elapsedMinutes >= 30) say("marketStatus", "30-minute paper experiment complete. No real orders were placed.");
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

    drawPortfolioHistory();
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
      const fresh = await getPrices();
      prices = fresh;
      pricesUpdatedAt = Date.now();
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
    const supportedCoins = ["BTC", "ETH", "SOL"];
    if (!wallet || !wallet.holdings || typeof wallet.holdings !== "object" ||
        Array.isArray(wallet.holdings) ||
        Object.keys(wallet.holdings).some(c => !supportedCoins.includes(c)) || !quote ||
        !Number.isFinite(wallet.cash) || wallet.cash < 0 ||
        !supportedCoins.every(c =>
          Number.isFinite(wallet.holdings[c] ?? 0) && (wallet.holdings[c] ?? 0) >= 0 &&
          Number.isFinite(quote[c]) && quote[c] > 0) ||
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
    const currentExposure = ["BTC", "ETH", "SOL"]
      .reduce((sum, c) => sum + (next.holdings[c] || 0) * quote[c], 0);

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
    if (!pricesUsable(prices, pricesUpdatedAt)) {
      say("orderMessage", "Prices missing, invalid, or stale. Refresh prices before placing a paper order.");
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
    const lines = [];
    const check = (name, passed) => lines.push(`${name}: ${passed ? "PASS" : "FAIL"}`);

    // Exercise the real daily-loss calculation against portfolio equity.
    const testPrices = { BTC: 10, ETH: 2, SOL: 1 };
    const baseline = { day: "test-day", dayEquity: 500, paused: false };
    const lossCases = [
      { equity: 490.01, expectedPaused: false, label: "€9.99 loss" },
      { equity: 490.00, expectedPaused: true, label: "€10.00 loss" },
      { equity: 488.00, expectedPaused: true, label: "€12.00 loss" }
    ];
    for (const item of lossCases) {
      const calculated = dailyLimitState(baseline, item.equity, "test-day");
      const wallet = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
      const buy = processPaperOrder({ wallet, prices: testPrices, side: "buy", coin: "ETH", amount: 10, paused: calculated.paused });
      const sellWallet = { cash: 0, holdings: { BTC: 2, ETH: 0, SOL: 0 }, history: [] };
      const sell = processPaperOrder({ wallet: sellWallet, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: calculated.paused });
      check(`Daily-loss calculation ${item.label}`,
        calculated.paused === item.expectedPaused &&
        buy.ok === !item.expectedPaused && sell.ok);
    }
    const stickyPause = dailyLimitState(
      dailyLimitState(baseline, 490, "test-day"), 499, "test-day"
    );
    check("Daily-loss pause remains active after recovery",
      stickyPause.paused === true);
    const nextDay = dailyLimitState(
      dailyLimitState(baseline, 490, "test-day"), 500, "next-day"
    );
    check("New day resets loss baseline and pause",
      nextDay.day === "next-day" && nextDay.dayEquity === 500 && !nextDay.paused);

    // Order engine must independently reject unsupported or malformed holding maps.
    const unknownHolding = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0, DOGE: 1 }, history: [] };
    const unknownHoldingOrder = processPaperOrder({ wallet: unknownHolding, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejects unsupported wallet holding",
      !unknownHoldingOrder.ok && unknownHoldingOrder.reason === "invalid-order");
    const arrayHoldings = { cash: 500, holdings: [], history: [] };
    const arrayHoldingOrder = processPaperOrder({ wallet: arrayHoldings, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejects array instead of holding map",
      !arrayHoldingOrder.ok && arrayHoldingOrder.reason === "invalid-order");

    // Invalid / oversized order.
    const base = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const oversized = processPaperOrder({ wallet: base, prices: testPrices, side: "buy", coin: "BTC", amount: 50.01, paused: false });
    check("Order above €50 rejected", !oversized.ok && oversized.reason === "invalid-order");

    // Cash guard includes the fee.
    const poor = { cash: 5, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const noCash = processPaperOrder({ wallet: poor, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Insufficient virtual cash rejected", !noCash.ok && noCash.reason === "insufficient-cash" && JSON.stringify(poor) === JSON.stringify({ cash: 5, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] }));

    // Existing €245 exposure plus €10 order must exceed the €250 cap.
    const exposed = { cash: 500, holdings: { BTC: 24.5, ETH: 0, SOL: 0 }, history: [] };
    const exposureBlock = processPaperOrder({ wallet: exposed, prices: testPrices, side: "buy", coin: "ETH", amount: 10, paused: false });
    check("Exposure cap enforced", !exposureBlock.ok && exposureBlock.reason === "exposure-limit");

    // Exact exposure boundary and fee-inclusive cash boundary.
    const atCap = { cash: 500, holdings: { BTC: 24, ETH: 0, SOL: 0 }, history: [] };
    const capOrder = processPaperOrder({ wallet: atCap, prices: testPrices, side: "buy", coin: "ETH", amount: 10, paused: false });
    check("Order reaching exactly €250 exposure accepted",
      capOrder.ok && Math.abs(
        Object.entries(capOrder.next.holdings).reduce((sum, [coin, qty]) => sum + qty * testPrices[coin], 0) - 250
      ) < 1e-9);
    check("Successful order does not mutate source wallet",
      atCap.cash === 500 && atCap.holdings.BTC === 24 && atCap.history.length === 0);

    const exactCash = { cash: 10.02, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const exactCashOrder = processPaperOrder({ wallet: exactCash, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Cash exactly covering order plus fee accepted",
      exactCashOrder.ok && Math.abs(exactCashOrder.next.cash) < 1e-9);
    const shortCash = { cash: 10.019, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const shortCashOrder = processPaperOrder({ wallet: shortCash, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Cash short by €0.001 rejected",
      !shortCashOrder.ok && shortCashOrder.reason === "insufficient-cash");

    // Fee calculations and balances on successful isolated orders.
    const feeWallet = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const buy = processPaperOrder({ wallet: feeWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    const sell = buy.ok ? processPaperOrder({ wallet: buy.next, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: false }) : { ok: false };
    check("Buy/sell fee math (0.2% each)", buy.ok && Math.abs(buy.fee - 0.02) < 1e-9 && Math.abs(buy.next.cash - 489.98) < 1e-9 && sell.ok && Math.abs(sell.fee - 0.02) < 1e-9 && Math.abs(sell.next.cash - 499.96) < 1e-9);

    const empty = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const noCoins = processPaperOrder({ wallet: empty, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: false });
    check("Sell without sufficient coins rejected", !noCoins.ok && noCoins.reason === "insufficient-coins" && JSON.stringify(empty) === JSON.stringify({ cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] }));

    // Portfolio accounting: equity equals cash plus marked holdings, and fees reduce equity exactly.
    const accountingWallet = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const equity = wallet => wallet.cash + Object.entries(wallet.holdings)
      .reduce((sum, [coin, qty]) => sum + qty * testPrices[coin], 0);
    const accountingBuy = processPaperOrder({ wallet: accountingWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    const buyEquity = accountingBuy.ok ? equity(accountingBuy.next) : NaN;
    const accountingSell = accountingBuy.ok ? processPaperOrder({ wallet: accountingBuy.next, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: false }) : { ok: false };
    const sellEquity = accountingSell.ok ? equity(accountingSell.next) : NaN;
    check("Portfolio accounting after buy (€499.98)", accountingBuy.ok && Math.abs(buyEquity - 499.98) < 1e-9);
    check("Portfolio accounting after round trip (€499.96)", accountingSell.ok && Math.abs(sellEquity - 499.96) < 1e-9 && accountingSell.next.holdings.BTC === 0);
    check("Accounting tests leave main portfolio unchanged", JSON.stringify(state) === JSON.stringify(load()));

    // Feed validation: fail closed on missing, malformed, stale, or future quotes.
    const fixedNow = 1000000;
    check("Missing price feed rejected", !pricesUsable(null, fixedNow, fixedNow));
    check("Invalid price feed rejected", !pricesUsable({ BTC: 10, ETH: 0, SOL: 1 }, fixedNow, fixedNow));
    check("Stale price feed (>2 hours) rejected", !pricesUsable(testPrices, fixedNow - MAX_PRICE_AGE_MS - 1, fixedNow));
    check("Fresh price feed accepted", pricesUsable(testPrices, fixedNow, fixedNow));
    check("Future-dated price feed rejected", !pricesUsable(testPrices, fixedNow + 1, fixedNow));
    const invalidQuoteOrder = processPaperOrder({ wallet: base, prices: { BTC: 10, ETH: NaN, SOL: 1 }, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejected with malformed quote", !invalidQuoteOrder.ok && invalidQuoteOrder.reason === "invalid-order");

    // Wallet integrity: malformed balances and holdings must never create NaN or negative state.
    const badCash = { cash: NaN, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const badCashOrder = processPaperOrder({ wallet: badCash, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejected with invalid virtual cash", !badCashOrder.ok && badCashOrder.reason === "invalid-order");
    const negativeHolding = { cash: 500, holdings: { BTC: -1, ETH: 0, SOL: 0 }, history: [] };
    const negativeHoldingOrder = processPaperOrder({ wallet: negativeHolding, prices: testPrices, side: "sell", coin: "BTC", amount: 1, paused: false });
    check("Order rejected with negative holding", !negativeHoldingOrder.ok && negativeHoldingOrder.reason === "invalid-order");
    const negativeCash = { cash: -1, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const negativeCashOrder = processPaperOrder({ wallet: negativeCash, prices: testPrices, side: "buy", coin: "BTC", amount: 1, paused: false });
    check("Order rejected with negative virtual cash", !negativeCashOrder.ok && negativeCashOrder.reason === "invalid-order");

    // Order boundaries: exact maximum and smallest positive amount are valid when wallet limits permit.
    const maxWallet = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const maxOrder = processPaperOrder({ wallet: maxWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 50, paused: false });
    check("Exact €50 order accepted", maxOrder.ok && Math.abs(maxOrder.next.cash - 449.90) < 1e-9);
    const tinyWallet = { cash: 500, holdings: { BTC: 0, ETH: 0, SOL: 0 }, history: [] };
    const tinyOrder = processPaperOrder({ wallet: tinyWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 0.01, paused: false });
    check("Small positive order accepted", tinyOrder.ok && Math.abs(tinyOrder.fee - 0.00002) < 1e-12);
    const zeroOrder = processPaperOrder({ wallet: tinyWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 0, paused: false });
    check("Zero-value order rejected", !zeroOrder.ok && zeroOrder.reason === "invalid-order");

    // Persistence/recovery tests use serialized fixtures only; they never read or write localStorage.
    const fixture = initial();
    const validRaw = JSON.stringify(fixture);
    const validRecovery = recoverSnapshot(validRaw, Date.now());
    check("Valid saved snapshot preserved", !validRecovery.recovered &&
      validRecovery.state.cash === fixture.cash &&
      JSON.stringify(validRecovery.state.holdings) === JSON.stringify(fixture.holdings));
    const malformedRecovery = recoverSnapshot("{not-json", Date.now());
    check("Malformed saved JSON safely recovers", malformedRecovery.recovered &&
      malformedRecovery.state.cash === START &&
      malformedRecovery.state.history.length === 0);
    const invalidRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, cash: -4
    }), Date.now());
    check("Invalid saved balance safely recovers", invalidRecovery.recovered &&
      invalidRecovery.state.cash === START);
    const negativeQtyRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, holdings: { BTC: -1, ETH: 0, SOL: 0 }
    }), Date.now());
    check("Negative saved holding safely recovers", negativeQtyRecovery.recovered &&
      negativeQtyRecovery.state.holdings.BTC === 0);
    const corruptHistoryRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, history: [{ side: "BUY", coin: "DOGE", amount: NaN, fee: -1, time: "bad" }]
    }), Date.now());
    check("Corrupt saved history safely recovers", corruptHistoryRecovery.recovered &&
      corruptHistoryRecovery.state.history.length === 0);
    const unknownCoinRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, holdings: { BTC: 0, ETH: 0, SOL: 0, DOGE: 1000000 }
    }), Date.now());
    check("Unknown saved coin safely recovers",
      unknownCoinRecovery.recovered && !("DOGE" in unknownCoinRecovery.state.holdings));
    const futureHistoryRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, history: [{ time: Date.now() + 60000, side: "BUY", coin: "BTC", amount: 10, fee: 0.02 }]
    }), Date.now());
    check("Future-dated saved order safely recovers",
      futureHistoryRecovery.recovered && futureHistoryRecovery.state.history.length === 0);
    const excessiveFeeRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, history: [{ time: Date.now(), side: "BUY", coin: "BTC", amount: 10, fee: 5 }]
    }), Date.now());
    check("Saved order with excessive fee safely recovers",
      excessiveFeeRecovery.recovered && excessiveFeeRecovery.state.history.length === 0);
    const oversizedHistoryOrderRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, history: [{ time: Date.now(), side: "BUY", coin: "BTC", amount: 50.01, fee: 0.10002 }]
    }), Date.now());
    check("Saved order above €50 safely recovers",
      oversizedHistoryOrderRecovery.recovered && oversizedHistoryOrderRecovery.state.history.length === 0);
    const malformedPortfolioHistory = recoverSnapshot(JSON.stringify({
      ...fixture, portfolioHistory: [{ time: Date.now(), value: NaN }]
    }), Date.now());
    check("Malformed portfolio history safely recovers",
      malformedPortfolioHistory.recovered &&
      malformedPortfolioHistory.state.portfolioHistory.length === 1 &&
      malformedPortfolioHistory.state.portfolioHistory[0].value === START);
    const validPortfolioHistory = recoverSnapshot(JSON.stringify({
      ...fixture, portfolioHistory: [{ time: Date.now() - 1000, value: 501 }]
    }), Date.now());
    check("Valid portfolio history is preserved",
      !validPortfolioHistory.recovered &&
      validPortfolioHistory.state.portfolioHistory[0].value === 501);
    const controlledNow = Date.now() - 100000;
    const controlledFutureRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, started: controlledNow + 50000,
      portfolioHistory: [{ time: controlledNow + 50000, value: 500 }]
    }), controlledNow);
    check("Recovery uses supplied reference time for all saved timestamps",
      controlledFutureRecovery.recovered);
    const unorderedTransactions = recoverSnapshot(JSON.stringify({
      ...fixture, history: [
        { time: Date.now() - 1000, side: "BUY", coin: "BTC", amount: 10, fee: 0.02 },
        { time: Date.now(), side: "SELL", coin: "BTC", amount: 10, fee: 0.02 }
      ]
    }), Date.now());
    check("Out-of-order saved transactions safely recover",
      unorderedTransactions.recovered && unorderedTransactions.state.history.length === 0);
    const unorderedSnapshots = recoverSnapshot(JSON.stringify({
      ...fixture, portfolioHistory: [
        { time: Date.now(), value: 500 },
        { time: Date.now() - 1000, value: 501 }
      ]
    }), Date.now());
    check("Out-of-order portfolio snapshots safely recover",
      unorderedSnapshots.recovered && unorderedSnapshots.state.portfolioHistory.length === 1);

    check("Recovery tests leave main portfolio and storage untouched",
      JSON.stringify(state) === JSON.stringify(load()));

    const passed = lines.every(line => line.endsWith("PASS"));
    return `Paper safeguards: ${passed ? "ALL PASS" : "FAIL"}\\n` + lines.join("\\n") +
      "\\nIsolated test wallets only; no real or main-portfolio order was placed.";
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
