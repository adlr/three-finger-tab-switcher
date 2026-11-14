#!/bin/bash
# Packs the extension, including the tabswitcherd daemon, into
# dist/threefingertabswitching@adlr.info.shell-extension.zip. Install it with
#   gnome-extensions install --force dist/threefingertabswitching@adlr.info.shell-extension.zip
# then install the daemon from the extension's settings.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
uuid=threefingertabswitching@adlr.info
src="$here/extension/$uuid"

mkdir -p "$here/dist"
# pack includes extension.js, metadata.json, stylesheet.css and prefs.js on
# its own; everything else must be listed. Paths are relative to $src.
gnome-extensions pack --force --out-dir="$here/dist" \
    --extra-source=tabswitcherd.js \
    --extra-source=daemonInstall.js \
    "$src"
echo "Built dist/$uuid.shell-extension.zip"
