const STARTING_EUR = 23;
const FEE_RATE = 0.001;
const STORAGE_KEY = "paper23";

const $ = (id) => document.getElementById(id);

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {
  cash: STARTING_EUR,
  holdings: {},
  history: []
};

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function getPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=eur";
  const response = await fetch(url);

  if (!response.ok) throw new Error("Market data unavailable");

  const data = await response.json();

  return {
    BTC: data.bitcoin.eur,
    ETH: data.ethereum.eur,
    SOL: data.solana.eur
  };
}

function formatEUR(value) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function render(prices) {
  const totalValue = Object.entries(state.holdings).reduce(
    (sum, [symbol, amount]) => sum + amount * prices[symbol],
    state.cash
  );

  const cashElement = $("cash");
  const totalElement = $("totalValue");

  if (cashElement) cashElement.textContent = formatEUR(state.cash);
  if (totalElement) totalElement.textContent = formatEUR(totalValue);

  const priceElement = $("prices");
  if (priceElement) {
    priceElement.innerHTML = Object.entries(prices)
      .map(
        ([symbol, price]) =>
          `<div class="stat"><span class="label">${symbol}</span><strong>${formatEUR(price)}</strong></div>`
      )
      .join("");
  }

  const historyElement = $("history");
  if (historyElement) {
    historyElement.innerHTML = state.history
      .slice(0, 10)
      .map(
        (item) =>
          `<div class="notice">${item.time} — ${item.action} ${item.symbol}: ${formatEUR(item.eur)}</div>`
      )
      .join("");
  }
}

async function refresh() {
  try {
    const prices = await getPrices();
    render(prices);

    const status = $("status");
    if (status) status.textContent = "Paper mode · Market prices updated";
  } catch (error) {
    const status = $("status");
    if (status) status.textContent = "Market data temporarily unavailable";
    console.error(error);
  }
}

async function paperTrade(action, symbol, eurAmount) {
  const prices = await getPrices();
  const price = prices[symbol];

  if (!price || !Number.isFinite(eurAmount) || eurAmount <= 0) {
    alert("Please enter a valid amount.");
    return;
  }

  const fee = eurAmount * FEE_RATE;
  const quantity = (eurAmount - fee) / price;

  if (action === "BUY") {
    if (eurAmount > state.cash) {
      alert("Not enough virtual cash.");
      return;
    }

    state.cash -= eurAmount;
    state.holdings[symbol] = (state.holdings[symbol] || 0) + quantity;
  } else {
    const available = state.holdings[symbol] || 0;
    const quantityToSell = eurAmount / price;

    if (quantityToSell > available) {
      alert("Not enough virtual holdings.");
      return;
    }

    state.holdings[symbol] = available - quantityToSell;
    state.cash += eurAmount - fee;
  }

  state.history.unshift({
    time: new Date().toLocaleString(),
    action,
    symbol,
    eur: eurAmount
  });

  save();
  await refresh();
}

function connectButtons() {
  document.querySelectorAll("[data-paper-buy]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.paperBuy;
      const input = $("tradeAmount");
      const amount = Number(input?.value);

      paperTrade("BUY", symbol, amount).catch(console.error);
    });
  });

  document.querySelectorAll("[data-paper-sell]").forEach((button) => {
    button.addEventListener("click", () => {
      const symbol = button.dataset.paperSell;
      const input = $("tradeAmount");
      const amount = Number(input?.value);

      paperTrade("SELL", symbol, amount).catch(console.error);
    });
  });

  const resetButton = $("resetPaper");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (!confirm("Reset the €23 paper account?")) return;

      state = {
        cash: STARTING_EUR,
        holdings: {},
        history: []
      };

      save();
      refresh();
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  connectButtons();
  refresh();
  setInterval(refresh, 60000);
});
