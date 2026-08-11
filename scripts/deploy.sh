#!/usr/bin/env bash
# Publish the site to the gh-pages branch with ONLY the files needed to serve it:
#   index.html, assets/ (including snapshot.json fallback), .nojekyll
# Everything else (scripts, tests, README) stays on main.
#
# Usage:
#   ./scripts/deploy.sh          # deploy only: build + force-push gh-pages
#   ./scripts/deploy.sh --all    # also commit everything to main and push it first
set -euo pipefail

ALL=0
case "${1:-}" in
  --all) ALL=1 ;;
  "") ;;
  *) echo "usage: $0 [--all]" >&2; exit 1 ;;
esac

DEPLOY_DIR=".deploy/gh-pages"
SERVE_FILES=(index.html assets)
NOW=$(date -u +"%Y-%m-%d %H:%M UTC")

command -v git >/dev/null || { echo "error: git is required" >&2; exit 1; }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: run from inside the repo" >&2
  exit 1
fi
if [ "$(git branch --show-current)" != "main" ]; then
  echo "warning: you are on $(git branch --show-current), expected main"
fi

# --all: commit the full source tree to main and push it.
if [ "$ALL" = 1 ]; then
  git add -A
  if git diff --cached --quiet; then
    echo "main: nothing to commit (tree is clean)"
  else
    git commit -m "Update site: $NOW"
  fi
  git push origin main
fi

# Fresh gh-pages worktree so the branch is always a clean mirror of the served files.
git worktree remove --force "$DEPLOY_DIR" 2>/dev/null || true
git branch -D gh-pages 2>/dev/null || true
git worktree add "$DEPLOY_DIR" -b gh-pages

# Copy only the served files (from the working tree, same as GitHub Actions would).
rm -rf "$DEPLOY_DIR"/*
for f in "${SERVE_FILES[@]}"; do
  cp -R "$f" "$DEPLOY_DIR"/
done
touch "$DEPLOY_DIR/.nojekyll"

(
  cd "$DEPLOY_DIR"
  git add -A
  git commit -m "Deploy site: $NOW"
  git push -f origin gh-pages
)

echo "Deployed to gh-pages. Site: https://sillypears.github.io/anti-flipper-2026/"
echo "(--all) main updated and pushed; gh-pages holds only index.html + assets/.)"