// Agent1 — paper trading only. No exchange connection or real orders.
(() => {
  "use strict";

  const START = 500;
  const COINS = Object.freeze({BTC: { name: "Bitcoin", id: "bitcoin" }, ETH: { name: "Ethereum", id: "ethereum" }, SOL: { name: "Solana", id: "solana" }, XRP: { name: "XRP", id: "ripple" }, BNB: { name: "BNB", id: "binancecoin" }, ADA: { name: "Cardano", id: "cardano" }, DOGE: { name: "Dogecoin", id: "dogecoin" }, LINK: { name: "Chainlink", id: "chainlink" }, AVAX: { name: "Avalanche", id: "avalanche-2" }, DOT: { name: "Polkadot", id: "polkadot" }, LTC: { name: "Litecoin", id: "litecoin" }, BCH: { name: "Bitcoin Cash", id: "bitcoin-cash" }, XLM: { name: "Stellar", id: "stellar" }, UNI: { name: "Uniswap", id: "uniswap" }, ATOM: { name: "Cosmos", id: "cosmos" }, NEAR: { name: "NEAR Protocol", id: "near" }, ETC: { name: "Ethereum Classic", id: "ethereum-classic" }, APT: { name: "Aptos", id: "aptos" }, ARB: { name: "Arbitrum", id: "arbitrum" }, OP: { name: "Optimism", id: "optimism" }});
  const COIN_SYMBOLS = Object.keys(COINS);

  const FEE = 0.002;
  const MAX_ORDER = 50;
  const MAX_EXPOSURE = 250;
  const DAILY_LOSS_LIMIT = 10;
  const MAX_PRICE_AGE_MS = 2 * 60 * 1000;
  const MAX_AUTO_QUOTE_AGE_MS = 2 * 60 * 1000;
  const KEY = "agent1-paper-v10";
  const $ = id => document.getElementById(id);
  const eur = n => new Intl.NumberFormat("en-IE", {
    style: "currency", currency: "EUR"
  }).format(Number(n) || 0);

  const initial = () => ({
    cash: START, savings: 0, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])),
    costBasis: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), basisInitialized: false,
    autoTrading: false, autoLastQuoteAt: 0, autoLastAction: "Not started",
    history: [], portfolioHistory: [{ time: Date.now(), value: START }],
    started: Date.now(), day: new Date().toDateString(), dayEquity: START, paused: false
  });

  function validSavedState(s, now = Date.now()) {
    // Allow up to 2 hours of device-clock skew; preserve original transaction timestamps.
    const latestAllowedTime = now + 2 * 60 * 60 * 1000;
    if (!s || typeof s !== "object" || Array.isArray(s) || !Number.isFinite(now)) return false;
    const supportedCoins = COIN_SYMBOLS;
    if (!Number.isFinite(s.cash) || s.cash < 0) return false;
    if (s.savings !== undefined && (!Number.isFinite(s.savings) || s.savings < 0)) return false;
    if (s.basisInitialized !== undefined && typeof s.basisInitialized !== "boolean") return false;
    if (s.autoTrading !== undefined && typeof s.autoTrading !== "boolean") return false;
    if (s.autoLastAction !== undefined && typeof s.autoLastAction !== "string") return false;
    if (s.autoLastQuoteAt !== undefined &&
        (!Number.isFinite(s.autoLastQuoteAt) || s.autoLastQuoteAt < 0 || s.autoLastQuoteAt > latestAllowedTime)) return false;
    if (s.costBasis !== undefined &&
        (!s.costBasis || typeof s.costBasis !== "object" || Array.isArray(s.costBasis) ||
         Object.keys(s.costBasis).some(c => !supportedCoins.includes(c)) ||
         !supportedCoins.every(c => Number.isFinite(s.costBasis[c] ?? 0) && (s.costBasis[c] ?? 0) >= 0))) return false;
    if (!s.holdings || typeof s.holdings !== "object" || Array.isArray(s.holdings)) return false;
    if (Object.keys(s.holdings).some(c => !supportedCoins.includes(c))) return false;
    if (!supportedCoins.every(c =>
      Number.isFinite(s.holdings[c] ?? 0) && (s.holdings[c] ?? 0) >= 0)) return false;
    if (!Array.isArray(s.history) || s.history.length > 10000) return false;
    // Older saves may not contain portfolioHistory; when present, validate every point.
    if (s.portfolioHistory !== undefined &&
        (!Array.isArray(s.portfolioHistory) || s.portfolioHistory.length > 10000 ||
         !s.portfolioHistory.every(p => p && Number.isFinite(p.time) && p.time > 0 &&
           p.time <= latestAllowedTime && Number.isFinite(p.value) && p.value >= 0))) return false;
    if (!Number.isFinite(s.started) || s.started <= 0 || s.started > latestAllowedTime) return false;
    if (typeof s.day !== "string" || !Number.isFinite(s.dayEquity) || s.dayEquity < 0) return false;
    if (typeof s.paused !== "boolean") return false;
    if (!s.history.every(t => t && Number.isFinite(t.time) &&
      t.time > 0 && t.time <= latestAllowedTime &&
      ["BUY", "SELL"].includes(t.side) && COIN_SYMBOLS.includes(t.coin) &&
      Number.isFinite(t.amount) && t.amount > 0 && t.amount <= MAX_ORDER &&
      Number.isFinite(t.fee) && t.fee >= 0 &&
      t.fee <= t.amount * FEE + 1e-9 &&
      (t.realizedNet === undefined || Number.isFinite(t.realizedNet)) &&
      (t.savingsTransfer === undefined || (Number.isFinite(t.savingsTransfer) && t.savingsTransfer >= 0)) &&
      (t.soldBasis === undefined || (Number.isFinite(t.soldBasis) && t.soldBasis >= 0)))) return false;
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
        holdings: { ...initial().holdings, ...parsed.holdings },
        history: [...parsed.history]
      }
    };
  }

  let loadWarning = "";
  let saveWarning = "";
  function preserveUnreadableSave(raw, reason) {
    try {
      if (raw !== null) localStorage.setItem(KEY + "-recovery", JSON.stringify({ savedAt: Date.now(), reason, raw }));
    } catch (e) { console.error("Could not preserve recovery copy of paper wallet.", e); }
    loadWarning = "⚠️ Saved paper data could not be validated. Recovery copy attempted. Do not place orders or reset; export/contact support first.";
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return initial();
      const s = JSON.parse(raw);
      if (!validSavedState(s)) {
        preserveUnreadableSave(raw, "invalid-state");
        console.error("Saved paper portfolio failed validation; original payload preserved for recovery.");
        return initial();
      }
      return { ...initial(), ...s, holdings: { ...initial().holdings, ...s.holdings }, history: [...s.history] };
    } catch (e) {
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch {}
      preserveUnreadableSave(raw, "read-or-parse-error");
      console.error("Saved paper portfolio could not be read; recovery copy attempted.", e);
      return initial();
    }
  }

  let state = load();
  let prices = null;
  let pricesUpdatedAt = null;
  let priceTimestamps = {};
  let consecutivePriceFailures = 0;
  let nextPriceRetryAt = 0;
  let busy = false;
  const speedStats = { fetchMs: null, lastQuoteAt: null, decisionMs: null, lastCycleMs: null, lastCycleStarted: null, lastError: null };
  function renderSpeedMonitor() {
    const el = $("speedMonitor"); if (!el) return;
    const age = speedStats.lastQuoteAt == null ? "—" : ((Date.now()-speedStats.lastQuoteAt)/1000).toFixed(1)+" s ago";
    el.innerHTML = [["Quote request",speedStats.fetchMs==null?"Waiting":speedStats.fetchMs.toFixed(0)+" ms"],["Last quote",age],["Local decision",speedStats.decisionMs==null?"Waiting":speedStats.decisionMs.toFixed(1)+" ms"],["Refresh interval",speedStats.lastCycleMs==null?"—":(speedStats.lastCycleMs/1000).toFixed(1)+" s"],["Status",speedStats.lastError|| (state.autoTrading?"AutoTrade ON · paper-only":"AutoTrade OFF")]].map(([k,v])=>'<div class="asset"><span class="sub">'+k+'</span><strong>'+v+'</strong></div>').join("");
  }
  function ensureSpeedMonitor() {
    if ($("speedMonitor")) return;
    const main=document.querySelector("main"); if(!main)return;
    const section=document.createElement("section"); section.className="panel wide";
    section.innerHTML='<div class="row"><strong>Speed monitor</strong><span class="pill">PAPER DIAGNOSTICS</span></div><p class="sub">Measures app quote-request and local decision time. Request speed does not guarantee fresh upstream prices.</p><div id="speedMonitor"></div>';
    main.insertBefore(section,main.firstChild); renderSpeedMonitor();
  }

  function ensurePerformanceMonitor() {
    if ($("performanceMonitor")) return;
    const main = document.querySelector("main"); if (!main) return;
    const section = document.createElement("section");
    section.className = "panel wide";
    section.innerHTML = '<div class="row"><strong>Trade performance</strong><span class="pill">PAPER ACCOUNTING</span></div><p class="sub">Profit and loss includes simulated fees. Open-position results are estimates using the latest public reference quotes.</p><div id="performanceMonitor" class="grid"></div>';
    const speed = main.querySelector("#speedMonitor")?.closest("section");
    if (speed?.nextSibling) main.insertBefore(section, speed.nextSibling);
    else if (speed) main.appendChild(section);
    else main.insertBefore(section, main.firstChild);
  }

  function performanceMetrics() {
    const realized = state.history.reduce((sum, order) =>
      sum + (order.side === "SELL" && Number.isFinite(order.realizedNet) ? order.realizedNet : 0), 0);
    const fees = state.history.reduce((sum, order) => sum + (Number(order.fee) || 0), 0);
    const transferred = state.history.reduce((sum, order) =>
      sum + (Number.isFinite(order.savingsTransfer) ? order.savingsTransfer : 0), 0);
    let unrealized = 0;
    for (const coin of COIN_SYMBOLS) {
      const quantity = state.holdings[coin] || 0;
      if (quantity > 0 && Number.isFinite(prices?.[coin]) && Number.isFinite(state.costBasis?.[coin])) {
        unrealized += quantity * prices[coin] - state.costBasis[coin];
      }
    }
    return { realized, unrealized, net: realized + unrealized, fees, transferred,
      savings: Number(state.savings) || 0, cash: Number(state.cash) || 0, value: total() };
  }

  function renderPerformanceMonitor() {
    const el = $("performanceMonitor"); if (!el || !prices) return;
    const m = performanceMetrics();
    const item = (label, value) => '<div class="stat"><span class="label">' + label + '</span><strong>' + value + '</strong></div>';
    el.innerHTML = [
      item("Realised net P/L", eur(m.realized)),
      item("Open-position P/L", (m.unrealized >= 0 ? "+" : "") + eur(m.unrealized)),
      item("Total net P/L", (m.net >= 0 ? "+" : "") + eur(m.net)),
      item("Portfolio value", eur(m.value)),
      item("Simulated fees paid", eur(m.fees)),
      item("Profit transferred to savings", eur(m.transferred)),
      item("Virtual savings balance", eur(m.savings)),
      item("Trading cash", eur(m.cash))
    ].join("");
  }

  function save(nextState = state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(nextState));
      saveWarning = "";
      return true;
    } catch (e) {
      saveWarning = "⚠️ Wallet save failed. Changes may not survive closing this page; free browser storage before continuing.";
      console.error("Local save failed", e);
      return false;
    }
  }

  function commitState(nextState) {
    if (!save(nextState)) return false;
    state = nextState;
    return true;
  }

  function say(id, value) {
    if ($(id)) $(id).textContent = value;
  }

  function updateModeIndicator() {
    const pill = $("liveModePill");
    if (pill) pill.textContent = state.autoTrading ? "AUTO PAPER MODE ON" : "AUTO PAPER MODE OFF";
  }

  async function getPrices() {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=" +
      COIN_SYMBOLS.map(c => COINS[c].id).join(",") +
      "&vs_currencies=eur&include_last_updated_at=true";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 429 ? "Price service rate limited" : "Price service unavailable");
      const data = await response.json();
      const p = {}, timestamps = {};
      for (const coin of COIN_SYMBOLS) {
        const item = data[COINS[coin].id];
        const value = Number(item?.eur);
        const updatedAt = Number(item?.last_updated_at) * 1000;
        if (Number.isFinite(value) && value > 0) p[coin] = value;
        if (Number.isFinite(updatedAt) && updatedAt > 0) timestamps[coin] = updatedAt;
      }
      const now = Date.now();
      const validFresh = COIN_SYMBOLS.filter(c => Number.isFinite(p[c]) &&
        Number.isFinite(timestamps[c]) && timestamps[c] <= now &&
        now - timestamps[c] <= MAX_PRICE_AGE_MS);
      if (validFresh.length < 3) throw new Error("Insufficient fresh, timestamped market quotes");
      return { prices: p, timestamps };
    } finally {
      clearTimeout(timeout);
    }
  }

  function priceIsFresh(coin, now = Date.now()) {
    const timestamp = priceTimestamps[coin];
    return !!coin && Number.isFinite(prices?.[coin]) && prices[coin] > 0 &&
      Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= MAX_PRICE_AGE_MS;
  }

  function pricesUsable(quote, updatedAt, now = Date.now()) {
    if (!quote || !Number.isFinite(updatedAt) || updatedAt > now ||
        now - updatedAt > MAX_PRICE_AGE_MS) return false;
    if (Object.keys(priceTimestamps).length === 0) {
      return COIN_SYMBOLS.some(c => Number.isFinite(quote[c]) && quote[c] > 0);
    }
    return COIN_SYMBOLS.filter(c => priceIsFresh(c, now)).length >= 3;
  }

  function exposure() {
    if (!prices) return 0;
    let value = 0;
    for (const coin of COIN_SYMBOLS) {
      const quantity = state.holdings[coin] || 0;
      if (quantity <= 0) continue;
      const price = prices[coin];
      // Never treat an unpriced existing holding as zero exposure.
      if (!Number.isFinite(price) || price <= 0) return Infinity;
      value += quantity * price;
    }
    return value;
  }

  function total() { return state.cash + (state.savings || 0) + exposure(); }

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
    renderPerformanceMonitor();
    window.AgentLearning?.observe({
      time: pricesUpdatedAt || Date.now(), equity: value, cash: state.cash,
      exposure: exposure(), orderCount: state.history.length,
      fees: state.history.reduce((sum, order) => sum + order.fee, 0),
      prices
    });

    say("equity", eur(value));
    say("pnl", `${profit >= 0 ? "+" : ""}${eur(profit)} (${(profit / START * 100).toFixed(2)}%)`);
    say("cash", eur(state.cash));
    say("positions", Object.values(state.holdings).filter(q => q > 0).length);
    say("savings", eur(state.savings || 0));
    if ($("autoTrading")) $("autoTrading").checked = !!state.autoTrading;
    updateModeIndicator();
    say("autoStatus", state.autoTrading ? "ON · paper-only" : "OFF · manual paper orders");
    say("autoDecision", state.autoLastAction || "No autonomous decision yet.");
    say("orders", state.history.length);
    say("day", "Active · until manually stopped");
    say("lastRun", new Date().toLocaleTimeString());
    say("marketStatus", loadWarning || saveWarning || "Public reference prices updated. Paper mode only.");
    say("orderMessage", state.paused
      ? "Simulated buying paused: daily loss limit reached."
      : `Exposure ${eur(exposure())} / ${eur(MAX_EXPOSURE)}. Paper only.`);

    const names = Object.fromEntries(COIN_SYMBOLS.map(c => [c, COINS[c].name]));
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
    if (Date.now() < nextPriceRetryAt) {
      const seconds = Math.ceil((nextPriceRetryAt - Date.now()) / 1000);
      say("marketStatus", "Price service cooling down after an error. Retry in " + seconds + " seconds.");
      return;
    }
    const cycleStarted=performance.now();
    if(speedStats.lastCycleStarted!=null) speedStats.lastCycleMs=cycleStarted-speedStats.lastCycleStarted;
    speedStats.lastCycleStarted=cycleStarted;
    busy = true;
    say("marketStatus", "Loading public prices...");
    try {
      const fetchStarted=performance.now();
      const fresh = await getPrices();
      speedStats.fetchMs=performance.now()-fetchStarted;
      speedStats.lastQuoteAt=Date.now(); speedStats.lastError=null;
      consecutivePriceFailures = 0; nextPriceRetryAt = 0;
      prices = fresh.prices; priceTimestamps = fresh.timestamps;
      pricesUpdatedAt = Math.max(...Object.values(priceTimestamps));
      if (!state.basisInitialized) {
        state.costBasis = { ...initial().costBasis, ...(state.costBasis || {}) };
        for (const c of COIN_SYMBOLS) state.costBasis[c] = (state.holdings[c] || 0) * prices[c];
        state.basisInitialized = true;
      }
      render();
      const decisionStarted=performance.now(); runAutonomousDecision();
      speedStats.decisionMs=performance.now()-decisionStarted;
      renderSpeedMonitor(); save();
    } catch (e) {
      consecutivePriceFailures += 1;
      const delay = Math.min(60000, 15000 * (2 ** Math.min(2, consecutivePriceFailures - 1)));
      nextPriceRetryAt = Date.now() + delay;
      speedStats.lastError="Quote request failed"; renderSpeedMonitor();
      say("marketStatus", "Public prices unavailable. Retrying in " + Math.ceil(delay / 1000) + " seconds.");
      console.warn(e);
    } finally {
      busy = false;
    }
  }

  // Shared order engine used by the live paper ticket and isolated tests.
  function processPaperOrder({ wallet, prices: quote, side, coin, amount, paused }) {
    const supportedCoins = COIN_SYMBOLS;
    if (!wallet || !wallet.holdings || typeof wallet.holdings !== "object" ||
        Array.isArray(wallet.holdings) ||
        Object.keys(wallet.holdings).some(c => !supportedCoins.includes(c)) || !quote ||
        !Number.isFinite(wallet.cash) || wallet.cash < 0 ||
        !supportedCoins.every(c =>
          Number.isFinite(wallet.holdings[c] ?? 0) && (wallet.holdings[c] ?? 0) >= 0) ||
        !COIN_SYMBOLS.includes(coin) ||
        !Number.isFinite(quote[coin]) || quote[coin] <= 0 ||
        supportedCoins.some(c => (wallet.holdings[c] ?? 0) > 0 &&
          (!Number.isFinite(quote[c]) || quote[c] <= 0)) ||
        !["buy", "sell"].includes(side) ||
        !Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER) {
      return { ok: false, reason: "invalid-order" };
    }

    const next = {
      ...wallet, savings: Number.isFinite(wallet.savings) ? wallet.savings : 0,
      costBasis: { ...initial().costBasis, ...(wallet.costBasis || {}) },
      holdings: { ...initial().holdings, ...wallet.holdings },
      history: Array.isArray(wallet.history) ? [...wallet.history] : []
    };
    if (!next.basisInitialized) {
      for (const c of supportedCoins) next.costBasis[c] = next.holdings[c] * quote[c];
      next.basisInitialized = true;
    }
    const fee = amount * FEE;
    const quantity = amount / quote[coin];
    const currentExposure = COIN_SYMBOLS.reduce((sum, c) => {
      const quantity = next.holdings[c] || 0;
      return quantity > 0 ? sum + quantity * quote[c] : sum;
    }, 0);

    if (side === "buy") {
      const reason = buyBlockReason({
        paused, amount, fee, cash: next.cash, currentExposure
      });
      if (reason) return { ok: false, reason };
      next.cash -= amount + fee;
      next.holdings[coin] += quantity;
      next.costBasis[coin] += amount + fee;
    } else {
      if (quantity > next.holdings[coin]) return { ok: false, reason: "insufficient-coins" };
      const basisBefore = next.costBasis[coin] || 0;
      const soldBasis = next.holdings[coin] > 0 ? basisBefore * (quantity / next.holdings[coin]) : 0;
      next.holdings[coin] -= quantity;
      next.costBasis[coin] = Math.max(0, basisBefore - soldBasis);
      const netProceeds = amount - fee, realizedNet = netProceeds - soldBasis;
      next.cash += netProceeds;
      let savingsTransfer = 0;
      if (realizedNet > 0) { savingsTransfer = realizedNet * 0.5; next.cash -= savingsTransfer; next.savings += savingsTransfer; }
      next.history.unshift({ time: Date.now(), side: "SELL", coin, amount, fee, realizedNet, savingsTransfer, soldBasis });
      return { ok: true, next, fee, quantity, realizedNet, savingsTransfer };
    }
    next.history.unshift({ time: Date.now(), side: "BUY", coin, amount, fee });
    return { ok: true, next, fee, quantity, realizedNet: 0, savingsTransfer: 0 };
  }

  async function trade() {
    if (loadWarning) {
      say("orderMessage", "Paper orders locked because saved data needs recovery. Export/contact support before continuing.");
      return;
    }
    if (!pricesUsable(prices, pricesUpdatedAt)) {
      say("orderMessage", "Prices missing, invalid, or stale. Refresh prices before placing a paper order.");
      return;
    }

    const coin = $("symbol")?.value;
    const side = $("side")?.value;
    const amount = Number($("amount")?.value);
    if (!priceIsFresh(coin)) {
      say("orderMessage", "Selected asset quote is stale or missing. Refresh prices before ordering.");
      return;
    }
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

    const nextState = { ...state, ...result.next };
    if (!commitState(nextState)) {
      say("orderMessage", "Order cancelled because the wallet could not be saved. " + saveWarning);
      return;
    }
    render();
    say("orderMessage",
      `Simulated ${side} completed. Fee: ${eur(result.fee)}. No real order was sent.`);
  }

  function runAutonomousDecision() {
    const decisionStarted = performance.now();
    if (loadWarning) {
      state.autoTrading = false;
      state.autoLastAction = "Paused: saved paper data needs recovery; no orders permitted.";
      save();
      return;
    }
    if (!state.autoTrading) return;
    // Autonomous paper mode stays ON until the user manually switches it OFF.
    // Paper AutoTrade stays ON until the user manually switches it OFF.
    if (!pricesUsable(prices, pricesUpdatedAt)) {
      state.autoLastAction = "Paused: public prices missing, invalid, or stale.";
      save(); return;
    }
    if (pricesUpdatedAt <= (state.autoLastQuoteAt || 0)) return;
    state.autoLastQuoteAt = pricesUpdatedAt;
    checkDailyLimit();

    let journal;
    try { journal = JSON.parse(localStorage.getItem("agent1-learning-journal-v1") || "{}"); }
    catch { journal = {}; }
    const quotes = Array.isArray(journal.quotes) ? journal.quotes : [];
    const valid = quotes.filter(q => q && Number.isFinite(q.time) &&
      q.time <= Date.now() && Date.now() - q.time <= MAX_AUTO_QUOTE_AGE_MS &&
      COIN_SYMBOLS.some(c => Number.isFinite(Number(q[c])) && Number(q[c]) > 0));
    const previous = valid.length ? valid[valid.length - 1] : null;
    const prior = valid.length > 1 ? valid[valid.length - 2] : null;
    if (!previous) {
      state.autoLastAction = "Waiting for first valid observation.";
      save(); return;
    }

    // Fast path: compare the newest valid snapshot with the immediately prior
    // distinct observation. No multi-minute averaging delay.
    const recent = state.history.slice(0, 20).filter(t => Number.isFinite(t.realizedNet));
    const winRate = recent.length ? recent.filter(t => t.realizedNet > 0).length / recent.length : 0.5;
    const hurdle = FEE * 2 + 0.0005 + (recent.length >= 5 && winRate < 0.4 ? 0.002 : 0);
    const choices = [];
    for (const coin of COIN_SYMBOLS) {
      const nowPrice = Number(previous[coin]);
      const oldPrice = prior ? Number(prior[coin]) : NaN;
      if (!Number.isFinite(nowPrice) || nowPrice <= 0) continue;
      const held = state.holdings[coin] || 0;
      const change = Number.isFinite(oldPrice) && oldPrice > 0 ? nowPrice / oldPrice - 1 : 0;
      const marketPrice = prices[coin];
      if (!priceIsFresh(coin) || !Number.isFinite(marketPrice) || marketPrice <= 0) continue;

      if (prior && !state.paused && held === 0 && change <= -hurdle) {
        choices.push({ side: "buy", coin, score: -change, reason: "fresh pullback exceeds fee-aware hurdle" });
      }
      const netValue = held * marketPrice * (1 - FEE);
      if (held > 0 && change >= hurdle && netValue > (state.costBasis[coin] || Infinity)) {
        choices.push({ side: "sell", coin, score: change, reason: "fresh rise clears estimated fees and cost basis" });
      }
    }

    const latency = Math.max(0, performance.now() - decisionStarted).toFixed(1);
    if (!choices.length) {
      const reasons = [];
      if (!prior) reasons.push("need a second distinct observation");
      if (state.paused) reasons.push("daily-loss safeguard active");
      if (exposure() >= MAX_EXPOSURE) reasons.push("exposure cap reached");
      if (state.cash < 1 + FEE) reasons.push("insufficient virtual cash");
      state.autoLastAction = "Fast check (" + latency + " ms): " +
        (reasons.length ? reasons.join("; ") : "no fresh signal cleared the fee-aware threshold") + ".";
      save(); return;
    }

    choices.sort((x, y) => y.score - x.score);
    const pick = choices[0];
    const budget = pick.side === "sell"
      ? Math.min(MAX_ORDER, Math.max(0, (state.holdings[pick.coin] || 0) * prices[pick.coin]))
      : Math.min(MAX_ORDER, Math.max(0, state.cash / (1 + FEE)),
          Math.max(0, MAX_EXPOSURE - exposure()));
    const confidence = Math.max(0, Math.min(1, (pick.score - hurdle) / 0.02));
    const targetAmount = Math.max(0.01, Math.round((1 + confidence * (MAX_ORDER - 1)) * 100) / 100);
    const amount = Math.min(budget, targetAmount);
    if (amount < 0.01) {
      state.autoLastAction = "Fast check (" + latency + " ms): blocked by available paper funds/exposure.";
      save(); return;
    }
    const result = processPaperOrder({ wallet: state, prices, side: pick.side,
      coin: pick.coin, amount, paused: state.paused });
    if (result.ok) {
      const nextState = { ...state, ...result.next };
      nextState.autoLastAction = "Fast auto paper " + pick.side.toUpperCase() + " " + pick.coin +
        " · " + eur(amount) + " · fee " + eur(result.fee) + " · decision " + latency + " ms" +
        " · " + pick.reason +
        (result.savingsTransfer ? " · savings " + eur(result.savingsTransfer) : "");
      if (!commitState(nextState)) {
        state.autoLastAction = "Order cancelled: wallet could not be saved. " + saveWarning;
        return;
      }
      render();
    } else {
      state.autoLastAction = "Fast check (" + latency + " ms): safeguard blocked " + result.reason + ".";
      save();
    }
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

  function buyBlockReason({ paused, amount, fee, cash, currentExposure }) {
    if (paused) return "daily-loss";
    if (amount + fee > cash) return "insufficient-cash";
    if (currentExposure + amount > MAX_EXPOSURE) return "exposure-limit";
    return null;
  }

  function testDailyLossGuard() {
    const lines = [];
    const originalState = JSON.stringify(state);
    const originalStorage = localStorage.getItem(KEY);
    const check = (name, passed) => lines.push(`${name}: ${passed ? "PASS" : "FAIL"}`);

    // Exercise the real daily-loss calculation against portfolio equity.
    const testPrices = Object.fromEntries(COIN_SYMBOLS.map((c, i) => [c, 10 + i]));
    const baseline = { day: "test-day", dayEquity: 500, paused: false };
    const lossCases = [
      { equity: 490.01, expectedPaused: false, label: "€9.99 loss" },
      { equity: 490.00, expectedPaused: true, label: "€10.00 loss" },
      { equity: 488.00, expectedPaused: true, label: "€12.00 loss" }
    ];
    for (const item of lossCases) {
      const calculated = dailyLimitState(baseline, item.equity, "test-day");
      const wallet = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
      const buy = processPaperOrder({ wallet, prices: testPrices, side: "buy", coin: "ETH", amount: 10, paused: calculated.paused });
      const sellWallet = { cash: 0, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, c === "BTC" ? 2 : 0])), history: [] };
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
    const unknownHolding = { cash: 500, holdings: { ...Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), FAKE: 1 }, history: [] };
    const unknownHoldingOrder = processPaperOrder({ wallet: unknownHolding, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejects unsupported wallet holding",
      !unknownHoldingOrder.ok && unknownHoldingOrder.reason === "invalid-order");
    const arrayHoldings = { cash: 500, holdings: [], history: [] };
    const arrayHoldingOrder = processPaperOrder({ wallet: arrayHoldings, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejects array instead of holding map",
      !arrayHoldingOrder.ok && arrayHoldingOrder.reason === "invalid-order");

    // Invalid / oversized order.
    const base = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const oversized = processPaperOrder({ wallet: base, prices: testPrices, side: "buy", coin: "BTC", amount: 50.01, paused: false });
    check("Order above €50 rejected", !oversized.ok && oversized.reason === "invalid-order");

    // Cash guard includes the fee.
    const poor = { cash: 5, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const noCash = processPaperOrder({ wallet: poor, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Insufficient virtual cash rejected", !noCash.ok && noCash.reason === "insufficient-cash" && JSON.stringify(poor) === JSON.stringify({ cash: 5, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] }));

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

    const exactCash = { cash: 10.02, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const exactCashOrder = processPaperOrder({ wallet: exactCash, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Cash exactly covering order plus fee accepted",
      exactCashOrder.ok && Math.abs(exactCashOrder.next.cash) < 1e-9);
    const shortCash = { cash: 10.019, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const shortCashOrder = processPaperOrder({ wallet: shortCash, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Cash short by €0.001 rejected",
      !shortCashOrder.ok && shortCashOrder.reason === "insufficient-cash");

    // Fee calculations and balances on successful isolated orders.
    const feeWallet = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const buy = processPaperOrder({ wallet: feeWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    const sell = buy.ok ? processPaperOrder({ wallet: buy.next, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: false }) : { ok: false };
    check("Buy/sell fee math (0.2% each)", buy.ok && Math.abs(buy.fee - 0.02) < 1e-9 && Math.abs(buy.next.cash - 489.98) < 1e-9 && sell.ok && Math.abs(sell.fee - 0.02) < 1e-9 && Math.abs(sell.next.cash - 499.96) < 1e-9);

    const empty = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const noCoins = processPaperOrder({ wallet: empty, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: false });
    check("Sell without sufficient coins rejected", !noCoins.ok && noCoins.reason === "insufficient-coins" && JSON.stringify(empty) === JSON.stringify({ cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] }));

    // Portfolio accounting: equity equals cash plus marked holdings, and fees reduce equity exactly.
    const accountingWallet = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const equity = wallet => wallet.cash + Object.entries(wallet.holdings)
      .reduce((sum, [coin, qty]) => sum + qty * testPrices[coin], 0);
    const accountingBuy = processPaperOrder({ wallet: accountingWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    const buyEquity = accountingBuy.ok ? equity(accountingBuy.next) : NaN;
    const accountingSell = accountingBuy.ok ? processPaperOrder({ wallet: accountingBuy.next, prices: testPrices, side: "sell", coin: "BTC", amount: 10, paused: false }) : { ok: false };
    const sellEquity = accountingSell.ok ? equity(accountingSell.next) : NaN;
    check("Portfolio accounting after buy (€499.98)", accountingBuy.ok && Math.abs(buyEquity - 499.98) < 1e-9);
    check("Portfolio accounting after round trip (€499.96)", accountingSell.ok && Math.abs(sellEquity - 499.96) < 1e-9 && accountingSell.next.holdings.BTC === 0);
    check("Accounting tests leave main portfolio unchanged",
      JSON.stringify(state) === originalState && localStorage.getItem(KEY) === originalStorage);

    // Feed validation: fail closed on missing, malformed, stale, or future quotes.
    const fixedNow = 1000000;
    check("Missing price feed rejected", !pricesUsable(null, fixedNow, fixedNow));
    check("Invalid price feed rejected",
      !pricesUsable(Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), fixedNow, fixedNow));
    check("Stale price feed (>2 minutes) rejected", !pricesUsable(testPrices, fixedNow - MAX_PRICE_AGE_MS - 1, fixedNow));
    check("Fresh price feed accepted", pricesUsable(testPrices, fixedNow, fixedNow));
    check("Future-dated price feed rejected", !pricesUsable(testPrices, fixedNow + 1, fixedNow));
    const invalidQuoteOrder = processPaperOrder({ wallet: base, prices: { ...testPrices, BTC: NaN }, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejected with malformed quote", !invalidQuoteOrder.ok && invalidQuoteOrder.reason === "invalid-order");

    // Wallet integrity: malformed balances and holdings must never create NaN or negative state.
    const badCash = { cash: NaN, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const badCashOrder = processPaperOrder({ wallet: badCash, prices: testPrices, side: "buy", coin: "BTC", amount: 10, paused: false });
    check("Order rejected with invalid virtual cash", !badCashOrder.ok && badCashOrder.reason === "invalid-order");
    const negativeHolding = { cash: 500, holdings: { ...Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), BTC: -1 }, history: [] };
    const negativeHoldingOrder = processPaperOrder({ wallet: negativeHolding, prices: testPrices, side: "sell", coin: "BTC", amount: 1, paused: false });
    check("Order rejected with negative holding", !negativeHoldingOrder.ok && negativeHoldingOrder.reason === "invalid-order");
    const negativeCash = { cash: -1, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const negativeCashOrder = processPaperOrder({ wallet: negativeCash, prices: testPrices, side: "buy", coin: "BTC", amount: 1, paused: false });
    check("Order rejected with negative virtual cash", !negativeCashOrder.ok && negativeCashOrder.reason === "invalid-order");

    // Order boundaries: exact maximum and smallest positive amount are valid when wallet limits permit.
    const maxWallet = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
    const maxOrder = processPaperOrder({ wallet: maxWallet, prices: testPrices, side: "buy", coin: "BTC", amount: 50, paused: false });
    check("Exact €50 order accepted", maxOrder.ok && Math.abs(maxOrder.next.cash - 449.90) < 1e-9);
    const tinyWallet = { cash: 500, holdings: Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), history: [] };
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
      ...fixture, holdings: { ...Object.fromEntries(COIN_SYMBOLS.map(c => [c, 0])), FAKE: 1000000 }
    }), Date.now());
    check("Unknown saved coin safely recovers",
      unknownCoinRecovery.recovered && !("FAKE" in unknownCoinRecovery.state.holdings));
    const futureHistoryRecovery = recoverSnapshot(JSON.stringify({
      ...fixture, history: [{ time: Date.now() + 3 * 60 * 60 * 1000, side: "BUY", coin: "BTC", amount: 10, fee: 0.02 }]
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
      ...fixture, started: controlledNow + 3 * 60 * 60 * 1000,
      portfolioHistory: [{ time: controlledNow + 3 * 60 * 60 * 1000, value: 500 }]
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
      JSON.stringify(state) === originalState && localStorage.getItem(KEY) === originalStorage);

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

  function importDataFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch { say("report", "Import failed: file is not valid JSON."); return; }
      const imported = parsed && parsed.mode === "paper-only" ? parsed.state : parsed;
      if (!validSavedState(imported)) {
        say("report", "Import rejected: invalid Agent1 paper portfolio. Current portfolio unchanged.");
        return;
      }
      if (!confirm("Import this paper portfolio and replace the current local virtual wallet? This cannot be undone here.")) return;
      const nextState = {
        ...initial(),
        ...imported,
        autoTrading: false,
        autoLastAction: "Imported portfolio; auto mode remains OFF.",
        holdings: { ...initial().holdings, ...imported.holdings },
        costBasis: { ...initial().costBasis, ...(imported.costBasis || {}) },
        history: [...imported.history],
        portfolioHistory: [...(imported.portfolioHistory || initial().portfolioHistory)]
      };
      if (!commitState(nextState)) {
        say("report", "Import cancelled because the browser could not save the replacement wallet. Existing wallet remains active.");
        return;
      }
      render();
      say("report", "Paper portfolio imported successfully. Auto mode is OFF.");
      say("reportStatus", "Imported");
      say("autoStatus", "OFF · imported portfolio");
    };
    reader.onerror = () => say("report", "Import failed: could not read file.");
    reader.readAsText(file);
  }

  function reset() {
    if (!confirm("Reset the €500 virtual paper portfolio?")) return;
    const nextState = initial();
    if (!commitState(nextState)) {
      say("report", "Reset cancelled because the browser could not save the new empty paper wallet. Existing wallet remains active.");
      return;
    }
    if (prices) render();
    say("report", "Portfolio reset.");
    say("reportStatus", "Not generated");
  }

  function start() {
    updateModeIndicator();
    ensureSpeedMonitor();
    ensurePerformanceMonitor();
    $("refreshBtn")?.addEventListener("click", refresh);
    $("orderBtn")?.addEventListener("click", trade);
    $("autoTrading")?.addEventListener("change", e => {
      const requested = !!e.target.checked;
      state.autoLastAction = requested ? "Enabled; waiting for fresh quote." : "Stopped by user.";
      state.autoTrading = requested;
      updateModeIndicator();
      save();
      render();
      if (requested) refresh();
    });
    $("reportBtn")?.addEventListener("click", report);
$("exportBtn")?.addEventListener("click", exportData);
    $("importBtn")?.addEventListener("click", () => $("importFile")?.click());
    $("importFile")?.addEventListener("change", e => {
      const file = e.target.files?.[0];
      importDataFile(file);
      e.target.value = "";
    });
    $("resetBtn")?.addEventListener("click", reset);

    refresh();
    // Frequent public reference-price polling for faster paper-only evaluation.
    // Slow down while hidden to reduce unnecessary requests and respect browser throttling.
    setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
