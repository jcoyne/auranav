#!/usr/bin/env bash
# Build the webapp for a subdirectory deployment and copy it, with one chart
# package, into a static site directory. Copies files only; committing and
# publishing the destination repository is left to the operator.
set -euo pipefail

DEST=${DEPLOY_DEST:-/Users/jcoyne85/workspace/jcoyne/jcoyne.github.io/auranav}
# The site subdirectory the app is served from, e.g. https://host/auranav/.
BASE=${DEPLOY_BASE:-/auranav/}
PACKAGE=${DEPLOY_PACKAGE:-wisconsin}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
package_dir="$repo_root/data/packages/$PACKAGE"

if [ ! -f "$package_dir/manifest.json" ]; then
  echo "No chart package manifest at $package_dir/manifest.json; run the pipeline first." >&2
  exit 1
fi

# Vite resolves asset URLs against BASE, and the app registers its service
# worker under import.meta.env.BASE_URL, so the subdirectory must be baked in
# at build time. Production builds have no default chart package, so point the
# viewer at the copy deployed alongside it.
VITE_CHART_MANIFEST_URL="${BASE}data/packages/$PACKAGE/manifest.json" \
  npm run build --workspace webapp -- --base="$BASE"

mkdir -p "$DEST"
# Keep the deployed shell an exact copy of dist/, preserving data/ (populated
# separately below) and assets/ (handled additively).
rsync -a --delete --exclude 'data/' --exclude 'assets/' "$repo_root/webapp/dist/" "$DEST/"
# Asset file names contain a content hash, so they are immutable and previous ones
# are retained deliberately. A browser or service worker still holding the previous
# index.html keeps requesting the assets that document names; deleting them turns
# that stale shell into a hard failure instead of a page that updates on the next
# visit. Prune the directory manually when old builds are no longer in circulation.
rsync -a "$repo_root/webapp/dist/assets/" "$DEST/assets/"
rsync -a --delete "$package_dir/" "$DEST/data/packages/$PACKAGE/"
# GitHub Pages runs Jekyll by default, which would ignore any future asset
# whose name begins with an underscore.
touch "$DEST/.nojekyll"

echo "Deployed webapp and '$PACKAGE' package to $DEST"
