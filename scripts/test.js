#!/usr/bin/env node
/* Runs the production pipeline (CSV parsing + reversal math) of assets/app.js
 * against the real Google Sheets CSVs, with a stubbed DOM, and asserts the
 * expected topline numbers. Mirrors scripts/sanity.py expectations.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const avgCsv = fs.readFileSync("/tmp/opencode/flipr/averages.csv", "utf8");
const pollCsv = fs.readFileSync("/tmp/opencode/flipr/polls.csv", "utf8");
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "snapshot.json"), "utf8"));

function elem() {
  return {
    textContent: "", className: "", dataset: {}, style: {}, href: "", target: "",
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, setAttribute() {}, addEventListener() {},
  };
}

const sandbox = {
  console,
  fetch: () => Promise.reject(new Error("no network in test")),
  document: {
    addEventListener() {},
    getElementById: elem,
    querySelector: elem,
    querySelectorAll: () => [],
    createElement: () => elem(),
    createElementNS: () => elem(),
    body: { classList: { add() {} } },
  },
  window: { __ANTI_TEST: true },
  Date, Math, JSON, Promise, parseInt, parseFloat, isNaN, Object, Array,
};
vm.createContext(sandbox);
vm.runInContext(app, sandbox, { filename: "app.js" });
const t = sandbox.window.__t;

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
}

/* 1. live pipeline on real CSVs */
const live = t.fromLiveCSVs(avgCsv, pollCsv);
check("live: 39 races", live.races.length, 39);
check("live: dataDate doy 223 (Aug 11)", live.dataDate, 223);
check("live: >=100 recent polls", live.polls.length >= 100, true);
const pollsPerRace = {};
live.polls.forEach(p => { pollsPerRace[p.id] = (pollsPerRace[p.id] || 0) + 1; });
check("live: max 3 polls per race", Math.max(...Object.values(pollsPerRace)), 3);

/* 2. calls */
const views = live.races.filter(r => r.id !== "2026_US-GB").map(t.viewOf);
const dems = views.filter(v => v.flipCall === "D").length;
const reps = views.filter(v => v.flipCall === "R").length;
const toss = views.filter(v => v.flipCall !== "I" && v.flipMargin <= t.TOSS).length;
check("FLIPR Dem calls", dems, 25);
check("FLIPR GOP calls", reps, 13);
check("toss-ups <=1.5pt", toss, 7);
check("antiCall is mirror of flipCall",
  views.map(v => v.antiCall).filter((c, i) => c === views[i].flipCall).length, 0);

/* 3. generic ballot */
const gb = views.length === 38 && t.viewOf(live.races.find(r => r.id === "2026_US-GB"));
check("GB D share 50.4", Math.round(gb.d * 10) / 10, 50.4);
check("GB anti margin R +8.1", Math.round((gb.ar - gb.ad) * 10) / 10, 8.1);

/* 4. snapshot fallback parses to the same model */
const snap = t.fromSnapshot(snapshot);
check("snapshot: 39 races", snap.races.length, 39);
const sv = snap.races.filter(r => r.id !== "2026_US-GB").map(t.viewOf);
check("snapshot: Dem calls", sv.filter(v => v.flipCall === "D").length, dems);

/* 5. specific reversals */
const byId = v => live.races.map(t.viewOf).find(x => x.id === v);
const tx = byId("2026_TX-S2"); // Talarico D 47.87 vs Paxton R 45.25
check("TX-S2 anti leader", tx.antiCall, "R");
check("TX-S2 anti margin", Math.round(tx.antiMargin * 100) / 100, 2.62);
const idS2 = byId("2026_ID-S2"); // no D average
check("ID-S2 flagged incomplete", idS2.incomplete, true);
check("ID-S2 anti leader (R share -> D)", idS2.antiCall, "D");
const akG1 = byId("2026_AK-G1"); // Begich 44.63 - 33.55
check("AK-G1 anti margin", Math.round(akG1.antiMargin * 100) / 100, 11.08);

/* 6. sparkline source data intact */
const series = byId("2026_TX-S2").series;
check("series is time-ordered", series.every((s, i) => i === 0 || s[0] > series[i - 1][0]), true);
check("series has >= 2 points", series.length >= 2, true);

/* 7. featured races all present in the data */
const featured = ["2026_TX-S2", "2026_OH-G1", "2026_WI-3"];
check("featured races exist", featured.every(id => live.races.some(r => r.id === id)), true);
check("WI-3 is the House seat (Cooke/Van Orden)",
  byId("2026_WI-3").group, "House");

process.exit(failures ? 1 : 0);