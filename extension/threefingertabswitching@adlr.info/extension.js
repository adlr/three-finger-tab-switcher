/* extension.js
 *
 * Three finger tab switching: a horizontal three-finger swipe highlights tabs
 * in the focused window's tab strip; lifting the fingers activates the
 * highlighted tab.
 *
 * All AT-SPI work happens in a separate process (daemon/tabswitcherd.js) that
 * we call over D-Bus asynchronously, so a slow or hung app can never stall
 * the compositor. This file only handles gestures, geometry and drawing.
 *
 * Logs: journalctl --user -f -o cat /usr/bin/gnome-shell | grep tabswitch
 *
 * SPDX-License-Identifier: GPL-2.0
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEBUG = true;

const BUS_NAME = 'info.adlr.TabSwitcher';
const OBJECT_PATH = '/info/adlr/TabSwitcher';
const IFACE = 'info.adlr.TabSwitcher1';
const GET_TABS_TIMEOUT_MS = 1500;

const NUM_FINGERS = 3;
// Unaccelerated distance before we decide the swipe direction. Must stay below
// the shell's own DRAG_THRESHOLD_DISTANCE (16) so that we claim horizontal
// swipes before the workspace switcher does. Four-finger swipes still reach
// the workspace switcher because we only look at NUM_FINGERS.
const DIRECTION_THRESHOLD = 8;
// Pixels of highlight travel per pixel of (accelerated) finger motion.
const GAIN = 1.0;
const HIGHLIGHT_ANIMATION_MS = 90;
// The cursor starts this many pixels inside the selected tab's edge on the
// side the user is swiping toward, so the next tab is one short move away.
const START_INSET = 2;

function log(msg) {
    console.log(`[tabswitch] ${msg}`);
}
function debug(msg) {
    if (DEBUG)
        log(msg);
}

function rectStr(r) {
    return `${r.width}x${r.height}@${r.x},${r.y}`;
}

const GestureState = {
    NONE: 0,
    PENDING: 1,
    ACTIVE: 2,
    IGNORED: 3,
};

/*
 * Map AT-SPI window-relative coordinates onto the stage.
 *
 * On Wayland, AT-SPI only gives coordinates relative to the app's own idea of
 * its window, and apps disagree on what that is: some measure from the
 * visible frame, some from the whole surface including client-side shadows,
 * some (Electron) in physical pixels. We pick whichever interpretation makes
 * the size AT-SPI reports for the frame best match what Mutter has.
 */
function computeMapping(window, atspiFrame) {
    const frame = window.get_frame_rect();
    const buffer = window.get_buffer_rect();
    const scale = global.display.get_monitor_scale(window.get_monitor());
    const candidates = [
        {name: 'frame', origin: frame, scale: 1},
        {name: 'buffer', origin: buffer, scale: 1},
    ];
    if (scale !== 1) {
        candidates.push({name: `frame@${scale}`, origin: frame, scale});
        candidates.push({name: `buffer@${scale}`, origin: buffer, scale});
    }
    for (const c of candidates) {
        c.error = Math.abs(atspiFrame.w / c.scale - c.origin.width) +
            Math.abs(atspiFrame.h / c.scale - c.origin.height);
    }
    candidates.sort((a, b) => a.error - b.error);
    const best = candidates[0];
    debug(`geometry: atspi frame ${atspiFrame.w}x${atspiFrame.h}@${atspiFrame.x},${atspiFrame.y}; ` +
        `mutter frame ${rectStr(frame)} buffer ${rectStr(buffer)} scale ${scale}; ` +
        `candidates ${candidates.map(c => `${c.name}:${c.error.toFixed(0)}`).join(' ')} -> ${best.name}`);
    if (best.error > 16)
        log(`warning: no geometry interpretation fits well (best ${best.name}, error ${best.error}); highlight may be misplaced`);

    return r => ({
        x: best.origin.x + (r.x - atspiFrame.x) / best.scale,
        y: best.origin.y + (r.y - atspiFrame.y) / best.scale,
        w: r.w / best.scale,
        h: r.h / best.scale,
    });
}

/* One gesture, from the moment we claim it until the fingers lift. */
class SwitchSession {
    constructor(window, movingRight) {
        this._window = window;
        this._movingRight = movingRight;
        this._pendingDx = 0;
        this._tabs = null;       // stage-coordinate rects
        this._noTabs = false;    // daemon answered: this window has no tabs
        this._token = 0;
        this._selected = -1;     // tab that was active when we started
        this._index = -1;        // tab currently highlighted
        this._cursorX = 0;
        this._finished = false;
        this._destroyed = false;
        this._highlight = null;
        this._label = null;
        this._startTime = GLib.get_monotonic_time();

        window.connectObject('unmanaged', () => {
            log('window closed during gesture');
            this.destroy();
        }, this);

        const frame = window.get_frame_rect();
        const pid = window.get_pid();
        const title = window.get_title() ?? '';
        log(`begin: wm_class=${window.get_wm_class()} pid=${pid} ` +
            `client=${window.get_client_type() === Meta.WindowClientType.WAYLAND ? 'wayland' : 'x11'} title="${title}" frame ${rectStr(frame)}`);

        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, IFACE, 'GetTabs',
            new GLib.Variant('(usii)', [pid, title, frame.width, frame.height]),
            new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE,
            GET_TABS_TIMEOUT_MS, null, (conn, res) => {
                let reply;
                try {
                    [reply] = conn.call_finish(res).deepUnpack();
                } catch (e) {
                    log(`GetTabs D-Bus call failed (is tabswitcherd installed?): ${e.message}`);
                    return;
                }
                this._onTabs(JSON.parse(reply));
            });
    }

    _elapsedMs() {
        return ((GLib.get_monotonic_time() - this._startTime) / 1000).toFixed(1);
    }

    _onTabs(res) {
        if (this._destroyed && !this._finished)
            return;
        if (!res.ok) {
            this._noTabs = true;
            log(`no tabs for this window: ${res.error} (app=${res.app ?? '?'}, ${this._elapsedMs()}ms)`);
            return;
        }

        const map = computeMapping(this._window, res.frame);
        this._tabs = res.tabs.map(t => ({...map(t), name: t.name}));
        this._token = res.token;
        this._selected = res.selected;
        debug(`got ${this._tabs.length} tabs from ${res.app} (${res.toolkit}), selected ${res.selected}, ` +
            `${this._elapsedMs()}ms after begin; first tab at ${JSON.stringify(this._tabs[0])}`);

        const start = Math.max(this._selected, 0);
        this._cursorX = this._movingRight
            ? this._rightBoundary(start) - START_INSET
            : this._leftBoundary(start) + START_INSET;

        if (this._finished) {
            // A quick flick that ended before the reply arrived: act on the
            // motion it made.
            this._moveCursor(this._pendingDx);
            this._activate();
        } else {
            // Motion made before the highlight is visible is dropped, so the
            // highlight always appears on the current tab just short of the
            // cut-over and only motion the user can see moves it.
            debug(`dropping ${this._pendingDx.toFixed(1)}px of motion made before tabs arrived`);
            this._moveCursor(0);
            this._showHighlight();
        }
        this._pendingDx = 0;
    }

    update(dx) {
        if (!this._tabs) {
            this._pendingDx += dx;
            return;
        }
        this._moveCursor(dx);
    }

    /*
     * Each tab's hit region. Tabs may overlap (Chrome) or have gaps, so
     * neighbors split at the midpoint between their centers rather than at
     * their drawn edges; the outer edges of the strip are the real edges.
     */
    _rightBoundary(i) {
        const a = this._tabs[i], b = this._tabs[i + 1];
        return b ? (a.x + a.w / 2 + b.x + b.w / 2) / 2 : a.x + a.w;
    }

    _leftBoundary(i) {
        return i > 0 ? this._rightBoundary(i - 1) : this._tabs[0].x;
    }

    _moveCursor(dx) {
        const last = this._tabs.length - 1;
        this._cursorX = Math.min(Math.max(this._cursorX + dx * GAIN, this._leftBoundary(0)),
            this._rightBoundary(last));

        let index = last;
        for (let i = 0; i < last; i++) {
            if (this._cursorX < this._rightBoundary(i)) {
                index = i;
                break;
            }
        }
        if (index !== this._index) {
            this._index = index;
            debug(`highlight tab ${index} "${this._tabs[index].name}"`);
            this._placeHighlight(true);
        }
    }

    _showHighlight() {
        this._highlight = new St.Widget({style_class: 'tabswitch-highlight', reactive: false});
        this._label = new St.Label({style_class: 'tabswitch-label', reactive: false});
        Main.layoutManager.uiGroup.add_child(this._highlight);
        Main.layoutManager.uiGroup.add_child(this._label);
        this._placeHighlight(false);
    }

    _placeHighlight(animate) {
        if (!this._highlight || this._index < 0)
            return;
        const t = this._tabs[this._index];
        const geom = {x: Math.round(t.x), y: Math.round(t.y), width: Math.round(t.w), height: Math.round(t.h)};
        if (animate) {
            this._highlight.ease({...geom, duration: HIGHLIGHT_ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._highlight.set_position(geom.x, geom.y);
            this._highlight.set_size(geom.width, geom.height);
        }

        this._label.text = t.name || `Tab ${this._index + 1}`;
        const monitor = Main.layoutManager.monitors[this._window.get_monitor()];
        // Clear the width set for the previous tab, or the preferred width
        // reported below is that fixed width rather than this title's.
        this._label.set_width(-1);
        const [, natWidth] = this._label.get_preferred_width(-1);
        const width = Math.min(natWidth, 480);
        this._label.set_width(width);
        const x = Math.min(Math.max(geom.x + geom.width / 2 - width / 2, monitor.x + 8),
            monitor.x + monitor.width - width - 8);
        this._label.set_position(Math.round(x), geom.y + geom.height + 6);
    }

    /* Fingers lifted (or the gesture was cancelled, e.g. by sliding off the
     * touchpad edge, which we treat the same way). */
    finish() {
        this._finished = true;
        this._destroyUi();
        if (this._noTabs) {
            this._destroyed = true;
            return;
        }
        if (!this._tabs) {
            debug(`fingers lifted before tabs arrived (${this._elapsedMs()}ms); will act on reply`);
            return;
        }
        this._activate();
    }

    _activate() {
        this._destroyed = true;
        if (this._index < 0 || this._index === this._selected) {
            debug(`ended on already-selected tab ${this._index}; nothing to do`);
            return;
        }
        const index = this._index;
        log(`activating tab ${index} "${this._tabs[index].name}"`);
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, IFACE, 'ActivateTab',
            new GLib.Variant('(ui)', [this._token, index]),
            new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE,
            GET_TABS_TIMEOUT_MS, null, (conn, res) => {
                try {
                    const [ok] = conn.call_finish(res).deepUnpack();
                    if (!ok)
                        log(`daemon could not activate tab ${index}; see tabswitcherd log`);
                } catch (e) {
                    log(`ActivateTab D-Bus call failed: ${e.message}`);
                }
            });
    }

    _destroyUi() {
        this._window.disconnectObject(this);
        this._highlight?.destroy();
        this._highlight = null;
        this._label?.destroy();
        this._label = null;
    }

    destroy() {
        this._destroyed = true;
        this._destroyUi();
    }
}

export default class TabSwitchExtension extends Extension {
    enable() {
        this._state = GestureState.NONE;
        this._session = null;
        this._cumX = 0;
        this._cumY = 0;
        this._capturedId = global.stage.connect('captured-event::touchpad',
            this._onTouchpadEvent.bind(this));
        log('enabled');
    }

    disable() {
        global.stage.disconnect(this._capturedId);
        this._session?.destroy();
        this._session = null;
        log('disabled');
    }

    _onTouchpadEvent(actor, event) {
        if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE ||
            event.get_touchpad_gesture_finger_count() !== NUM_FINGERS)
            return Clutter.EVENT_PROPAGATE;

        const phase = event.get_gesture_phase();
        const ending = phase === Clutter.TouchpadGesturePhase.END ||
            phase === Clutter.TouchpadGesturePhase.CANCEL;

        if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
            this._session?.destroy();
            this._session = null;
            this._cumX = 0;
            this._cumY = 0;
            this._state = Main.actionMode === Shell.ActionMode.NORMAL
                ? GestureState.PENDING : GestureState.IGNORED;
            return Clutter.EVENT_PROPAGATE;
        }

        switch (this._state) {
        case GestureState.PENDING: {
            if (ending) {
                this._state = GestureState.NONE;
                return Clutter.EVENT_PROPAGATE;
            }
            const [ux, uy] = event.get_gesture_motion_delta_unaccelerated();
            this._cumX += ux;
            this._cumY += uy;
            if (Math.hypot(this._cumX, this._cumY) < DIRECTION_THRESHOLD)
                return Clutter.EVENT_PROPAGATE;
            if (Math.abs(this._cumX) <= Math.abs(this._cumY)) {
                this._state = GestureState.IGNORED;
                return Clutter.EVENT_PROPAGATE;
            }

            const window = global.display.get_focus_window();
            if (!window) {
                log('horizontal swipe but no focused window');
                this._state = GestureState.IGNORED;
                return Clutter.EVENT_PROPAGATE;
            }
            this._state = GestureState.ACTIVE;
            this._session = new SwitchSession(window, this._cumX > 0);
            return Clutter.EVENT_STOP;
        }

        case GestureState.ACTIVE:
            if (ending) {
                if (phase === Clutter.TouchpadGesturePhase.CANCEL)
                    log('gesture cancelled; activating the highlighted tab anyway');
                this._session?.finish();
                this._session = null;
                this._state = GestureState.NONE;
            } else {
                const [dx] = event.get_gesture_motion_delta();
                this._session?.update(dx);
            }
            return Clutter.EVENT_STOP;

        default:
            if (ending)
                this._state = GestureState.NONE;
            return Clutter.EVENT_PROPAGATE;
        }
    }
}
