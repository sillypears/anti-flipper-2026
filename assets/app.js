/* ANTI FLIPR 2026 — the inverse of Silver Bulletin's FLIPR midterm model.
 * Live data is fetched from the published Google Sheets CSV endpoints;
 * assets/snapshot.json is used as an offline fallback.
 */
(function () {
  "use strict";

  var AVERAGES_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSyuZYuGnnjFdpjryAiGq6SeRe0ZOoGHKYzPzbxF1X_Ee_cE7411tTGdUbpRerX8_Xe7uRfw_Rkd1Hj/pub?gid=0&single=true&output=csv";
  var POLLS_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSyuZYuGnnjFdpjryAiGq6SeRe0ZOoGHKYzPzbxF1X_Ee_cE7411tTGdUbpRerX8_Xe7uRfw_Rkd1Hj/pub?gid=523113073&single=true&output=csv";
  var YEAR = 2026;
  var TOSS = 1.5; // point margin under which a race is a toss-up
  var FEATURED = ["2026_TX-S2", "2026_OH-G1", "2026_WI-3"];

  var state = { races: [], polls: [], dataDate: null, live: false, generated: null };

  /* ---------------- CSV parsing (RFC 4180) ---------------- */
  function parseCSV(text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    while (rows.length && rows[0].length === 1 && rows[0][0] === "") rows.shift();
    return rows;
  }

  function rowsToObjects(rows) {
    var header = rows[0];
    return rows.slice(1).map(function (r) {
      var o = {};
      for (var i = 0; i < header.length; i++) o[header[i]] = r[i] !== undefined ? r[i].trim() : "";
      return o;
    });
  }

  function num(v) {
    if (v === null || v === undefined) return null;
    v = String(v).trim();
    if (v === "") return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function doyOf(iso) {
    return Math.floor((Date.UTC(parseInt(iso.slice(0, 4), 10), parseInt(iso.slice(5, 7), 10) - 1, parseInt(iso.slice(8, 10), 10)) - Date.UTC(YEAR, 0, 1)) / 86400000) + 1;
  }

  /* ---------------- build data model (shared by live CSV + embedded JSON) ---------------- */
  function buildModel(avgRows, pollRows) {
    var races = {};
    for (var i = 0; i < avgRows.length; i++) {
      var r = avgRows[i], rid = r.id, race = races[rid];
      if (!race) {
        race = races[rid] = {
          id: rid, group: r.group, place: r.place,
          cand: {
            D: { n: r.cand_D, p: r.party_D },
            R: { n: r.cand_R, p: r.party_R },
            I: { n: r.cand_I || "", p: r.party_I || "" }
          },
          series: []
        };
      }
      var pt = [doyOf(r.date), num(r.avg_D), num(r.avg_R)];
      var iv = num(r.avg_I);
      if (iv !== null) pt.push(iv);
      race.series.push(pt);
    }
    var byId = Object.keys(races);
    byId.sort(function (a, b) { return races[a].group.localeCompare(races[b].group); });
    var maxDoy = byId.reduce(function (m, id) {
      var s = races[id].series;
      return Math.max(m, s[s.length - 1][0]);
    }, 0);

    var recent = [];
    var counts = {};
    pollRows = pollRows.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    for (var j = 0; j < pollRows.length; j++) {
      var p = pollRows[j];
      if (!races[p.id] || counts[p.id] >= 3) continue;
      counts[p.id] = (counts[p.id] || 0) + 1;
      recent.push({
        id: p.id, d: p.date, pollster: p.pollster, s: p.sample || "", p: p.population || "",
        u: p.url || "",
        n1: p.name1, p1: p.party1, v1: num(p.value1),
        n2: p.name2, p2: p.party2, v2: num(p.value2),
        n3: p.name3 || "", p3: p.party3 || "", v3: num(p.value3)
      });
    }

    var racesOut = byId.map(function (id) { return races[id]; });
    return { races: racesOut, polls: recent, dataDate: maxDoy };
  }

  function fromLiveCSVs(avgText, pollText) {
    var avg = rowsToObjects(parseCSV(avgText));
    var poll = rowsToObjects(parseCSV(pollText));
    var model = buildModel(avg, poll);
    model.live = true;
    return model;
  }

  function fromSnapshot(json) {
    return {
      races: json.races, polls: json.polls,
      dataDate: json.dataDate, live: false, generated: json.generated
    };
  }

  function loadData(cb) {
    Promise.all([fetch(AVERAGES_URL), fetch(POLLS_URL)])
      .then(function (res) {
        return Promise.all([res[0].text(), res[1].text()]);
      })
      .then(function (texts) {
        var model = fromLiveCSVs(texts[0], texts[1]);
        if (!model.races.length) throw new Error("empty");
        state = Object.assign(state, model);
        cb(null, "live");
      })
      .catch(function (err) {
        fetch("assets/snapshot.json")
          .then(function (r) { return r.json(); })
          .then(function (json) {
            state = Object.assign(state, fromSnapshot(json));
            cb(null, "snapshot");
          })
          .catch(function (err2) { cb(err2); });
      });
  }

  /* ---------------- the reversal math ---------------- */
  function latest(race) {
    return race.series[race.series.length - 1];
  }

  function shares(race) {
    var s = latest(race);
    return { d: s[1] || 0, r: s[2] || 0, i: s[3] || 0 };
  }

  function callFrom(a, b, i) {
    var leader = "I", leadVal = -1e9, second = 0;
    var vals = [["D", a], ["R", b]];
    if (i > 0) vals.push(["I", i]);
    for (var k = 0; k < vals.length; k++) {
      if (vals[k][1] > leadVal) { second = leadVal; leadVal = vals[k][1]; leader = vals[k][0]; }
      else if (vals[k][1] > second) second = vals[k][1];
    }
    return { leader: leader, margin: leadVal - second, share: leadVal };
  }

  function viewOf(race) {
    var sh = shares(race);
    var anti = { d: sh.r, r: sh.d, i: sh.i }; // every D share becomes the R share and vice versa
    var flip = callFrom(sh.d, sh.r, sh.i);
    var rev = callFrom(anti.d, anti.r, anti.i);
    var inc = (sh.d === 0 && sh.i > 0) || (sh.r === 0 && sh.i > 0);
    return {
      id: race.id, group: race.group, place: race.place,
      cand: race.cand, series: race.series,
      d: sh.d, r: sh.r, i: sh.i,
      ad: anti.d, ar: anti.r, ai: anti.i,
      flipCall: flip.leader, flipMargin: flip.margin,
      antiCall: rev.leader, antiMargin: rev.margin,
      revMargin: sh.r - sh.d,
      incomplete: inc
    };
  }

  /* ---------------- formatting ---------------- */
  function pct(v) { return v.toFixed(1) + "%"; }
  function plus(v) { return (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(1); }

  function fmtDate(doy) {
    return new Date(Date.UTC(YEAR, 0, doy)).toLocaleDateString("en-US",
      { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  var PARTY = { D: "D", R: "R", I: "I" };

  /* ---------------- rendering ---------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function callPill(party, margin) {
    var pill = el("span", "pill " + (party === "I" ? "pill-i" : party === "D" ? "pill-d" : "pill-r"),
      party === "I" ? "Independent" : party === "D" ? "Dem" : "GOP");
    if (margin <= TOSS) {
      pill.className = "pill pill-t";
      pill.textContent = "Toss-up";
    }
    return pill;
  }

  function marginBar(container, d, r, i, maxTot) {
    var total = d + r + (i || 0) || 1;
    var mid = el("div", "bar-med");
    var dbar = el("div", "bar-seg bar-d");
    dbar.style.width = (100 * d / total).toFixed(1) + "%";
    var rbar = el("div", "bar-seg bar-r");
    rbar.style.width = (100 * r / total).toFixed(1) + "%";
    var ibar = el("div", "bar-seg bar-i");
    ibar.style.width = (i ? 100 * i / total : 0).toFixed(1) + "%";
    container.appendChild(dbar);
    container.appendChild(ibar);
    container.appendChild(mid);
    container.appendChild(rbar);
  }

  function sparkline(container, series, clean) {
    var pts = series.map(function (s) {
      return { x: s[0], y: (s[1] || 0) - (s[2] || 0) };
    });
    var W = 460, H = clean ? 56 : 72, P = 6;
    var xs = pts.map(function (p) { return p.x; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var m = 0;
    for (var i = 0; i < pts.length; i++) m = Math.max(m, Math.abs(pts[i].y));
    var yMax = Math.max(m, 2) * 1.15;
    var sx = function (x) { return P + (x - x0) / Math.max(1, x1 - x0) * (W - 2 * P); };
    var sy = function (y) { return H / 2 - (y / yMax) * (H / 2 - P); };
    function poly(coef) {
      return pts.map(function (p, idx) {
        return (idx ? "L" : "M") + sx(p.x).toFixed(1) + " " + sy(coef * p.y).toFixed(1);
      }).join(" ");
    }
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", clean ? "spark spark-clean" : "spark");
    var zero = document.createElementNS("http://www.w3.org/2000/svg", "line");
    zero.setAttribute("x1", P); zero.setAttribute("x2", W - P);
    zero.setAttribute("y1", H / 2); zero.setAttribute("y2", H / 2);
    zero.setAttribute("class", "spark-zero");
    svg.appendChild(zero);
    var f = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    f.setAttribute("points", poly(1)); f.setAttribute("class", "spark-flipr");
    var a = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    a.setAttribute("points", poly(-1)); a.setAttribute("class", "spark-anti");
    svg.appendChild(f); svg.appendChild(a);
    var t1 = el("div", clean ? "spark-label spark-label-clean" : "spark-label");
    t1.textContent = clean
      ? "D\u2212R margin \u00B7 FLIPR blue / ANTI red \u00B7 " + fmtDate(x0) + " \u2192 " + fmtDate(x1)
      : "FLIPR margin (D\u2212R) \u2014 blue line; ANTI FLIPR is its exact mirror (red). Days: " +
        fmtDate(x0) + " \u2192 " + fmtDate(x1);
    container.appendChild(svg);
    container.appendChild(t1);
  }

  function pollListHTML(polls, cards) {
    var ul = el("ul", cards ? "poll-cards" : "poll-list");
    polls.forEach(function (p) {
      var li = el("li");
      var dv = (p.p1 === "D" ? p.v1 : p.v2) || 0;
      var rv = (p.p2 === "R" ? p.v2 : p.v1) || 0;
      li.appendChild(el("span", "poll-main",
        p.pollster + " \u00B7 " + fmtDate(doyOf(p.d)) +
        " \u00B7 " + (p.p || "") + (p.s ? " \u00B7 n=" + p.s : "")));
      var anti = el("span", "poll-anti",
        "ANTI: R " + pct(dv) + " \u2014 D " + pct(rv));
      anti.innerHTML += aLink(p.u);
      li.appendChild(anti);
      ul.appendChild(li);
    });
    return ul;
  }

  function featCard(view) {
    var card = el("div", "feat-card");
    card.dataset.id = view.id;
    var head = el("div", "feat-head");
    head.appendChild(el("span", "feat-place", view.place));
    head.appendChild(el("span", "feat-grp", view.group));
    card.appendChild(head);
    card.appendChild(el("div", "feat-match",
      view.cand.D.n + " (D) vs " + view.cand.R.n + " (R)" +
      (view.cand.I.n ? " \u00B7 +" + view.cand.I.n + " (I)" : "")));

    var flRow = el("div", "feat-row");
    flRow.appendChild(el("span", "feat-lab", "FLIPR"));
    flRow.appendChild(callPill(view.flipCall, view.flipMargin));
    flRow.appendChild(el("span", "feat-marg",
      (view.flipCall === "D" ? "D" : view.flipCall === "R" ? "R" : "I") + " " + plus(view.flipMargin)));
    var flBar = el("div", "mtbar feat-mt");
    marginBar(flBar, view.d, view.r, view.i);
    flRow.appendChild(flBar);
    card.appendChild(flRow);

    var anRow = el("div", "feat-row");
    anRow.appendChild(el("span", "feat-lab", "ANTI"));
    anRow.appendChild(callPill(view.antiCall, view.antiMargin));
    anRow.appendChild(el("span", "feat-marg",
      (view.antiCall === "D" ? "D" : view.antiCall === "R" ? "R" : "I") + " " + plus(view.antiMargin)));
    var anBar = el("div", "mtbar feat-mt");
    marginBar(anBar, view.ad, view.ar, view.ai);
    anRow.appendChild(anBar);
    card.appendChild(anRow);

    sparkline(card, view.series, true);
    card.appendChild(el("div", "feat-hint", "\u2193 expand in the full table"));
    return card;
  }

  function focusRace(id) {
    var allBtn = document.querySelector('.pillbtn[data-f="all"]');
    if (allBtn && !allBtn.classList.contains("active")) allBtn.click();
    var tr = document.querySelector('#race-tbody tr[data-id="' + id + '"]');
    if (!tr) return;
    var det = tr.nextElementSibling;
    if (det && det.classList.contains("detail")) det.classList.remove("hidden");
    tr.classList.add("open");
    tr.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function raceRow(view) {
    var tr = el("tr");
    tr.dataset.id = view.id;
    tr.dataset.margin = Math.abs(view.revMargin).toFixed(2);

    var tdRace = el("td", "td-race");
    tdRace.appendChild(el("span", "place", view.place));
    tdRace.appendChild(el("span", "grp", view.group));
    if (view.incomplete) tdRace.appendChild(el("span", "grp warn", "no \u00BD avg"));
    tr.appendChild(tdRace);

    var tdFl = el("td");
    tdFl.appendChild(el("div", "cands", view.cand.D.n + " (D)"));
    tdFl.appendChild(el("div", "vals", pct(view.d) + " \u2014 " + pct(view.r)));

    var tdAnti = el("td");
    tdAnti.appendChild(el("div", "cands", view.cand.R.n + " (R)"));
    tdAnti.appendChild(el("div", "vals", pct(view.ad) + " \u2014 " + pct(view.ar)));

    var tdFbar = el("td");
    var fbar = el("div", "mtbar");
    marginBar(fbar, view.d, view.r, view.i);
    tdFbar.appendChild(fbar);
    tdFbar.appendChild(el("div", "mtsub",
      (view.flipCall === "I" ? "Independent" : view.flipCall === "D" ? "Dem" : "GOP") +
      " " + plus(view.flipMargin)));

    var tdRbar = el("td");
    var rbar = el("div", "mtbar");
    marginBar(rbar, view.ad, view.ar, view.ai);
    tdRbar.appendChild(rbar);
    tdRbar.appendChild(el("div", "mtsub",
      (view.antiCall === "I" ? "Independent" : view.antiCall === "D" ? "Dem" : "GOP") +
      " " + plus(view.antiMargin)));

    var tdDelta = el("td", "td-delta");
    tdDelta.appendChild(el("span", "rev", "\u21C4 " + Math.abs(view.revMargin).toFixed(1) + " pt"));

    tr.appendChild(tdRace); tr.appendChild(tdFl); tr.appendChild(tdAnti);
    tr.appendChild(tdFbar); tr.appendChild(tdRbar); tr.appendChild(tdDelta);

    var detail = el("tr", "detail hidden");
    var tdD = el("td", "detail-cell");
    tdD.colSpan = 6;
    var inner = el("div", "detail-inner");
    var sp = el("div", "detail-block");
    sparkline(sp, view.series);
    inner.appendChild(sp);
    var polls = state.polls.filter(function (p) { return p.id === view.id; }).slice(0, 3);
    if (polls.length) {
      var pb = el("div", "detail-block");
      pb.appendChild(el("h4", "detail-h", "Recent polls \u2014 as ANTI FLIPR reads them"));
      pb.appendChild(pollListHTML(polls));
      inner.appendChild(pb);
    }
    tdD.appendChild(inner);
    detail.appendChild(tdD);
    tr.appendChild(detail);
    tr.addEventListener("click", function () {
      detail.classList.toggle("hidden");
      tr.classList.toggle("open");
    });
    return tr;
  }

  function aLink(u) {
    if (!u) return "";
    var a = document.createElement("a");
    a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = " \u2197";
    return a.outerHTML;
  }

  function render() {
    var views = state.races
      .filter(function (r) { return r.id !== "2026_US-GB"; })
      .map(viewOf);
    var gbRace = state.races.filter(function (r) { return r.id === "2026_US-GB"; })[0];

    /* status bar */
    document.getElementById("st-data").textContent = fmtDate(state.dataDate);
    var src = document.getElementById("st-src");
    if (state.live) {
      src.textContent = "live from Google Sheets";
      src.className = "chip chip-live";
    } else {
      src.textContent = "embedded snapshot" + (state.generated ? " \u00B7 " +
        new Date(state.generated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
      src.className = "chip chip-snap";
    }

    /* topline cards */
    if (gbRace) {
      var gbv = viewOf(gbRace);
      setCard("c-gb-flipr", "FLIPR generic ballot", "D +" + (gbv.d - gbv.r).toFixed(1),
        "Democrats " + pct(gbv.d) + " \u00B7 Republicans " + pct(gbv.r));
      setCard("c-gb-anti", "ANTI FLIPR generic ballot", "R +" + Math.abs(gbv.r - gbv.d).toFixed(1),
        "Republicans " + pct(gbv.ad) + " \u00B7 Democrats " + pct(gbv.ar));
      var gbLeft = document.getElementById("b-gb-flipr");
      var gbRight = document.getElementById("b-gb-anti");
      marginBar(gbLeft, gbv.d, gbv.r, gbv.i);
      marginBar(gbRight, gbv.ad, gbv.ar, gbv.ai);

      var gbP = document.getElementById("gb-polls");
      if (gbP) {
        gbP.textContent = "";
        var gbPolls = state.polls.filter(function (p) { return p.id === "2026_US-GB"; }).slice(0, 3);
        if (gbPolls.length) {
          gbP.appendChild(el("h4", "detail-h", "Recent generic-ballot polls \u2014 as ANTI FLIPR reads them"));
          gbP.appendChild(pollListHTML(gbPolls, true));
        }
      }
    }

    var dems = views.filter(function (v) { return v.flipCall === "D"; }).length;
    var reps = views.filter(function (v) { return v.flipCall === "R"; }).length;
    var toss = views.filter(function (v) { return v.flipMargin <= TOSS && v.flipCall !== "I"; }).length;
    var others = views.length - dems - reps - toss;
    setCard("c-flipr", "FLIPR calls \u00B7 " + views.length + " tracked races",
      dems + "\u2013" + reps + " (D\u2013R)",
      (toss ? toss + " toss-up \u00B7 " : "") + (others ? others + " independent lead" : "") +
      "among polled races only");
    setCard("c-anti", "ANTI FLIPR calls",
      reps + "\u2013" + dems + " (D\u2013R)",
      "every FLIPR lead reversed \u2014 " + (dems + reps - toss) +
        " of them by more than " + TOSS + " points");

    /* race table */
    var tb = document.getElementById("race-tbody");
    tb.textContent = "";
    views.forEach(function (v) { tb.appendChild(raceRow(v)); });

    /* featured races */
    var featBox = document.getElementById("feat-grid");
    if (featBox) {
      featBox.textContent = "";
      var viewById = {};
      views.forEach(function (v) { viewById[v.id] = v; });
      FEATURED.forEach(function (id) {
        var v = viewById[id];
        if (!v) return;
        var card = featCard(v);
        card.addEventListener("click", function () { focusRace(id); });
        featBox.appendChild(card);
      });
    }

    document.getElementById("n-races").textContent = views.length;
    document.getElementById("n-polls").textContent = state.polls.length;
    var sg = document.getElementById("snap-gen");
    if (sg) sg.textContent = state.generated ? "built " +
      new Date(state.generated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  }

  function setCard(id, title, big, sub) {
    var c = document.getElementById(id);
    c.textContent = "";
    c.appendChild(el("h3", "card-t", title));
    c.appendChild(el("div", "card-big", big));
    c.appendChild(el("div", "card-sub", sub));
  }

  /* filters + sorting */
  function applyFilter() {
    var f = document.querySelector('.pillbtn.active').dataset.f;
    var sort = document.getElementById("sort").value;
    var rows = Array.prototype.slice.call(document.querySelectorAll("#race-tbody tr:not(.detail)"));
    rows.forEach(function (tr) {
      var view = viewsByRow[tr.dataset.id];
      var show = f === "all" || view.group === f;
      tr.classList.toggle("hidden", !show);
      tr.classList.remove("open");
      var det = tr.nextElementSibling;
      if (det && det.classList.contains("detail")) det.classList.add("hidden");
    });
    var sortable = rows.filter(function (tr) {
      return !tr.classList.contains("hidden");
    });
    sortable.sort(function (a, b) {
      var av = viewsByRow[a.dataset.id], bv = viewsByRow[b.dataset.id];
      if (sort === "rev") return Math.abs(bv.revMargin) - Math.abs(av.revMargin);
      if (sort === "close") return Math.abs(av.revMargin) - Math.abs(bv.revMargin);
      var m = av.group.localeCompare(bv.group);
      return m !== 0 ? m : av.place.localeCompare(bv.place);
    });
    sortable.forEach(function (tr) {
      var det = tr.nextElementSibling;
      tb.appendChild(tr);
      if (det && det.classList.contains("detail")) tb.appendChild(det);
    });
  }
  var viewsByRow = {};
  var tb = null;

  document.addEventListener("DOMContentLoaded", function () {
    tb = document.getElementById("race-tbody");
    document.querySelectorAll(".pillbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".pillbtn").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        applyFilter();
      });
    });
    document.getElementById("sort").addEventListener("change", applyFilter);
    loadData(function (err, mode) {
      if (err) {
        document.getElementById("st-src").textContent = "data unavailable";
        document.getElementById("st-src").className = "chip chip-snap";
        document.getElementById("main").classList.add("nope");
        document.getElementById("main").insertBefore(
          el("p", "err", "Could not load data from Google Sheets or the embedded snapshot."),
          document.getElementById("main").firstChild);
        return;
      }
      state.races.forEach(function (r) { viewsByRow[r.id] = viewOf(r); });
      render();
      applyFilter();
      document.body.classList.add("ready");
    });

  });

  /* test hook: window.__ANTI_TEST=true exposes the pure pipeline for node tests */
  if (typeof window !== "undefined" && window.__ANTI_TEST) {
    window.__t = { parseCSV: parseCSV, buildModel: buildModel, viewOf: viewOf,
      fromLiveCSVs: fromLiveCSVs, fromSnapshot: fromSnapshot, doyOf: doyOf, TOSS: TOSS };
  }
})();