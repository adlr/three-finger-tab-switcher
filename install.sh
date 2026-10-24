#!/bin/bash
# Installs the extension (as a symlink to this checkout) and the D-Bus
# activated tabswitcherd user service. Re-run after moving the checkout.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
uuid=threefingertabswitching@adlr.info
daemon="$here/daemon/tabswitcherd.js"

ext_dir="$HOME/.local/share/gnome-shell/extensions/$uuid"
if [ -e "$ext_dir" ] && [ ! -L "$ext_dir" ]; then
    backup_dir="$HOME/.local/share/gnome-shell/extension-backups"
    mkdir -p "$backup_dir"
    backup="$backup_dir/$uuid.bak-$(date +%Y%m%d%H%M%S)"
    echo "Moving existing $ext_dir to $backup"
    mv "$ext_dir" "$backup"
fi
ln -sfn "$here/extension/$uuid" "$ext_dir"

mkdir -p "$HOME/.local/share/dbus-1/services" "$HOME/.config/systemd/user"
sed "s|@DAEMON@|$daemon|" "$here/data/info.adlr.TabSwitcher.service.in" \
    > "$HOME/.local/share/dbus-1/services/info.adlr.TabSwitcher.service"
sed "s|@DAEMON@|$daemon|" "$here/data/tabswitcherd.service.in" \
    > "$HOME/.config/systemd/user/tabswitcherd.service"
systemctl --user daemon-reload
systemctl --user try-restart tabswitcherd.service || true

echo "Installed. On Wayland, log out and back in, then:"
echo "  gnome-extensions enable $uuid"
