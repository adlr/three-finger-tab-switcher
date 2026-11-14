# Three Finger Tab Switching

Swipe three fingers left/right on the touchpad to move a highlight across
the tabs of the focused window; lift your fingers to switch to the
highlighted tab. Works with Google Chrome today; any app that exposes an
AT-SPI `page tab list` (Firefox, many GTK apps) should work too.
Four-finger swipes keep switching workspaces as usual.

## Design

```
 touchpad ──► gnome-shell extension ──D-Bus (async)──► tabswitcherd ──AT-SPI──► Chrome
              gestures, overlay,        GetTabs()        window matching,
              geometry mapping          ActivateTab()    tab discovery, activation
```

* **extension/** (`threefingertabswitching@adlr.info`): catches three-finger
  horizontal swipes in the capture phase, before the shell's workspace
  swipe tracker sees them. It asks the daemon for tabs, draws the highlight
  and title label, and asks the daemon to activate the tab when the
  gesture ends.
* **tabswitcherd.js** (shipped inside the extension): a gjs process that
  does all the AT-SPI work. AT-SPI calls are synchronous round trips into
  the target app. Making them inside gnome-shell would stall the compositor
  whenever an app is slow, and could deadlock if the query ever reached the
  shell's own accessibility tree. Keeping per-app logic here also means you
  can change and restart it without logging out.

The daemon is D-Bus activated (`info.adlr.TabSwitcher`, run as the
`tabswitcherd.service` systemd user unit), so it starts on the first gesture.
The extension's settings page installs and uninstalls the D-Bus and systemd
files (`daemonInstall.js`). They point at `tabswitcherd.js` in the extension's
own directory, so updating the extension updates the daemon. If the daemon
isn't installed, the first swipe shows a notification that opens the
settings.

### Finding the right window

AT-SPI's `ACTIVE` state is unreliable: apps don't always update it.
Chrome, for example, showed no active frame until it was focused again.
The shell, however, knows exactly which window has focus. So the extension
sends that window's **id, pid, title, and frame and buffer sizes**, and the
daemon scores each AT-SPI frame:

* exact title match: +100
* prefix title match, or the title minus its last " - App" part starts the
  frame name: +50
* size within 2px of the frame or buffer size (at some scale): +30;
  within 64px: +10
* the frame this window last matched by title: +25
* `ACTIVE` state: +20
* frame with no name: −5

Titles alone aren't enough. Chrome's frame names add text such as
"High memory usage - 1.2 GB" and the profile name, and Gmail flashes
notifications into the title, so the title can differ from the frame name a
moment later. Sizes alone aren't enough either, because several windows of an
app are often the same size. Remembering the last title match keeps a window
attached to its frame while its title is flashing. A tie is logged as
"ambiguous match".

If no AT-SPI app has that pid, the daemon searches every app.

### Geometry

On Wayland, AT-SPI only reports positions relative to the app's own window.
Apps disagree on where that window starts: some measure from the visible
frame, some from the whole surface including client-side shadows, and some
(Electron) report physical pixels. The extension tries frame and buffer
origins, each at scale 1 and at the monitor scale. It uses whichever one
makes the reported frame size best match Mutter's, and logs the choice.

## Build and install

```sh
./build.sh    # -> dist/threefingertabswitching@adlr.info.shell-extension.zip
gnome-extensions install --force dist/threefingertabswitching@adlr.info.shell-extension.zip
# Wayland: log out/in so the shell rescans extensions, then
gnome-extensions enable threefingertabswitching@adlr.info
gnome-extensions prefs threefingertabswitching@adlr.info   # click Install
```

Removing the extension leaves the daemon's service files in place, so
uninstall the daemon from the settings first. To remove them by hand, delete
`~/.local/share/dbus-1/services/info.adlr.TabSwitcher.service` and
`~/.config/systemd/user/tabswitcherd.service`.

## Debugging

```sh
# Extension (gesture, window info, geometry choice, highlight moves)
journalctl --user -f -o cat /usr/bin/gnome-shell | grep tabswitch

# Daemon (window matching, tab lists considered/rejected, activation)
journalctl --user -f -o cat -u tabswitcherd
# Verbose candidate scoring: uncomment Environment=TABSWITCHER_DEBUG=1 in
# ~/.config/systemd/user/tabswitcherd.service, then
systemctl --user daemon-reload && systemctl --user restart tabswitcherd

# Run the lookup from a terminal, no shell involved
gjs -m extension/threefingertabswitching@adlr.info/tabswitcherd.js --list            # all frames, with ACTIVE flag
gjs -m extension/threefingertabswitching@adlr.info/tabswitcherd.js --query           # tabs of the ACTIVE frame
gjs -m extension/threefingertabswitching@adlr.info/tabswitcherd.js --query "Gmail"   # tabs of frame whose title contains "Gmail"
```

After editing the daemon, run `systemctl --user restart tabswitcherd`. No
logout is needed. Editing the extension needs a logout on Wayland.

`dump-tree.js` dumps raw AT-SPI trees. `extension.js` at the top level is the
older prototype, kept for reference.
