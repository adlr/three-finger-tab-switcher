/*
 * Usage:
 *    gjs dump-tree <application-name>
 *
 * Dump the accessibility hiearchy tree for a given application.
 */

/*
  Notes for adlr: check dumped graph for "page tab list"
  common command line:
  sleep 1 && gjs dump-tree.js "org.gnome.Terminal"   | less
  (switch right away to the window you want)

  */

const GObject = imports.gi.GObject;
const Atspi = imports.gi.Atspi;

const DEBUG = true;
let debug = undefined;
if (DEBUG) {
    debug = s => log(s);
}
function get_states(ss) {
    const ret = [];
    if (ss.contains(Atspi.StateType.ACTIVE)) {
        ret.push("ACTIVE");
    }
    if (ss.contains(Atspi.StateType.ANIMATED)) {
        ret.push("ANIMATED");
    }
    if (ss.contains(Atspi.StateType.ARMED)) {
        ret.push("ARMED");
    }
    if (ss.contains(Atspi.StateType.BUSY)) {
        ret.push("BUSY");
    }
    if (ss.contains(Atspi.StateType.CHECKED)) {
        ret.push("CHECKED");
    }
    if (ss.contains(Atspi.StateType.COLLAPSED)) {
        ret.push("COLLAPSED");
    }
    if (ss.contains(Atspi.StateType.DEFUNCT)) {
        ret.push("DEFUNCT");
    }
    if (ss.contains(Atspi.StateType.EDITABLE)) {
        ret.push("EDITABLE");
    }
    if (ss.contains(Atspi.StateType.ENABLED)) {
        ret.push("ENABLED");
    }
    if (ss.contains(Atspi.StateType.EXPANDABLE)) {
        ret.push("EXPANDABLE");
    }
    if (ss.contains(Atspi.StateType.EXPANDED)) {
        ret.push("EXPANDED");
    }
    if (ss.contains(Atspi.StateType.FOCUSABLE)) {
        ret.push("FOCUSABLE");
    }
    if (ss.contains(Atspi.StateType.FOCUSED)) {
        ret.push("FOCUSED");
    }
    if (ss.contains(Atspi.StateType.HAS_TOOLTIP)) {
        ret.push("HAS_TOOLTIP");
    }
    if (ss.contains(Atspi.StateType.HORIZONTAL)) {
        ret.push("HORIZONTAL");
    }
    if (ss.contains(Atspi.StateType.ICONIFIED)) {
        ret.push("ICONIFIED");
    }
    if (ss.contains(Atspi.StateType.INDETERMINATE)) {
        ret.push("INDETERMINATE");
    }
    if (ss.contains(Atspi.StateType.INVALID)) {
        ret.push("INVALID");
    }
    if (ss.contains(Atspi.StateType.INVALID_ENTRY)) {
        ret.push("INVALID_ENTRY");
    }
    if (ss.contains(Atspi.StateType.IS_DEFAULT)) {
        ret.push("IS_DEFAULT");
    }
    if (ss.contains(Atspi.StateType.LAST_DEFINED)) {
        ret.push("LAST_DEFINED");
    }
    if (ss.contains(Atspi.StateType.MANAGES_DESCENDANTS)) {
        ret.push("MANAGES_DESCENDANTS");
    }
    if (ss.contains(Atspi.StateType.MODAL)) {
        ret.push("MODAL");
    }
    if (ss.contains(Atspi.StateType.MULTISELECTABLE)) {
        ret.push("MULTISELECTABLE");
    }
    if (ss.contains(Atspi.StateType.MULTI_LINE)) {
        ret.push("MULTI_LINE");
    }
    if (ss.contains(Atspi.StateType.OPAQUE)) {
        ret.push("OPAQUE");
    }
    if (ss.contains(Atspi.StateType.PRESSED)) {
        ret.push("PRESSED");
    }
    if (ss.contains(Atspi.StateType.REQUIRED)) {
        ret.push("REQUIRED");
    }
    if (ss.contains(Atspi.StateType.RESIZABLE)) {
        ret.push("RESIZABLE");
    }
    if (ss.contains(Atspi.StateType.SELECTABLE)) {
        ret.push("SELECTABLE");
    }
    if (ss.contains(Atspi.StateType.SELECTABLE_TEXT)) {
        ret.push("SELECTABLE_TEXT");
    }
    if (ss.contains(Atspi.StateType.SELECTED)) {
        ret.push("SELECTED");
    }
    if (ss.contains(Atspi.StateType.SENSITIVE)) {
        ret.push("SENSITIVE");
    }
    if (ss.contains(Atspi.StateType.SHOWING)) {
        ret.push("SHOWING");
    }
    if (ss.contains(Atspi.StateType.SINGLE_LINE)) {
        ret.push("SINGLE_LINE");
    }
    if (ss.contains(Atspi.StateType.STALE)) {
        ret.push("STALE");
    }
    if (ss.contains(Atspi.StateType.SUPPORTS_AUTOCOMPLETION)) {
        ret.push("SUPPORTS_AUTOCOMPLETION");
    }
    if (ss.contains(Atspi.StateType.TRANSIENT)) {
        ret.push("TRANSIENT");
    }
    if (ss.contains(Atspi.StateType.TRUNCATED)) {
        ret.push("TRUNCATED");
    }
    if (ss.contains(Atspi.StateType.VERTICAL)) {
        ret.push("VERTICAL");
    }
    if (ss.contains(Atspi.StateType.VISIBLE)) {
        ret.push("VISIBLE");
    }
    if (ss.contains(Atspi.StateType.VISITED)) {
        ret.push("VISITED");
    }
    return ret.join(",");
}

function getLabel(accessible) {
    let relationSet;
    let i = 0;

    relationSet = accessible.get_relation_set();
    if (!relationSet)
        return "NULL";

    /* something like "let relation in relationSet" doesn't work, and
     * it seems that GArray "len" is not exposed */
    while (relationSet[i]) {
        let relation = relationSet[i];

        if (relation.get_relation_type() == Atspi.RelationType.LABELLED_BY)
            return relation.get_target(0).get_name();

        i++;
    }

    return "NULL";
}

function printInfo(accessible, appName) {
    let name;
    let roleName = "NULL";
    let stateSetString = "NULL";

    name = accessible.get_name();
    if (!name)
        name = getLabel(accessible);
    roleName = accessible.get_role_name();
    layer = accessible.get_layer();

    const pos = accessible.get_position(Atspi.CoordType.WINDOW);
    const size = accessible.get_size();
    const pt = ` L:${layer} S(${get_states(accessible.get_state_set())}) (${pos.x}, ${pos.y}, ${size.x}, ${size.y})`;
    return "("+name+", "+roleName+", "+pt+")";
}

function dumpNodeContent(node, padding, path) {
    let newPadding = padding + "  ";

    nodeInfo = printInfo(node);
    print(padding + nodeInfo + ` P: ${path}${node.get_state_set().contains(Atspi.StateType.SELECTED) ? "SELECTED" : ""}`);

    print(`${padding}there are ${node.get_child_count()} children`);
    for (let i = 0; i < node.get_child_count(); i++) {
        const newPath = [...path, i];
        const child = node.get_child_at_index(i);
        if (path.length === 0 && child !== null && child.get_state_set().contains(Atspi.StateType.ACTIVE)) {
            print("ACTIVEWINDOW:");
        }
        if (child) {
            dumpNodeContent(node.get_child_at_index(i), newPadding, newPath);
        } else {
            print(`${newPadding}(skipping NULL child)`);
        }
    }
    //print(`${padding}done`);
}

// returns [x, y, width, height]
function pos(acc) {
    const pos = acc.get_position(Atspi.CoordType.WINDOW);
    const size = acc.get_size();
    const states = acc.get_state_set();
    const selected = states.contains(Atspi.StateType.SELECTED);
    return [pos.x, pos.y, size.x, size.y, selected ? "*" : ""  /*, get_states(states)*/]
}

function descend(root, path) {
    let out = root;
    while (path.length != 0) {
        // print(`Path: ${path}, out: ${out}`);
        print(`Descend at ${pos(out)}, ${out.get_role()}`);
        out = out.get_child_at_index(path.shift());
    }
    // print(`out: ${out}`);
    return out;
}

function dumpWindows(app) {
    for (let i = 0; i < app.get_child_count(); i++) {
        print(`window ${i}, ${pos(app.get_child_at_index(i))}`);
    }
}

function chromeTabStrip(acc) {
    strip = descend(acc, [0,0,0,5,0,0,1,0]);
    for (let i = 0; i < strip.get_child_count(); i++) {
        tab = strip.get_child_at_index(i);
        print(pos(tab));
    }
}

function findActiveWindow(node, haveWindow, havePageTabList, pad) {
    const np = pad + "  ";
    if (!haveWindow) {
        print(`${pad}looking for window`);
        // Try to find the window first
        let ret = null;
        for (let i = 0; i < node.get_child_count(); i++) {
            const child = node.get_child_at_index(i);
            if (child !== null && child.get_state_set().contains(Atspi.StateType.ACTIVE)) {
                print(`${pad}found window`);
                ret = findActiveWindow(child, true, false, np);
                break;
            }
        }
        return ret;
    }
    if (!havePageTabList) {
        print(`${pad}Looking for page tab list`);
        let ret = null;
        for (let i = 0; i < node.get_child_count(); i++) {
            const child = node.get_child_at_index(i);
            if (child !== null) {
                print(`${pad}found PTL`);
                ret = findActiveWindow(child, true, child.get_role() === Atspi.Role.PAGE_TAB_LIST, np);
                if (ret !== null) {
                    break;
                }
            }
        }
        return ret;
    }
    // Find the tabs
    print(`${pad}looking for tabs`);
    let ret = null;
    let tabs = [];
    for (let i = 0; i < node.get_child_count(); i++) {
        const child = node.get_child_at_index(i);
        if (child === null) {
            continue;
        }
        if (child.get_role() !== Atspi.Role.PAGE_TAB) {
            ret = findActiveWindow(child, true, true, np);
            if (ret !== null) {
                break;
            }
        } else {
            // Have a tab!
            tabs.push(pos(child));
        }
    }
    if (tabs.length > 1 && tabs[0][0] === tabs[1][0]) {
        // Vertical tabs, skip
        return ret;
    }
    return tabs.length !== 0 ? tabs : ret;
}

function dumpApplication(appName) {
    let desktop;
    let found = false;

    Atspi.init();
    Atspi.set_timeout(10000, 10000);

    desktop = Atspi.get_desktop (0);
    for(let i =0; i < desktop.get_child_count(); i++) {
        let app = desktop.get_child_at_index(i);
        tabs = findActiveWindow(app, false, false, "--");
        if (tabs) {
            for (let i = 0; i < tabs.length; i++) {
                print(`tab: ${tabs[i]}`);
            }
        }
        print(app.get_name());
        //dumpWindows(app);
        if (app.get_name() == appName) {
            found = true;
            dumpNodeContent(app, "  ", []);
            //chromeTabStrip(app);
        }
    }

    if (!found) {
        print ("ERROR: Application "+appName+" not found");
    }
}
const PAGE_TAB_LIST_MATCH_RULE = Atspi.MatchRule.new(Atspi.StateSet.new([]), Atspi.CollectionMatchType.ALL,
    {}, Atspi.CollectionMatchType.ANY,
    [Atspi.Role.PAGE_TAB_LIST], Atspi.CollectionMatchType.ANY,
    [], Atspi.CollectionMatchType.ALL,
    false
);
const TAB_MATCH_RULE = Atspi.MatchRule.new(Atspi.StateSet.new([]), Atspi.CollectionMatchType.ALL,
    {}, Atspi.CollectionMatchType.ANY,
    [Atspi.Role.PAGE_TAB], Atspi.CollectionMatchType.ANY,
    [], Atspi.CollectionMatchType.ALL,
    false
);
const ACTIVE_FRAME_MATCH_RULE =
      Atspi.MatchRule.new(Atspi.StateSet.new([Atspi.StateType.ACTIVE]),
                          Atspi.CollectionMatchType.ALL,
                          {}, Atspi.CollectionMatchType.ANY,
                          [Atspi.Role.FRAME], Atspi.CollectionMatchType.ANY,
                          [], Atspi.CollectionMatchType.ALL,
                          false
                         );

const STATES = {
    "INVALID": Atspi.StateType.INVALID ,
    "ACTIVE": Atspi.StateType.ACTIVE ,
    "ARMED": Atspi.StateType.ARMED ,
    "BUSY": Atspi.StateType.BUSY ,
    "CHECKED": Atspi.StateType.CHECKED ,
    "COLLAPSED": Atspi.StateType.COLLAPSED ,
    "DEFUNCT": Atspi.StateType.DEFUNCT ,
    "EDITABLE": Atspi.StateType.EDITABLE ,
    "ENABLED": Atspi.StateType.ENABLED ,
    "EXPANDABLE": Atspi.StateType.EXPANDABLE ,
    "EXPANDED": Atspi.StateType.EXPANDED ,
    "FOCUSABLE": Atspi.StateType.FOCUSABLE ,
    "FOCUSED": Atspi.StateType.FOCUSED ,
    "HAS_TOOLTIP": Atspi.StateType.HAS_TOOLTIP ,
    "HORIZONTAL": Atspi.StateType.HORIZONTAL ,
    "ICONIFIED": Atspi.StateType.ICONIFIED ,
    "MODAL": Atspi.StateType.MODAL ,
    "MULTI_LINE": Atspi.StateType.MULTI_LINE ,
    "MULTISELECTABLE": Atspi.StateType.MULTISELECTABLE ,
    "OPAQUE": Atspi.StateType.OPAQUE ,
    "PRESSED": Atspi.StateType.PRESSED ,
    "RESIZABLE": Atspi.StateType.RESIZABLE ,
    "SELECTABLE": Atspi.StateType.SELECTABLE ,
    "SELECTED": Atspi.StateType.SELECTED ,
    "SENSITIVE": Atspi.StateType.SENSITIVE ,
    "SHOWING": Atspi.StateType.SHOWING ,
    "SINGLE_LINE": Atspi.StateType.SINGLE_LINE ,
    "STALE": Atspi.StateType.STALE ,
    "TRANSIENT": Atspi.StateType.TRANSIENT ,
    "VERTICAL": Atspi.StateType.VERTICAL ,
    "VISIBLE": Atspi.StateType.VISIBLE ,
    "MANAGES_DESCENDANTS": Atspi.StateType.MANAGES_DESCENDANTS ,
    "INDETERMINATE": Atspi.StateType.INDETERMINATE ,
    "REQUIRED": Atspi.StateType.REQUIRED ,
    "TRUNCATED": Atspi.StateType.TRUNCATED ,
    "ANIMATED": Atspi.StateType.ANIMATED ,
    "INVALID_ENTRY": Atspi.StateType.INVALID_ENTRY ,
    "SUPPORTS_AUTOCOMPLETION": Atspi.StateType.SUPPORTS_AUTOCOMPLETION ,
    "SELECTABLE_TEXT": Atspi.StateType.SELECTABLE_TEXT ,
    "IS_DEFAULT": Atspi.StateType.IS_DEFAULT ,
    "VISITED": Atspi.StateType.VISITED ,
    "CHECKABLE": Atspi.StateType.CHECKABLE ,
    "HAS_POPUP": Atspi.StateType.HAS_POPUP ,
    "READ_ONLY": Atspi.StateType.READ_ONLY ,
    "LAST_DEFINED": Atspi.StateType.LAST_DEFINED
};

function getStates(set) {
    let ret = '';
    for (const [value, key] of Object.entries(STATES)) {
        if (set.contains(key)) {
            ret = `${ret}, ${value}`;
        }
    };
    return ret;
}

function getActiveFrame(app) {
    const coll_iface = app.get_collection_iface();
    if (coll_iface === null) {
        debug?.("No collection interface on this app");
        return;
    }
    const active_frames = coll_iface.get_matches(ACTIVE_FRAME_MATCH_RULE, Atspi.CollectionSortOrder.CANONICAL,
        0, true
    );
    debug?.(`Got ${active_frames.length} possible active frames`);
    for (let i = 0; i < active_frames.length; i++) {
        const active_frame = active_frames[i];
        debug?.(`Got active frame: ${active_frame.get_name()}`);
    }
    debug?.(`done listing active frames`);
}

function formatFoundTabs(plt, tabs) {
    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const pos = tab.get_position(Atspi.CoordType.WINDOW);
        const size = tab.get_size();
        const selected = tab.get_state_set().contains(Atspi.StateType.SELECTED);
        debug?.(`${i}: ${pos.x}, ${pos.y}, w: ${size.x}, h: ${size.y}, ${tab.get_name()}${selected ? " SELECTED":""}`);
    }
}

/**
 * 
 * @param {Atspi.Accessible} node Root node to search
 * @param {boolean} haveWindow Window was found (set to false when starting)
 * @param {null | [number, number]} pageTabListBounds Bounds of page tab list
 * @param {string} pad Padding for debug prints
 * @returns {null | {
*   tabs: [number, number, number, number][],
*   tabObjs: Atspi.Accessible[],
*   selectedIdx: number,
*   tabBounds: [number, number],
*   pageTabList: Atspi.Selection
* }}
*/
function findTabDetails2(node, haveWindow, pageTabListBounds, pad) {
    // Find window
    let child = null;
    //node.clear_cache();
    const dummy2 = node.get_attributes();
    debug?.(`App child count: ${node.get_child_count()}`);
    for (let i = 0; i < node.get_child_count(); i++) {
        const test_child = node.get_child_at_index(i);
        const dummy = test_child.get_attributes();
        console.log(`Child ${i}: ${test_child.get_name()}, role: ${test_child.get_role_name()}, states: ${getStates(test_child.get_state_set())}`);
        if (test_child !== null && test_child.get_state_set().contains(Atspi.StateType.ACTIVE)) {
            test_child.clear_cache_single();
            if (test_child.get_collection_iface() === null) {
                debug?.(`test child lacks collection iface!`);
                return null;
            }
            child = test_child;
            break;
        }
    }
    if (child === null) {
        debug?.(`No active windows found for app ${node.get_name()}`);
        debug?.(`Hacking, using first window`);
        //return null;
        child = node.get_child_at_index(0);
    }

    // Poke at it
    //const dummy = new GObject.Value();
    //child.get_property("org.a11y.atspi.Accessible.Attributes", dummy);
    if (child === null)
        return null;
    const attrs = child.get_attributes();
    for (let i = 0; i < child.get_child_count(); i++) {
        let temp = child.get_child_at_index(i);
        let tries = 3;
        while (temp === null && tries >= 0) {
            tries--;
            debug?.(`Trying to get child again...`);
            temp = child.get_child_at_index(i);
        }
        debug?.(`Got child ${i},`);
        if (temp !== null) {
            debug?.(` ${temp.get_child_count()}`);
        }
    }

    if (child.get_collection_iface() === null)
        return null;
    const ptls = child.get_collection_iface().get_matches(PAGE_TAB_LIST_MATCH_RULE, Atspi.CollectionSortOrder.CANONICAL,
        0, true
    );
    debug?.(`Got ${ptls.length} possible PTLs`);
    for (let i = 0; i < ptls.length; i++) {
        const ptl = ptls[i];
        const tabs = ptl.get_collection_iface().get_matches(TAB_MATCH_RULE, Atspi.CollectionSortOrder.CANONICAL,
            0, true
        );
        debug?.(`Got tabs: ${tabs}`);
        if (tabs && tabs.length > 0) {
            if ((i + 1) < ptls.length && tabs.length > 1 &&
                tabs[0].get_position(Atspi.CoordType.WINDOW).x === tabs[1].get_position(Atspi.CoordType.WINDOW).x) {
                debug?.(`Skipping PTL`);
                //continue;
            }
            // Got our answer
            /*return*/ formatFoundTabs(ptl, tabs);
        }
    }
    debug?.(`returning nothing!`);
    return null;
}

function findTabs(shouldClear) {
    const desktop = Atspi.get_desktop(0);
    if (shouldClear) {
        desktop.clear_cache();
    }
    desktop.get_attributes();
    const nchild = desktop.get_child_count();
    for (let i = 0; i < nchild; i++) {
        const app = desktop.get_child_at_index(i);
        getActiveFrame(app);
        console.log("\nAPP: " + app.get_name());
        // if (app.get_name() !== "Google Chrome")
        //     continue;
        if (shouldClear) {
            app.clear_cache();
        }
        const start = new Date().getTime();
        const tabs = findTabDetails2(app, false, null, "--");
        const end = new Date().getTime();
        if (tabs) {
            debug?.(`TIME TO FIND TABS: ${end - start}`);
            return tabs;
        }
    }
    return null;
}


if (ARGV.length == 1) {
    let appName = ARGV[0];

    //dumpApplication(appName);
    const tabs = findTabs(false);
} else {
    print("ERROR: We only dump the content of a specific app, specify the name");
}

