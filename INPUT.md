Let's build a Linux program that will support a three-finger
tab-switch gesture on Linux GNOME with Google Chrome browser or other
applications. The idea is when the user does a three-finger left/right
gesture, we will use AT-SPI2 to find out which is the front-most
window and, if it's Chrome (or has tabs), we draw some kind of
highlight where that tab is on screen. If the user lets go (ie, ends
the gesture), we activate the highlighted tab.

This seems best as a GNOME extension, but feel free to suggest changes
there (e.g. if there should be a daemon).

Getting the logic to get the tabs may be a bit tricky and require some
per-app code. Google Chrome is running right now and can be queried
with the command 'gjs dump-tree.js x'. Current tabs include "Inbox",
"Avoid tearing..." etc.

An older, and possibly broken, extension working towards this is in
extension.js.

In the past, sometimes the top-most window was not easy to find with
AT-SPI2, as sometimes it wouldn't show as active. As we develop this,
it will be good to add logging to be able to see what goes wrong.
