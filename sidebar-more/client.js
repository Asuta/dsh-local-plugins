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
      //
      // The trailing 8px completes the shell's own section rhythm. 「工作区」 is a
      // native section header and brings only its `margin-top: 2px`; a native
      // section above 「最近」 instead gets `margin-bottom: 4px` from the header
      // plus that section's `padding-top: 12px` — 16px in total. Without the
      // extra 8px 「置顶」 ends up 8px tighter than the 「工作区」/「最近」 pair.
      `.sm-pin-section { flex: none; display: flex; flex-direction: column; min-height: 0;
        padding-bottom: 2px; margin-bottom: 8px; }`,
      // The header copies the shell's own section header verbatim — 36px row,
      // `2px 0 4px` margins, 4px inline padding, 14px/400 label on a 20px line
      // box — so 「置顶」 sits in the column as one more native section beside
      // 「工作区」 instead of reading as a smaller, bolder interloper.
      `.sm-pin-header { display: flex; align-items: center; flex: none; height: 36px;
        margin: 2px 0 4px; padding-left: 4px; }`,
      `.sm-pin-toggle { display: flex; align-items: center; justify-content: flex-start; gap: 4px;
        flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0; border: 0;
        border-radius: 12px; background: none; color: var(--dsw-alias-label-tertiary);
        font: inherit; font-size: 14px; font-weight: 400; line-height: 20px;
        text-align: left; cursor: pointer; }
      /* No hover fill here: the shell's own section header has no hover state,
         and this toggle spans the whole row, so a pill would read as a stray
         control next to 「工作区」/「最近」. Keyboard focus stays visible. */
      .sm-pin-toggle:focus-visible { outline: 1px solid var(--dsw-alias-label-tertiary); outline-offset: 1px; }`,
      `.sm-pin-chevron { width: 16px; height: 16px; flex: none; transform: rotate(0deg); transition: transform 120ms ease; }`,
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

    // Borrow the native workspace owner's authorized child renderer. Never clone
    // its registration/children: that would duplicate slot ownership and stores.
    const nativeRowBridge = (() => {
      let current = null
      const listeners = new Set()
      return {
        getSnapshot: () => current,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
        publish: (value) => {
          if (current === value) return
          current = value
          for (const listener of listeners) listener()
        },
        release: (value) => { if (current === value) nativeRowBridge.publish(null) },
      }
    })()

    function installNativeRowBridge(ctx) {
      const slots = ctx.slots
      const original = Symbol.for('cordis.original')
      const owned = Symbol.for('sidebar-more.workspace-row-bridge')
      return slots.inject('sidebar.workspaces', () => {
        let patch = null, changing = false, stopped = false
        const notify = () => {
          const dispose = slots.register({ name: 'sidebar.footer.action', id: 'sidebar-more.invalidate', order: 10000 }, () => null)
          dispose()
        }
        const restore = () => {
          if (!patch) return
          const { entry, descriptor, wrapper } = patch
          patch = null
          if (entry.component === wrapper) Object.defineProperty(entry, 'component', descriptor)
        }
        const reconcile = () => {
          if (stopped || changing) return
          changing = true
          try {
            const candidate = slots.entriesOfSlot('sidebar.workspaces')[0]
            const entry = candidate?.[original] ?? candidate
            if (patch && patch.entry === entry && entry.component === patch.wrapper) return
            restore()
            if (!entry || typeof entry.component !== 'function' || !entry.children || !entry.store) throw new Error('unsupported-workspace-entry')
            const descriptor = Object.getOwnPropertyDescriptor(entry, 'component')
            if (!descriptor || (!descriptor.writable && !descriptor.configurable) || entry.component[owned]) throw new Error('unsupported-workspace-component')
            const NativeWorkspaceBrowser = entry.component
            function WorkspaceWithPinnedRows(props) {
              const bridge = React.useMemo(() => ({ renderSlot: props.renderSlot, t: props.t, requestSessionRename: props.requestSessionRename }), [props.renderSlot, props.t, props.requestSessionRename])
              React.useLayoutEffect(() => {
                nativeRowBridge.publish(bridge)
                return () => nativeRowBridge.release(bridge)
              }, [bridge])
              return React.createElement(NativeWorkspaceBrowser, props)
            }
            Object.defineProperty(WorkspaceWithPinnedRows, owned, { value: true })
            Object.defineProperty(WorkspaceWithPinnedRows, 'displayName', { value: 'WorkspaceWithPinnedRows' })
            Object.defineProperty(entry, 'component', { ...descriptor, value: WorkspaceWithPinnedRows })
            patch = { entry, descriptor, wrapper: WorkspaceWithPinnedRows }
            notify()
          } catch (error) { console.warn('sidebar-more: native row bridge:', error) }
          finally { changing = false }
        }
        const unsubscribe = slots.subscribe('sidebar.workspaces', reconcile)
        reconcile()
        return () => {
          stopped = true
          unsubscribe()
          nativeRowBridge.publish(null)
          changing = true
          try { restore(); notify() } finally { changing = false }
        }
      })
    }

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
    function pinnedRows(list, workspaces, statuses) {
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
        const status = statuses?.get?.(id)
        const pending = status?.pendingInteraction?.kind
        const children = list?.projectionsBySession?.[id]?.values?.subagentCatalog
        rows.push({
          id,
          title: typeof session.title === 'string' ? session.title.trim() : '',
          updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
          running: status?.running ?? session.running === true,
          completed: status?.completionUnread === true,
          pendingInteraction: ['approval', 'plan-review', 'question'].includes(pending) ? pending : undefined,
          runningSubagentCount: Array.isArray(children) ? children.reduce((n, child) => n + ((statuses?.get?.(child.id)?.running ?? byId[child.id]?.running) === true ? 1 : 0), 0) : 0,
        })
      }
      rows.sort((left, right) => (Number(right.running) - Number(left.running)) || (right.updatedAt - left.updatedAt))
      return rows
    }

    // Native CSS is already loaded by the workspace owner. Derive its prefix
    // from the actual stylesheet instead of freezing this build's CSS hash.
    function nativeRowClasses() {
      const tag = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-client-ui-workspace/Rows.module.css"]')
      const prefix = tag?.textContent?.match(/\.([A-Za-z_][A-Za-z0-9_-]*)_sessionRow[{:., ]/)?.[1]
      if (!prefix) return null
      const names = ['sessionRow', 'selected', 'menuOpen', 'slot', 'title', 'time', 'pinIndicator', 'rowActions', 'iconButton', 'visuallyHidden', 'hoverContent', 'hoverTitle', 'hoverTime', 'hoverStatus']
      return Object.fromEntries(names.map(name => [name, `${prefix}_${name}`]))
    }

    function rowStatuses(row, t) {
      const child = row.runningSubagentCount > 0 ? { state: 'ongoing', label: t(row.runningSubagentCount === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other', { n: row.runningSubagentCount }) } : undefined
      const pending = { approval: ['status.waitingApproval', 'status.compact.approval'], 'plan-review': ['status.planReview', 'status.compact.planReview'], question: ['status.waitingAnswer', 'status.compact.answer'] }[row.pendingInteraction]
      const primary = pending ? { state: 'warning', label: t(pending[0]), trailingLabel: t(pending[1]) }
        : row.running ? { state: 'ongoing', label: t('status.running') }
        : child ?? (row.completed ? { state: 'done', label: t('status.completed') } : { state: 'idle', label: t('status.idle') })
      return child && child !== primary ? [primary, child] : [primary]
    }

    function relativeLabel(updatedAt, now, t, hover = false) {
      const { unit, n } = primitives.relativeTime(updatedAt, now)
      const value = unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
      return hover && unit !== 'now' ? t('time.ago', { t: value }) : value
    }

    function PinnedRow({ row, current, label, onOpen, onUnpin, native, now }) {
      const [menuOpen, setMenuOpen] = React.useState(false)
      const menuOpenState = React.useMemo(() => [menuOpen, setMenuOpen], [menuOpen])
      const titleRef = React.useRef(null)
      const frame = React.useRef(0)
      React.useEffect(() => () => window.cancelAnimationFrame(frame.current), [])
      const classes = nativeRowClasses()
      // During native owner startup/reload keep the original safe minimal row.
      if (!native || !classes) return React.createElement('li', { className: 'sm-pin-item' },
        React.createElement('div', { className: 'sm-pin-row sm-pin-fallback', role: 'treeitem', tabIndex: 0, 'aria-selected': current, onClick: () => onOpen(row.id), onKeyDown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(row.id) } } },
          React.createElement('span', { className: 'sm-pin-title' }, row.title || label('untitled')),
          React.createElement('button', { type: 'button', className: 'sm-pin-action', 'aria-label': label('unpin'), onClick: e => { e.stopPropagation(); onUnpin(row.id) } }, React.createElement(primitives.IconPinFillRegular))))
      const { renderSlot, t } = native
      const statuses = rowStatuses(row, t)
      const primary = statuses[0]
      const title = row.title || t('session.untitled')
      const childProps = { sessionId: row.id, displayTitle: row.title }
      const enterTitle = () => {
        const element = titleRef.current
        if (!element) return
        window.cancelAnimationFrame(frame.current)
        const range = element.scrollWidth - element.clientWidth
        if (range <= 8) return
        const place = position => { element.scrollLeft = position; element.toggleAttribute('data-scrolled', position > 0); element.toggleAttribute('data-clipped', position < range) }
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { place(range); return }
        let start
        const step = time => {
          if (start === undefined) start = time
          const position = Math.min((time - start) * 0.03, range)
          place(position)
          if (position < range) frame.current = window.requestAnimationFrame(step)
        }
        frame.current = window.requestAnimationFrame(step)
      }
      const leaveTitle = () => {
        window.cancelAnimationFrame(frame.current)
        if (titleRef.current) { titleRef.current.scrollLeft = 0; titleRef.current.removeAttribute('data-scrolled'); titleRef.current.removeAttribute('data-clipped') }
      }
      const status = React.createElement(React.Fragment, null, React.createElement(primitives.StateDot, { state: primary.state }), statuses.map(item => React.createElement('span', { key: item.label, className: classes.visuallyHidden }, item.label)))
      const anchor = React.createElement('div', {
        className: [classes.sessionRow, current && classes.selected, menuOpen && classes.menuOpen, 'sm-pin-native-row'].filter(Boolean).join(' '),
        'data-row-key': `session:${row.id}`, 'data-sm-native-row': '', role: 'treeitem', tabIndex: 0, 'aria-selected': current,
        onClick: () => onOpen(row.id), onPointerEnter: enterTitle, onPointerLeave: leaveTitle,
        onKeyDown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(row.id) } },
      },
        React.createElement('span', { className: classes.slot }, primary.state !== 'idle' ? status : renderSlot('sidebar.session.row.leading', { sessionId: row.id })),
        React.createElement('span', { ref: titleRef, className: classes.title, onDoubleClick: e => { e.stopPropagation(); native.requestSessionRename?.(row.id, row.title) } }, title),
        React.createElement('span', { className: classes.time, 'aria-hidden': primary.trailingLabel ? true : undefined }, primary.trailingLabel ?? relativeLabel(row.updatedAt, now, t)),
        React.createElement('span', { className: classes.pinIndicator, role: 'img', 'aria-label': t('row.pinned'), title: t('row.pinned') }, React.createElement(primitives.IconPinFillRegular, { size: 14 })),
        React.createElement('span', { className: classes.rowActions, onClick: e => e.stopPropagation(), onKeyDown: e => e.stopPropagation() },
          React.createElement(primitives.Menu, {
            open: menuOpen, onClose: () => setMenuOpen(false), portal: true, closeOnPointerLeave: true,
            anchor: React.createElement('button', { type: 'button', className: classes.iconButton, 'aria-label': t('actions.session.aria', { name: title }), onClick: () => setMenuOpen(value => !value) }, React.createElement(primitives.IconEllipsisOutlineRegular)),
          }, renderSlot('sidebar.workspaces.session.menu.item', childProps, { hookContext: menuOpenState })),
          renderSlot('sidebar.workspaces.session.row.action', childProps)))
      const content = React.createElement('div', { className: classes.hoverContent },
        React.createElement('div', { className: classes.hoverTitle }, title),
        React.createElement('div', { className: classes.hoverTime }, relativeLabel(row.updatedAt, now, t, true)),
        renderSlot('sidebar.session.row.hover', { sessionId: row.id }),
        statuses.map(item => React.createElement('div', { key: item.label, className: classes.hoverStatus }, React.createElement(primitives.StateDot, { state: item.state }), React.createElement('span', null, item.label))))
      return React.createElement('li', { className: 'sm-pin-item' }, React.createElement(primitives.HoverCard, { anchor, content, openDelayMs: 800, grouped: true, disabled: menuOpen, copyText: row.title || undefined, copyLabel: t('copy'), copiedLabel: t('hover.copied') }))
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
      const statuses = (props.useSessionStatus ?? NOOP_STORE)((snapshot) => snapshot)
      const panelActive = (props.usePanelInfo ?? NOOP_STORE)((info) => info.activePanelId !== null)
      const native = React.useSyncExternalStore(nativeRowBridge.subscribe, nativeRowBridge.getSnapshot, nativeRowBridge.getSnapshot)
      const rows = React.useMemo(() => pinnedRows(list, workspaces, statuses), [list, workspaces, statuses])
      const current = panelActive ? undefined : currentSessionId(list)
      const [now, setNow] = React.useState(Date.now)
      const [expanded, setExpanded] = React.useState(loadExpanded)
      React.useEffect(() => {
        if (props.wide !== true || !expanded || rows.length === 0) return undefined
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
      }, [props.wide, expanded, rows.length])
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
                native,
                now,
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

        ctx.effect(() => installNativeRowBridge(ctx), 'sidebar-more: native row bridge')

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
