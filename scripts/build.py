#!/usr/bin/env python3
"""Build assets/snapshot.json (offline fallback for ANTI FLIPR).

Downloads the public FLIPR polling-average and poll CSVs from Google Sheets
and packs them into one compact JSON. The live page normally fetches fresh
CSVs at runtime; this snapshot is only used when that fetch fails.
"""
import csv
import io
import json
import sys
import urllib.request
from datetime import date, datetime, timezone

SHEET = "2PACX-1vSyuZYuGnnjFdpjryAiGq6SeRe0ZOoGHKYzPzbxF1X_Ee_cE7411tTGdUbpRerX8_Xe7uRfw_Rkd1Hj"
AVERAGES_URL = f"https://docs.google.com/spreadsheets/d/e/{SHEET}/pub?gid=0&single=true&output=csv"
POLLS_URL = f"https://docs.google.com/spreadsheets/d/e/{SHEET}/pub?gid=523113073&single=true&output=csv"

BASE_YEAR = 2026


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "antiflipr-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def parse_csv(text):
    return list(csv.DictReader(io.StringIO(text)))


def day_of_year(iso):
    return date.fromisoformat(iso).timetuple().tm_yday


def fnum(v):
    v = (v or "").strip()
    return float(v) if v else None


def main():
    print("fetching averages...", file=sys.stderr)
    avg_rows = parse_csv(fetch(AVERAGES_URL))
    print("fetching polls...", file=sys.stderr)
    poll_rows = parse_csv(fetch(POLLS_URL))

    # --- races: latest snapshot + daily series ---------------------------------
    races = {}
    for r in avg_rows:
        rid = r["id"]
        race = races.get(rid)
        if race is None:
            race = races[rid] = {
                "id": rid,
                "group": r["group"],
                "place": r["place"],
                "cand": {
                    "D": {"n": r["cand_D"], "p": r["party_D"]},
                    "R": {"n": r["cand_R"], "p": r["party_R"]},
                    "I": {"n": r.get("cand_I") or "", "p": r.get("party_I") or ""},
                },
                "series": [],
            }
        d = fnum(r["avg_D"])
        rp = fnum(r["avg_R"])
        i = fnum(r.get("avg_I"))
        series = [day_of_year(r["date"]), d, rp]
        if i is not None:
            series.append(i)
        race["series"].append(series)

    # --- polls: keep the 3 most recent rows per race, trimmed fields ----------
    poll_rows.sort(key=lambda r: r["date"], reverse=True)
    recent = []
    counts = {}
    for r in poll_rows:
        if r["id"] not in races:
            continue
        counts[r["id"]] = counts.get(r["id"], 0)
        if counts[r["id"]] >= 3:
            continue
        counts[r["id"]] += 1
        recent.append({
            "id": r["id"],
            "d": r["date"],
            "pollster": r["pollster"],
            "s": (r["sample"] or ""),
            "p": (r["population"] or ""),
            "u": (r["url"] or ""),
            "n1": r["name1"],
            "p1": r["party1"],
            "v1": fnum(r["value1"]),
            "n2": r["name2"],
            "p2": r["party2"],
            "v2": fnum(r["value2"]),
            "n3": (r["name3"] or ""),
            "p3": (r["party3"] or ""),
            "v3": fnum(r.get("value3")),
        })

    races_out = sorted(races.values(), key=lambda x: x["group"])
    snapshot = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataDate": max(s[0] for race in races_out for s in race["series"]),
        "sources": {"averages": AVERAGES_URL, "polls": POLLS_URL},
        "races": races_out,
        "polls": recent,
    }

    out = "assets/snapshot.json"
    with open(out, "w") as f:
        json.dump(snapshot, f, separators=(",", ":"))
    n_polls = len(snapshot["polls"])
    print(f"wrote {out}: {len(races_out)} races, {n_polls} recent polls, "
          f"data date {snapshot['dataDate']}", file=sys.stderr)


if __name__ == "__main__":
    main()