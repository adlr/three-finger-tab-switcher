#!/usr/bin/env -S gjs -m
/*
 * tabswitcherd: AT-SPI helper for the Three Finger Tab Switching extension.
 *
 * AT-SPI calls are synchronous D-Bus round trips into the target app. Doing
 * them inside gnome-shell risks stalling the compositor (or deadlocking when
 * the shell ends up querying its own accessibility tree), so they live here
 * and the extension talks to us asynchronously over the session bus.
 *
 * Usage:
 *   gjs -m tabswitcherd.js              Run the D-Bus service
 *   gjs -m tabswitcherd.js --query [T]  Print the tabs of the window whose
 *                                       title contains T (default: the
 *                                       ACTIVE frame) and exit
 *   gjs -m tabswitcherd.js --list       List all top-level frames and exit
 *
 * Set TABSWITCHER_DEBUG=1 for verbose logging.
 *
 * SPDX-License-Identifier: GPL-2.0
 */

import Atspi from 'gi://Atspi';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const BUS_NAME = 'info.adlr.TabSwitcher';
const OBJECT_PATH = '/info/adlr/TabSwitcher';
const IFACE_XML = `
<node>
  <interface name="info.adlr.TabSwitcher1">
    <!-- Returns a JSON object; see findTabsForWindow() -->
    <method name="GetTabs">
      <arg type="u" name="pid" direction="in"/>
      <arg type="s" name="title" direction="in"/>
      <arg type="i" name="width" direction="in"/>
      <arg type="i" name="height" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="ActivateTab">
      <arg type="u" name="token" direction="in"/>
      <arg type="i" name="index" direction="in"/>
      <arg type="b" name="ok" direction="out"/>
    </method>
  </interface>
</node>`;

const VERBOSE = !!GLib.getenv('TABSWITCHER_DEBUG');
const ATSPI_TIMEOUT_MS = 800;
const DFS_NODE_LIMIT = 4000;
const DFS_DEPTH_LIMIT = 25;
const MAX_REMEMBERED_RESULTS = 8;

function log(msg) {
    print(`tabswitcherd: ${msg}`);
}
function debug(msg) {
    if (VERBOSE)
        log(msg);
}

function ruleForRole(role) {
    return Atspi.MatchRule.new(
        Atspi.StateSet.new([]), Atspi.CollectionMatchType.ALL,
        {}, Atspi.CollectionMatchType.ANY,
        [role], Atspi.CollectionMatchType.ANY,
        [], Atspi.CollectionMatchType.ALL,
        false);
}
const PAGE_TAB_LIST_RULE = ruleForRole(Atspi.Role.PAGE_TAB_LIST);

/* Every AT-SPI call can throw (app went away, timeout); treat that as "no". */
function safe(fn, fallback = null) {
    try {
        return fn();
    } catch (e) {
        debug(`AT-SPI call failed: ${e.message}`);
        return fallback;
    }
}

/*
 * Chromium enables its accessibility tree lazily. Until a client asks for
 * something "AT-like" such as attributes, GetChildAtIndex returns null
 * references even though GetChildCount is nonzero. Asking for the node's
 * attributes wakes it up, so do that and retry once when we see nulls.
 */
function wake(acc) {
    safe(() => acc.get_attributes());
}

function children(acc) {
    const n = safe(() => acc.get_child_count(), 0);
    const fetch = () => {
        const out = [];
        for (let i = 0; i < n; i++)
            out.push(safe(() => acc.get_child_at_index(i)));
        return out;
    };
    let kids = fetch();
    if (kids.some(c => !c)) {
        debug(`${kids.filter(c => !c).length}/${n} null children of ` +
            `${safe(() => acc.get_role_name(), '?')}; waking and retrying`);
        wake(acc);
        kids = fetch();
        if (kids.some(c => !c))
            log(`${kids.filter(c => !c).length}/${n} children of ` +
                `${safe(() => acc.get_role_name(), '?')} still null after wake`);
    }
    return kids.filter(c => c);
}

function hasState(acc, state) {
    return safe(() => acc.get_state_set().contains(state), false);
}

function rect(acc) {
    return safe(() => {
        const p = acc.get_position(Atspi.CoordType.WINDOW);
        const s = acc.get_size();
        return {x: p.x, y: p.y, w: s.x, h: s.y};
    }, {x: 0, y: 0, w: 0, h: 0});
}

function attributes(acc) {
    return safe(() => acc.get_attributes(), {}) ?? {};
}

function shortName(acc) {
    const n = safe(() => acc.get_name(), '') ?? '';
    return n.length > 70 ? `${n.slice(0, 67)}...` : n;
}

/*
 * Window matching. The shell knows exactly which Meta.Window is focused, so we
 * match on (pid, title, size) rather than trusting the AT-SPI ACTIVE state,
 * which apps don't always keep up to date. ACTIVE is only a tie-breaker.
 */
function scoreFrame(frame, title, width, height) {
    const name = safe(() => frame.get_name(), '') ?? '';
    const r = rect(frame);
    let score = 0;
    const why = [];
    if (title && name === title) {
        score += 100;
        why.push('title=');
    } else if (title && name && (name.startsWith(title) || title.startsWith(name))) {
        score += 50;
        why.push('title~');
    }
    if (hasState(frame, Atspi.StateType.ACTIVE)) {
        score += 20;
        why.push('active');
    }
    if (width > 0 && height > 0 && r.w > 0) {
        // Apps report logical or physical pixels and may include client-side
        // shadows, so accept anything within a scale factor of 1..3.
        for (const s of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
            if (Math.abs(r.w / s - width) <= 64 && Math.abs(r.h / s - height) <= 64) {
                score += 10;
                why.push(`size@${s}`);
                break;
            }
        }
    }
    if (!name) {
        score -= 5;
        why.push('noname');
    }
    return {score, why: why.join(','), name, rect: r};
}

function findFrame(pid, title, width, height) {
    const desktop = Atspi.get_desktop(0);
    const apps = children(desktop);
    let candidates = apps.filter(a => safe(() => a.get_process_id(), -1) === pid);
    if (candidates.length === 0) {
        log(`no AT-SPI app with pid ${pid} (apps: ${apps.map(a =>
            `${shortName(a)}/${safe(() => a.get_process_id(), '?')}`).join(', ')}); ` +
            'searching all apps by title');
        candidates = apps;
    }

    let best = null;
    for (const app of candidates) {
        // libatspi caches each app's tree and only refreshes it on change
        // events. Chromium builds its tree lazily without telling us, so a
        // long-running daemon would keep seeing an empty frame forever.
        safe(() => app.clear_cache());
        for (const frame of children(app)) {
            const s = scoreFrame(frame, title, width, height);
            debug(`  candidate ${shortName(app)}: "${s.name.slice(0, 60)}" ` +
                `${s.rect.w}x${s.rect.h} score=${s.score} (${s.why})`);
            if (s.score > 0 && (!best || s.score > best.score))
                best = {...s, frame, app};
        }
    }
    if (!best)
        log(`no frame matched pid=${pid} title="${title}" size=${width}x${height}`);
    else
        debug(`picked frame "${best.name.slice(0, 60)}" score=${best.score} (${best.why})`);
    return best;
}

/*
 * Tab list discovery. Collection.GetMatches is one round trip, but:
 *  - GTK4 does not implement the Collection interface, and
 *  - Chromium builds its accessibility tree lazily, so in a fresh browser
 *    GetMatches finds nothing until something has walked the tree.
 * In both cases fall back to a bounded DFS (which also wakes Chromium up).
 */
function findPageTabLists(frame) {
    wake(frame);
    const coll = safe(() => frame.get_collection_iface());
    if (coll) {
        const found = safe(() => coll.get_matches(PAGE_TAB_LIST_RULE,
            Atspi.CollectionSortOrder.CANONICAL, 0, true), null);
        if (found?.length)
            return found;
        debug(`Collection.GetMatches ${found ? 'found nothing' : 'failed'}; falling back to DFS`);
    } else {
        debug('frame lacks Collection interface; using DFS');
    }

    const out = [];
    let visited = 0;
    const walk = (node, depth) => {
        if (visited++ > DFS_NODE_LIMIT || depth > DFS_DEPTH_LIMIT)
            return;
        for (const c of children(node)) {
            const role = safe(() => c.get_role());
            if (role === Atspi.Role.PAGE_TAB_LIST)
                out.push(c);
            else if (role !== Atspi.Role.DOCUMENT_WEB)  // page content: big, never holds the tab strip
                walk(c, depth + 1);
        }
    };
    walk(frame, 0);
    if (visited > DFS_NODE_LIMIT)
        log(`DFS hit node limit (${DFS_NODE_LIMIT}); tab list may be missing`);
    log(`DFS visited ${visited} nodes, found ${out.length} tab list(s)`);
    return out;
}

function tabsOf(ptl) {
    return children(ptl).filter(c => safe(() => c.get_role()) === Atspi.Role.PAGE_TAB);
}

/* Returns a description of ptl, or null (with a reason) if it's not usable. */
function describeTabList(ptl) {
    const attrs = attributes(ptl);
    const r = rect(ptl);
    if (attrs.hidden === 'true')
        return {reject: `hidden (class=${attrs.class})`};
    if (r.w <= 0 || r.h <= 0)
        return {reject: `zero size (class=${attrs.class})`};

    const tabObjs = tabsOf(ptl);
    const tabs = [];
    const kept = [];
    let selected = -1;
    for (const t of tabObjs) {
        const tr = rect(t);
        if (tr.w <= 0 || tr.h <= 0)
            continue;
        if (hasState(t, Atspi.StateType.SELECTED))
            selected = tabs.length;
        tabs.push({...tr, name: shortName(t)});
        kept.push(t);
    }
    if (tabs.length === 0)
        return {reject: `no visible tabs (class=${attrs.class}, ${tabObjs.length} total)`};

    const vertical = tabs.length > 1 &&
        tabs.every(t => t.x === tabs[0].x) && tabs[1].y !== tabs[0].y;
    if (vertical)
        return {reject: `vertical (class=${attrs.class})`};

    return {ptl, tabObjs: kept, tabs, selected, strip: r, cls: attrs.class ?? ''};
}

let nextToken = 1;
const remembered = new Map();  // token -> {ptl, tabObjs}

function findTabsForWindow(pid, title, width, height) {
    const t0 = GLib.get_monotonic_time();
    const elapsed = () => ((GLib.get_monotonic_time() - t0) / 1000).toFixed(1);

    const match = findFrame(pid, title, width, height);
    if (!match)
        return {ok: false, error: 'no matching AT-SPI frame'};

    const ptls = findPageTabLists(match.frame);
    const usable = [];
    for (const ptl of ptls) {
        const d = describeTabList(ptl);
        if (d.reject)
            debug(`  skipping tab list: ${d.reject}`);
        else
            usable.push(d);
    }
    if (usable.length === 0) {
        log(`"${match.name.slice(0, 60)}": ${ptls.length} tab list(s), none usable (${elapsed()}ms)`);
        return {ok: false, error: 'no usable tab list', app: shortName(match.app)};
    }

    // Prefer the strip with the most tabs; break ties by the top-most one.
    usable.sort((a, b) => b.tabs.length - a.tabs.length || a.strip.y - b.strip.y);
    const best = usable[0];

    const token = nextToken++;
    remembered.set(token, {ptl: best.ptl, tabObjs: best.tabObjs});
    for (const k of remembered.keys()) {
        if (remembered.size <= MAX_REMEMBERED_RESULTS)
            break;
        remembered.delete(k);
    }

    log(`${shortName(match.app)}: ${best.tabs.length} tabs, selected ${best.selected}, ` +
        `class=${best.cls}, frame ${match.rect.w}x${match.rect.h}@${match.rect.x},${match.rect.y} ` +
        `(match ${match.why}, ${elapsed()}ms)`);
    return {
        ok: true,
        token,
        app: shortName(match.app),
        toolkit: safe(() => match.app.get_toolkit_name(), ''),
        frame: match.rect,
        strip: best.strip,
        tabs: best.tabs,
        selected: best.selected,
    };
}

function activateTab(token, index) {
    const entry = remembered.get(token);
    if (!entry) {
        log(`activate: unknown token ${token}`);
        return false;
    }
    const tab = entry.tabObjs[index];
    if (!tab) {
        log(`activate: index ${index} out of range (${entry.tabObjs.length})`);
        return false;
    }

    // Chromium/Firefox expose a default action on tabs; GTK uses Selection.
    const action = safe(() => tab.get_action_iface());
    if (action) {
        const n = safe(() => action.get_n_actions(), 0);
        const names = [];
        for (let i = 0; i < n; i++)
            names.push(safe(() => action.get_action_name(i), ''));
        let idx = names.findIndex(a => ['doDefault', 'click', 'activate', 'press', 'switch'].includes(a));
        if (idx < 0 && n > 0)
            idx = 0;
        if (idx >= 0 && safe(() => action.do_action(idx), false)) {
            log(`activated tab ${index} "${shortName(tab)}" via action "${names[idx]}"`);
            return true;
        }
        debug(`action failed; actions were [${names.join(', ')}]`);
    }

    const sel = safe(() => entry.ptl.get_selection_iface());
    const childIndex = safe(() => tab.get_index_in_parent(), -1);
    if (sel && childIndex >= 0 && safe(() => sel.select_child(childIndex), false)) {
        log(`activated tab ${index} "${shortName(tab)}" via Selection.select_child(${childIndex})`);
        return true;
    }
    log(`activate: no way to activate tab ${index} "${shortName(tab)}"`);
    return false;
}

class Service {
    GetTabs(pid, title, width, height) {
        debug(`GetTabs pid=${pid} title="${title}" size=${width}x${height}`);
        let result;
        try {
            result = findTabsForWindow(pid, title, width, height);
        } catch (e) {
            log(`GetTabs failed: ${e.message}\n${e.stack}`);
            result = {ok: false, error: e.message};
        }
        return JSON.stringify(result);
    }

    ActivateTab(token, index) {
        try {
            return activateTab(token, index);
        } catch (e) {
            log(`ActivateTab failed: ${e.message}`);
            return false;
        }
    }
}

function listFrames() {
    for (const app of children(Atspi.get_desktop(0))) {
        for (const f of children(app)) {
            const r = rect(f);
            print(`${shortName(app)} pid=${safe(() => app.get_process_id(), '?')} ` +
                `${hasState(f, Atspi.StateType.ACTIVE) ? 'ACTIVE ' : ''}` +
                `${r.w}x${r.h} "${shortName(f)}"`);
        }
    }
}

function cliQuery(needle) {
    // Without the shell we don't know the pid, so find it from the title (or
    // the ACTIVE frame) and then run the same lookup the service would.
    for (const app of children(Atspi.get_desktop(0))) {
        for (const f of children(app)) {
            const name = safe(() => f.get_name(), '') ?? '';
            const hit = needle ? name.includes(needle) : hasState(f, Atspi.StateType.ACTIVE);
            if (!hit)
                continue;
            const r = rect(f);
            const res = findTabsForWindow(app.get_process_id(), name, r.w, r.h);
            print(JSON.stringify(res, null, 2));
            return;
        }
    }
    print(needle ? `no frame title contains "${needle}"` : 'no ACTIVE frame; pass a title substring');
}

function main(argv) {
    Atspi.init();
    Atspi.set_timeout(ATSPI_TIMEOUT_MS, ATSPI_TIMEOUT_MS);

    if (argv[0] === '--list') {
        listFrames();
        return 0;
    }
    if (argv[0] === '--query') {
        cliQuery(argv[1] ?? '');
        return 0;
    }

    const loop = new GLib.MainLoop(null, false);
    const impl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, new Service());
    Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE,
        conn => impl.export(conn, OBJECT_PATH),
        () => log(`owns ${BUS_NAME}`),
        () => {
            log(`lost or could not acquire ${BUS_NAME}; exiting`);
            loop.quit();
        });
    loop.run();
    return 0;
}

System.exit(main(ARGV));
