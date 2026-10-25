/**
 * Sidebar compaction and pinned conversations (browser half).
 *
 * Part one — panel list compaction:
 * - the shell always renders the `plugins` row first and forbids unpinning it,
 *   so that row is hidden with CSS and re-exposed as a row inside 「更多」;
 * - the `schedules` row stays pinned (so its panel keeps working) but is hidden
 *   with CSS and likewise re-exposed as a row inside 「更多」.
 *
 * Both moved rows call `onDismiss()` before `onOpen(id)`, matching the shell's
 * own More-menu behaviour.
 *
 * Part two — 「置顶」 section:
 * The shell has no slot between the panel rows and the workspace browsing
 * region (`sidebar.workspaces` is one single-registrant seat that owns the whole
 * region), so this rides `sidebar.footer.action` like the 最近 section does and
 * portals its own DOM into the browsing region: the 「工作区」 header is the
 * anchor, and the block is inserted directly before it, which places it exactly
 * between 「更多」 and 「工作区」.
 *
 * The anchor is re-resolved and the node re-inserted whenever the shell mutates
 * the sidebar, because every shell row is its own fiber and plain DOM children
 * added by a slot are not part of React's reconciliation. The section is
 * `flex: none`, so it stays put while the workspace list scrolls beneath it.
 */
window.__ModuleLoader__.load({
  id: '@local/sidebar-more',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Sidebar rows that move into 「更多」; the plugins row is always rendered first by the shell. */
    const HIDDEN_ROWS = [
      'nav[class*="panelList"] > :first-child',
      'nav[class*="panelList"] button[aria-label="插件"]',
      'nav[class*="panelList"] button[aria-label="Plugins"]',
      'nav[class*="panelList"] button[aria-label="自动化任务"]',
      'nav[class*="panelList"] button[aria-label="Automation tasks"]',
    ]

    const CSS = [
      ...HIDDEN_ROWS.map((selector) => `${selector} { display: none !important; }`),
      // 「置顶」 section. Every row is 32px, matching a workspace session row, and
      // the list stops at eight rows before wrapping into its own scroller so a
      // long pin list cannot push the workspace tree off the column.
      `.sm-pin-section { flex: none; display: flex; flex-direction: column; min-height: 0; padding-bottom: 2px; }`,
      `.sm-pin-header { display: flex; align-items: center; flex: none; height: 26px; }`,
      `.sm-pin-toggle { display: flex; align-items: center; justify-content: flex-start; gap: 4px;
        flex: 1; min-width: 0; height: 22px; margin: 0 0 0 -6px; padding: 0 6px; border: 0;
        border-radius: var(--dsw-radius-sm); background: none; color: var(--dsw-alias-label-tertiary);
        font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
      .sm-pin-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
      .sm-pin-toggle:focus-visible { outline: 1px solid var(--dsw-alias-label-tertiary); outline-offset: 1px; }`,
      `.sm-pin-chevron { width: 12px; height: 12px; flex: none; transform: rotate(0deg); transition: transform 120ms ease; }`,
      `.sm-pin-chevron-open { transform: rotate(90deg); }`,
      `.sm-pin-list { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0;
        list-style: none; max-height: 268px; overflow-y: auto; overscroll-behavior: contain;
        scrollbar-width: thin; }`,
      `.sm-pin-item { margin: 0; padding: 0; }`,
      `.sm-pin-row { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 4px 0 8px;
        border-radius: var(--dsw-radius-md); color: var(--dsw-alias-label-primary);
        font-size: 13px; cursor: pointer; user-select: none; }
      .sm-pin-row:hover, .sm-pin-row:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
      .sm-pin-row:focus-visible { outline: none; }
      .sm-pin-row[aria-current="page"] { background: var(--dsw-specific-sidebar-nav-item-active); }`,
      `.sm-pin-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
      `.sm-pin-action { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;
        flex: none; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
        color: var(--dsw-alias-label-tertiary); cursor: pointer; opacity: 0; transition: opacity 120ms ease; }
      .sm-pin-action svg { width: 14px; height: 14px; }
      .sm-pin-row:hover .sm-pin-action, .sm-pin-action:focus-visible { opacity: 1; }
      .sm-pin-action:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }`,
    ].join('\n')

    const TAG_ID = '@local/sidebar-more/sidebar-more.css'

    const en = { plugins: 'Plugins', schedules: 'Automation tasks', pinned: 'Pinned', unpin: 'Unpin', untitled: 'Untitled' }
    const zh = { plugins: '插件', schedules: '自动化任务', pinned: '置顶', unpin: '取消置顶', untitled: '未命名' }

    const EXPANDED_STORE_KEY = 'sidebar-more:view.pinnedExpanded'

    /** Stand-in for the slot's store hooks so a missing share cannot break the column. */
    const NOOP_STORE = () => undefined

    /** Localized copy: the registration's `t`, falling back to the browser language. */
    function translator(t) {
      const fallback = String(navigator.language || '').toLowerCase().startsWith('zh') ? zh : en
      return (key) => (typeof t === 'function' ? t(key) : fallback[key])
    }

    function loadExpanded() {
      try {
        const raw = window.localStorage.getItem(EXPANDED_STORE_KEY)
        return raw === null ? true : raw === 'true'
      } catch {
        return true
      }
    }

    function saveExpanded(expanded) {
      try {
        window.localStorage.setItem(EXPANDED_STORE_KEY, String(expanded))
      } catch {
        // Storage being unavailable only loses the fold state, never the section.
      }
    }

    /**
     * Where the section belongs: immediately above the 「工作区」 header inside the
     * browsing region. The header itself is the anchor, so the block lands above
     * it however the shell nests that header inside the region; the scroller and
     * the first project group are fallbacks for a header that is not rendered.
     * Classes are matched by suffix, never by the build-specific hash prefix.
     * @returns `{ parent, before }`, or undefined while the region is unmounted.
     */
    function workspaceSectionAnchor() {
      const wrapper = document.querySelector('[class*="regionArea"]')
      const scope = wrapper ?? document
      const header = scope.querySelector('[class*="_sectionHeader"]')
      if (header instanceof HTMLElement && header.parentElement instanceof HTMLElement) {
        return { parent: header.parentElement, before: header }
      }
      const area =
        scope.querySelector('[class*="_listArea"]') ??
        scope.querySelector('[class*="_groupSection"]')?.parentElement
      const parent = area?.parentElement
      return parent instanceof HTMLElement ? { parent, before: null } : undefined
    }

    /**
     * Put the section directly above the anchor, without moving it needlessly —
     * a re-insert would restart the hover state and the list's scroll position.
     * @param node - the portalled section, or null before it mounts.
     * @param anchor - target returned by {@link workspaceSectionAnchor}.
     */
    function placeSection(node, anchor) {
      if (node === null) return
      if (anchor.before !== null) {
        if (node.parentElement === anchor.parent && node.nextElementSibling === anchor.before) return
        anchor.parent.insertBefore(node, anchor.before)
        return
      }
      if (node.parentElement === anchor.parent && anchor.parent.firstElementChild === node) return
      anchor.parent.prepend(node)
    }

    /**
     * The session in the main view, drawn as the current row like the shell does.
     * Selection lives in the session's own local retain count for the main view,
     * not in a `current` field of the catalog.
     */
    function currentSessionId(list) {
      const byId = list?.byId
      if (byId === null || byId === undefined) return undefined
      for (const id of Object.keys(byId)) {
        const session = byId[id]
        if ((session?.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    /**
     * Every pinned conversation, as rows. The pin set comes from the workspace
     * catalog and the titles from the session catalog; the filters and the order
     * mirror the shell's own row derivation: subagent runs, blank drafts and
     * archived sessions never appear, running sessions come first and the rest
     * follow by most recent update.
     * @returns `{ id, title, updatedAt, running }[]`.
     */
    function pinnedRows(list, workspaces) {
      const byId = list?.byId
      const pinned = workspaces?.pinnedSessionIds
      if (byId === null || byId === undefined || !Array.isArray(pinned)) return []
      const archived = new Set(Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : [])

      const rows = []
      for (const id of pinned) {
        const session = byId[id]
        if (session === undefined || session === null) continue
        if (session.origin === 'subagent') continue
        if (session.blank === true) continue
        if (archived.has(id)) continue
        rows.push({
          id,
          title: typeof session.displayTitle === 'string' ? session.displayTitle : '',
          updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
          running: session.running === true,
        })
      }
      rows.sort((left, right) => (Number(right.running) - Number(left.running)) || (right.updatedAt - left.updatedAt))
      return rows
    }

    /** One pinned conversation: opens on click, unpins from the hover control. */
    function PinnedRow({ row, current, label, onOpen, onUnpin }) {
      return React.createElement(
        'li',
        { className: 'sm-pin-item' },
        React.createElement(
          'div',
          {
            className: 'sm-pin-row',
            role: 'button',
            tabIndex: 0,
            title: row.title,
            'aria-current': current ? 'page' : undefined,
            onClick: () => { onOpen(row.id) },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onOpen(row.id)
            },
          },
          React.createElement('span', { className: 'sm-pin-title' }, row.title === '' ? label('untitled') : row.title),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'sm-pin-action',
              'aria-label': label('unpin'),
              title: label('unpin'),
              onClick: (event) => {
                event.stopPropagation()
                onUnpin(row.id)
              },
            },
            React.createElement(primitives.IconPinFillRegular, null),
          ),
        ),
      )
    }

    /**
     * The 「置顶」 section, portalled above the 「工作区」 header. It renders nothing
     * in the rail and nothing while no conversation is pinned, so the column
     * keeps its exact shape until the operator pins something.
     */
    function PinnedSection(props) {
      const list = (props.useSessions ?? NOOP_STORE)((snapshot) => snapshot)
      const workspaces = (props.useWorkspaces ?? NOOP_STORE)((snapshot) => snapshot)
      const label = translator(props.t)
      const rows = React.useMemo(() => pinnedRows(list, workspaces), [list, workspaces])
      const current = currentSessionId(list)
      const [expanded, setExpanded] = React.useState(loadExpanded)
      const [anchor, setAnchor] = React.useState(undefined)
      const section = React.useRef(null)

      const wide = props.wide === true
      const visible = wide && rows.length > 0

      // Anchor the section: resolve the region, then keep re-asserting it while
      // the shell re-renders the workspace browser, because DOM children a slot
      // appends are not part of the shell's own reconciliation.
      React.useEffect(() => {
        if (!wide) {
          setAnchor(undefined)
          return undefined
        }
        let scheduled = false
        let frame = 0
        const place = () => {
          scheduled = false
          const next = workspaceSectionAnchor()
          if (next === undefined) return
          setAnchor((previous) =>
            previous !== undefined && previous.parent === next.parent && previous.before === next.before ? previous : next)
          placeSection(section.current, next)
        }
        place()
        // Only the sidebar rebuilds matter; the conversation stream mutates the
        // rest of the document constantly and must not cost a scan per frame.
        const relevant = (target) => {
          const region = document.querySelector('[class*="regionArea"]')
          if (!(region instanceof HTMLElement)) return true
          return region === target || region.contains(target) || target.contains(region)
        }
        const observer = new MutationObserver((records) => {
          if (scheduled) return
          for (const record of records) {
            if (!relevant(record.target)) continue
            scheduled = true
            frame = window.requestAnimationFrame(place)
            return
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          window.cancelAnimationFrame(frame)
        }
      }, [wide])

      // The portal mounts after the region resolves, so the pass above cannot see
      // the node yet; put it in place before paint as soon as it exists.
      React.useLayoutEffect(() => {
        if (anchor === undefined) return
        placeSection(section.current, anchor)
      }, [anchor, expanded, visible])

      if (!visible || anchor === undefined) return null

      const body = React.createElement(
        'section',
        {
          ref: section,
          className: 'sm-pin-section',
          'data-plugin': '@local/sidebar-more',
          'data-slot': 'sidebar.pinned.section',
          'aria-label': label('pinned'),
        },
        React.createElement(
          'div',
          { className: 'sm-pin-header' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'sm-pin-toggle',
              'aria-expanded': expanded,
              onClick: () => {
                setExpanded((value) => {
                  saveExpanded(!value)
                  return !value
                })
              },
            },
            React.createElement('span', null, label('pinned')),
            React.createElement(primitives.IconChevronRightOutlineRegular, {
              className: expanded ? 'sm-pin-chevron sm-pin-chevron-open' : 'sm-pin-chevron',
            }),
          ),
        ),
        expanded &&
          React.createElement(
            'ul',
            { className: 'sm-pin-list' },
            rows.map((row) =>
              React.createElement(PinnedRow, {
                key: row.id,
                row,
                current: row.id === current,
                label,
                onOpen: props.openSession,
                onUnpin: props.unpin,
              }),
            ),
          ),
      )
      return createPortal(body, anchor.parent)
    }

    /**
     * Rows appended to the sidebar More menu: the two panels moved out of the
     * panel list, above the plugin discovery and creation actions.
     * @param props - owner props of `sidebar.panellist.actions` plus localized copy.
     * @returns the moved navigation rows.
     */
    function MoreRows({ onOpen, onDismiss, t }) {
      const label = translator(t)

      const row = (id, text) => React.createElement(primitives.MenuItemButton, {
        key: id,
        onSelect: () => {
          onDismiss()
          onOpen(id)
        },
        children: text,
      })

      return React.createElement(
        React.Fragment,
        null,
        row('plugins', label('plugins')),
        row('schedules', label('schedules')),
      )
    }

    return {
      inject: ['slots', 'locale', 'uiSession', 'uiWorkspace'],
      apply(ctx) {
        const workspaces = ctx.uiWorkspace

        ctx.effect(() => ctx.locale.register('sidebarMore', { en, zh }), 'sidebar-more: locale')

        ctx.effect(() => {
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`)
          if (existing !== null) return () => { existing.remove() }
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/sidebar-more'
          tag.dataset.pluginCss = TAG_ID
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'sidebar-more: styles')

        // The 置顶 section rides the sidebar foot seat — the only slot the shell
        // offers beside the workspace region — and portals itself to the region
        // top. `order` keeps it after 最近's own registrant there.
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'sidebar-more.pinned',
          locale: 'sidebarMore',
          order: 40,
          inject: () => ({
            openSession: (id) => { workspaces.openSession(id) },
            unpin: (id) => {
              Promise.resolve(workspaces.unpinSession(id)).catch((reason) => {
                console.warn('sidebar-more: unpin rejected:', reason)
              })
            },
          }),
        }, PinnedSection)), 'sidebar-more: pinned section')

        ctx.effect(() => ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions',
          id: 'sidebar-more',
          locale: 'sidebarMore',
          order: -1,
        }, MoreRows)), 'sidebar-more: menu rows')
      },
    }
  },
})
