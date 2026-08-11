# ANTI FLIPR 2026

The inverse of Nate Silver's FLIPR 2026 midterm forecast. Every published
FLIPR polling average is reversed: whatever vote share FLIPR hands to the
Democrat is handed to the Republican, and vice versa. If FLIPR says Democrats
sweep, ANTI FLIPR says they don't.

Live site (when deployed): `https://<user>.github.io/<repo>/`

## How it works

- On page load, `assets/app.js` fetches the two published CSV tabs of the
  public [FLIPR data sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vSyuZYuGnnjFdpjryAiGq6SeRe0ZOoGHKYzPzbxF1X_Ee_cE7411tTGdUbpRerX8_Xe7uRfw_Rkd1Hj/pub)
  (Google Sheets publishes CSV endpoints with open CORS, so this works from
  any static host):
  - `?gid=0&single=true&output=csv` — daily polling averages per race
  - `?gid=523113073&single=true&output=csv` — individual polls
- If the live fetch fails (offline, blocked), the page falls back to the
  embedded snapshot in `assets/snapshot.json`.
- The reversal rule: for every race and every poll, the Democrat's projected
  share is reassigned to the Republican and vice versa. Independent share is
  untouched. Races with a projected margin under 1.5 points are marked
  toss-ups. Page shows both readings side by side.

## Layout

```
index.html            static page
assets/style.css      styling
assets/app.js         data fetch, reversal math, rendering
assets/snapshot.json  offline fallback (generated)
scripts/build.py      regenerates assets/snapshot.json from the live sheets
scripts/test.js       node test of the CSV parsing + reversal pipeline
scripts/deploy.sh     pushes only the served files to the gh-pages branch
.github/workflows/    deploys automatically on push to main
```

## Deployment: main vs gh-pages

The repo has two branches with different jobs:

- **`main`** — everything: source, scripts, tests, README.
- **`gh-pages`** — only what GitHub Pages serves: `index.html`, `assets/`
  (including the snapshot fallback) and a `.nojekyll` marker.

Two ways to publish, pick either (or both):

**A. Automatic (GitHub Actions).** Push to `main` and the
`.github/workflows/deploy.yml` workflow force-pushes a clean `gh-pages`
branch with just the served files. After the first run, point the repo at
Settings → Pages → Deploy from branch → `gh-pages`.

**B. Manual (local script).** `./scripts/deploy.sh` regenerates the
`gh-pages` branch from a worktree at `.deploy/gh-pages`, copies only
`index.html` and `assets/`, and force-pushes. Use this when you want a
deploy without waiting for CI (or are offline from GitHub).

For a one-command "commit everything and ship": `./scripts/deploy.sh --all`
first commits and pushes the full source tree to `main`, then deploys
`gh-pages`. Plain `./scripts/deploy.sh` only touches `gh-pages` — `main` is
never modified by it (though the deploy always reflects your current working
tree, including uncommitted edits like a regenerated `snapshot.json`).

Either way the live page still refreshes its data from Google Sheets on
every load; only the app code lives on gh-pages.

## Regenerating the snapshot fallback

```sh
python3 scripts/build.py
```

## Running the tests

```sh
node scripts/test.js
```

(Requires the live CSVs cached at `/tmp/opencode/flipr/*.csv` — or change the
paths at the top of `scripts/test.js` to point at any local copies.)

## Notes

- Chamber control can't be computed from the published data: the sheet only
  covers races with polling averages (39 as of Aug 11, 2026). Seat tallies on
  the page cover only those tracked races.
- Parody/analysis project, not affiliated with Nate Silver or Silver Bulletin.
  Data (c) Silver Bulletin.
