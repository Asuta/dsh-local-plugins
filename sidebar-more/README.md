# Sidebar More and pinned conversations

## 1.0.1 — unified pinned conversation rows

The top pinned section retains its position, collapse preference, filters, running-first/recent-update ordering, and eight-row scroll limit.

Pinned rows now use the workspace owner's authorized child slot renderer for native leading decorations, hover-card sections, row actions (archive and pin), and the session menu (pin, rename, fork, archive, copy Session ID, plus compatible third-party additions). Native operation implementations, permissions, confirmations, and menu state remain owned by the workspace plugin.

There is no exported native whole-row factory in DSH 0.2.1-rc.3. The row shell mirrors SessionNodeItem, uses its loaded stylesheet class prefix, existing shared Menu/HoverCard/StateDot primitives, relative-time formatter, and the same session-status snapshot. Pending interactions, running subagents, and unread completion indicators follow native precedence. Selection, title marquee, pin indicator, age, menu visibility, double-click rename, and button propagation match native behavior.

A guarded component wrapper borrows the original workspace registration's renderSlot without replacing its children, store, injection, or permissions. This integration is version-coupled, not a public whole-row API. Unknown entries or absent native CSS use the original minimal pinned-row fallback. Unloading restores the exact original component descriptor unless another plugin has replaced it.

## Verification

- `node --check sidebar-more/client.js`
- `node --test .sidebar-more/pinned.test.mjs`: 41 isolated behavior tests pass.
- `git diff --check -- sidebar-more` passes.
- Bundle 1.0.1 installed with `application: applied`, no bundle warnings. Native workspace ownership and pinned footer registration remain active.
- Automated browser window reached the GUI authentication screen; actual visual layout and menu clicks were not verified in the signed-in Desktop page. Reload that frontend (Ctrl+R) to ensure the updated client script is loaded. No real session was archived, unpinned, renamed, or forked for testing.

Updated 2026-10-26 (Asia/Shanghai).
