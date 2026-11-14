/* prefs.js
 *
 * Settings window: install, update or uninstall the tabswitcherd helper.
 *
 * SPDX-License-Identifier: GPL-2.0
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as DaemonInstall from './daemonInstall.js';

const {Status} = DaemonInstall;

export default class TabSwitchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Helper Daemon',
            description: 'Tab switching needs tabswitcherd, a small background service ' +
                'that reads tab strips through the accessibility bus. It runs as a ' +
                'systemd user service and starts on the first swipe.',
        });
        page.add(group);

        this._row = new Adw.ActionRow({title: 'tabswitcherd'});
        group.add(this._row);

        this._installButton = new Gtk.Button({valign: Gtk.Align.CENTER});
        this._installButton.add_css_class('suggested-action');
        this._installButton.connect('clicked',
            () => this._runAction(() => DaemonInstall.install(this.path)));
        this._row.add_suffix(this._installButton);

        this._uninstallButton = new Gtk.Button({label: 'Uninstall', valign: Gtk.Align.CENTER});
        this._uninstallButton.add_css_class('destructive-action');
        this._uninstallButton.connect('clicked',
            () => this._runAction(() => DaemonInstall.uninstall()));
        this._row.add_suffix(this._uninstallButton);

        this._errorRow = new Adw.ActionRow({visible: false, title: 'Error'});
        this._errorRow.add_css_class('error');
        group.add(this._errorRow);

        const note = new Adw.PreferencesGroup({
            description: 'Removing the extension does not remove the daemon’s service ' +
                'files. Uninstall the daemon here first.',
        });
        page.add(note);

        this._refresh();
    }

    async _runAction(action) {
        this._installButton.sensitive = false;
        this._uninstallButton.sensitive = false;
        this._errorRow.visible = false;
        try {
            await action();
        } catch (e) {
            console.error(`[tabswitch] daemon install/uninstall failed: ${e}`);
            this._errorRow.subtitle = e.message;
            this._errorRow.visible = true;
        }
        await this._refresh();
    }

    async _refresh() {
        const status = DaemonInstall.getStatus(this.path);
        let running = false;
        try {
            running = await DaemonInstall.isRunning();
        } catch (e) {
            console.error(`[tabswitch] NameHasOwner failed: ${e}`);
        }

        switch (status) {
        case Status.NOT_INSTALLED:
            this._row.subtitle = 'Not installed';
            this._installButton.label = 'Install';
            break;
        case Status.INSTALLED:
            this._row.subtitle = running ? 'Installed, running' : 'Installed, starts on first swipe';
            this._installButton.label = 'Reinstall';
            break;
        case Status.OUTDATED:
            this._row.subtitle = 'Installed from another copy or an older version; update it';
            this._installButton.label = 'Update';
            break;
        }
        this._installButton.sensitive = true;
        this._uninstallButton.sensitive = status !== Status.NOT_INSTALLED;
    }
}
