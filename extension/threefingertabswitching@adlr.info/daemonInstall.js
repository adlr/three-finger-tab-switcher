/* daemonInstall.js
 *
 * Installs and uninstalls the tabswitcherd helper as a D-Bus activated
 * systemd user service. The service files point at tabswitcherd.js inside
 * this extension's directory, so updating the extension updates the daemon
 * (after a restart, which install() does).
 *
 * Uses only Gio/GLib so that both prefs.js and extension.js can import it.
 *
 * SPDX-License-Identifier: GPL-2.0
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');

export const BUS_NAME = 'info.adlr.TabSwitcher';
const UNIT = 'tabswitcherd.service';

export const Status = {
    NOT_INSTALLED: 'not-installed',
    INSTALLED: 'installed',
    // Installed, but by another copy of the extension (or an older version),
    // so the files don't match what install() would write now.
    OUTDATED: 'outdated',
};

function dbusServicePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'dbus-1', 'services',
        `${BUS_NAME}.service`]);
}

function systemdUnitPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'systemd', 'user', UNIT]);
}

function expectedFiles(extensionPath) {
    const gjs = GLib.find_program_in_path('gjs') ?? '/usr/bin/gjs';
    const daemon = GLib.build_filenamev([extensionPath, 'tabswitcherd.js']);
    const exec = `${gjs} -m "${daemon}"`;
    return [
        [dbusServicePath(), `[D-BUS Service]
Name=${BUS_NAME}
Exec=${exec}
SystemdService=${UNIT}
`],
        [systemdUnitPath(), `[Unit]
Description=AT-SPI tab helper for Three Finger Tab Switching
PartOf=graphical-session.target

[Service]
Type=dbus
BusName=${BUS_NAME}
ExecStart=${exec}
# Uncomment for verbose matching logs:
#Environment=TABSWITCHER_DEBUG=1
Restart=on-failure
`],
    ];
}

function readFile(path) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

export function getStatus(extensionPath) {
    const files = expectedFiles(extensionPath);
    const contents = files.map(([path]) => readFile(path));
    if (contents.every(c => c === null))
        return Status.NOT_INSTALLED;
    return files.every(([, want], i) => contents[i] === want)
        ? Status.INSTALLED : Status.OUTDATED;
}

async function run(argv) {
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_SILENCE);
    await proc.wait_check_async(null);
}

/* Make the bus rescan its service directories. dbus-daemon notices new files
 * by itself, but dbus-broker needs to be told. */
async function reloadBusConfig() {
    await Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'ReloadConfig', null, null,
        Gio.DBusCallFlags.NONE, -1, null);
}

export async function install(extensionPath) {
    for (const [path, contents] of expectedFiles(extensionPath)) {
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        GLib.file_set_contents(path, contents);
    }
    await run(['systemctl', '--user', 'daemon-reload']);
    // Pick up a new daemon if an older one is running.
    await run(['systemctl', '--user', 'try-restart', UNIT]);
    await reloadBusConfig();
}

export async function uninstall() {
    try {
        await run(['systemctl', '--user', 'stop', UNIT]);
    } catch {
        // Not loaded; nothing to stop.
    }
    for (const path of [dbusServicePath(), systemdUnitPath()])
        GLib.unlink(path);
    await run(['systemctl', '--user', 'daemon-reload']);
    await reloadBusConfig();
}

export async function isRunning() {
    const reply = await Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', [BUS_NAME]),
        new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, -1, null);
    return reply.deepUnpack()[0];
}
