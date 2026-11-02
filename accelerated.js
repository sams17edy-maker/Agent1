/* Agent1 isolated 30-minute paper observation. No orders; separate storage key. */
(() => {
  "use strict";
  const KEY = "agent1-accelerated-observation-v1";
  const DURATION = 30 * 60 * 1000;
  const $ = id => document.getElementById(id);
  const fmt = n => "€" + Number(n).toFixed(2);
  function read() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY));
      const now = Date.now();
      if (!x || !Array.isArray(x.samples) || x.samples.length < 1 ||
          !Number.isFinite(x.startedAt) || x.startedAt <= 0 || x.startedAt > now ||
          !["running", "complete"].includes(x.status)) return null;
      if (!x.samples.every((s, i, a) =>
        s && typeof s === "object" &&
        Number.isFinite(s.elapsedMs) && s.elapsedMs >= 0 && s.elapsedMs <= DURATION &&
        typeof s.time === "string" && Number.isFinite(Date.parse(s.time)) &&
        (i === 0 || s.elapsedMs >= a[i - 1].elapsedMs))) return null;
      if (x.status === "complete" &&
          (!Number.isFinite(Date.parse(x.completedAt)) ||
           Date.parse(x.completedAt) < x.startedAt ||
           x.samples[x.samples.length - 1].elapsedMs !== DURATION)) return null;
      return x;
    } catch (_) { return null; }
  }
  function save(x) {
    try { localStorage.setItem(KEY, JSON.stringify(x)); return true; }
    catch (_) { return false; }
  }
  function snapshot(run) {
    return { elapsedMs: Math.min(Date.now() - run.startedAt, DURATION), time: new Date().toISOString(),
      equity: $("equity")?.textContent || "unavailable", cash: $("cash")?.textContent || "unavailable",
      positions: $("positions")?.textContent || "unavailable", orders: $("orders")?.textContent || "unavailable" };
  }
  function panel() {
    if ($("acceleratedPanel")) return;
    const main = document.querySelector("main");
    if (!main) return;
    const section = document.createElement("section");
    section.className = "panel wide";
    section.id = "acceleratedPanel";
    section.innerHTML = '<div class="row"><strong>30-minute observation</strong><span class="pill" id="accStatus">Not started</span></div><p class="sub">Records the visible virtual portfolio once per minute while this page is open. No automated orders; main portfolio is not modified by this timer.</p><div class="actions"><button id="accStart">Start / restart 30 minutes</button><button class="secondary" id="accExport">Export observation</button></div><div class="sub" id="accProgress" style="margin-top:10px">Ready. Keep this page open for minute snapshots.</div><div class="notice" id="accReport" style="margin-top:10px">No observation completed yet.</div>';
    const before = $("report")?.closest("section");
    main.insertBefore(section, before || main.lastElementChild);
    $("accStart").addEventListener("click", () => {
      const run = { startedAt: Date.now(), samples: [], status: "running" };
      run.samples.push(snapshot(run)); save(run); render();
    });
    $("accExport").addEventListener("click", () => {
      const run = read(); if (!run) { $("accReport").textContent = "No observation data to export."; return; }
      const blob = new Blob([JSON.stringify({ mode:"paper-only", durationMinutes:30, ...run }, null, 2)], {type:"application/json"});
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "agent1-30-minute-observation.json"; a.click(); URL.revokeObjectURL(url);
    });
    render();
  }
  function render() {
    const run = read(); if (!run) return;
    const elapsed = Math.max(0, Date.now() - run.startedAt), remaining = Math.max(0, DURATION - elapsed);
    const mins = Math.floor(remaining / 60000), secs = Math.floor((remaining % 60000) / 1000);
    if (elapsed >= DURATION && run.status !== "complete") {
      const last = run.samples[run.samples.length - 1];
      if (!last || last.elapsedMs < DURATION) run.samples.push(snapshot(run));
      run.status = "complete"; run.completedAt = new Date().toISOString(); save(run);
    }
    $("accStatus").textContent = run.status === "complete" ? "Complete" : "Running";
    $("accProgress").textContent = run.status === "complete" ? "Completed 30 minutes · " + run.samples.length + " snapshots recorded." : "Time remaining: " + mins + ":" + String(secs).padStart(2,"0") + " · " + run.samples.length + " snapshots recorded. Page must remain open.";
    const first = run.samples[0], last = run.samples[run.samples.length - 1];
    $("accReport").textContent = run.status === "complete" ? "Observation summary: " + first.equity + " → " + last.equity + ". Cash: " + last.cash + ". Open positions: " + last.positions + ". Completed orders: " + last.orders + ". These are observed paper values, not a forecast or 30-day historical result." : "Latest visible virtual equity: " + last.equity + ".";
  }
  function tick() {
    const run = read(); if (!run || run.status !== "running") return;
    const elapsed = Math.max(0, Date.now() - run.startedAt);
    if (elapsed < DURATION) {
      const last = run.samples[run.samples.length - 1];
      const lastMinute = last ? Math.floor(last.elapsedMs / 60000) : -1;
      const currentMinute = Math.floor(elapsed / 60000);
      // Record at most one snapshot per elapsed minute, even after background suspension.
      if (currentMinute > lastMinute) { run.samples.push(snapshot(run)); save(run); }
    }
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", panel); else panel();
  setInterval(tick, 1000);
})();