/**
 * Session mover (browser half).
 *
 * The sidebar rows are already native HTML5 drag sources:
 * `[role=treeitem][draggable=true][data-row-key=session:<id>]`, and Workspace
 * rows carry `data-row-key=workspace:<id>`. The shipped tree only reorders
 * Sessions inside one Workspace, so this layer accepts the drag only when the
 * pointer is over a *different* Workspace row, keeps the app's own drop
 * handling intact for every other case, and sends the move to the Host half.
 *
 * The row under the pointer is identified from its own `data-row-key`; when the
 * pointer is over a Session row, the owning Workspace is the nearest preceding
 * Workspace row in the same tree. Nothing is guessed from styling.
 */
window.__ModuleLoader__.load({
  id: '@local/session-mover',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sessionMover'
    const en = {
      label: 'Move to workspace',
      moved: 'Moved to “{name}”',
      undone: 'Move undone',
      undo: 'Undo',
      failed: 'Move failed: {reason}',
      running: 'Stop the reply or tool execution before moving this conversation',
      pending: 'The conversation has an operation in progress. Try again shortly.',
      unsupported: 'This DSH version does not support moving loaded conversations.',
      restoreFailed: 'Automatic recovery failed. The conversation backup has been kept.',
      notAllowed: 'this DSH build refuses the move',
      busy: 'Moving…',
    }
    const zh = {
      label: '移动到工作区',
      moved: '已移到“{name}”',
      undone: '已撤销移动',
      undo: '撤销',
      failed: '移动失败：{reason}',
      running: '请先停止这条对话的回复或工具执行，再拖动',
      pending: '这条对话正在打开或处理操作，请稍后再拖动',
      unsupported: '当前 DSH 版本不支持安全搬移已加载的对话',
      restoreFailed: '自动恢复未完成，已保留对话备份，请检查后再操作',
      notAllowed: '这个 DSH 版本拒绝了这次移动',
      busy: '正在移动…',
    }

    const PREFIX = '/__session-mover'
    const DROP_CLASS = 'dsm-workspace-drop'
    let clientContext
    const refreshing = new Map()

    // Preserve the existing Client Session and input binding. Only invalidate metadata.
    function refreshMoved(sessionId) {
      const existing = refreshing.get(sessionId)
      if (existing) { existing.again = true; return existing.promise }
      const state = { again: false }
      const promise = (async () => {
        do {
          state.again = false
          await post('settled', { sessionId })
          const api = clientContext?.get('sessions')
          const concrete = api?.[Symbol.for('cordis.original')] ?? api
          const manager = concrete?.manager
          if (!manager || typeof concrete.refresh !== 'function') throw new Error('Session refresh adapter unavailable')
          manager.projectionInflight.get(sessionId)?.controller.abort()
          manager.projectionInflight.delete(sessionId)
          manager.projectionLoads.delete(sessionId)
          manager.projectionStores.get(sessionId)?.clear()
          await Promise.all([api.refreshProjections(sessionId), concrete.refresh()])
        } while (state.again)
      })().finally(() => refreshing.delete(sessionId))
      state.promise = promise
      refreshing.set(sessionId, state)
      return promise
    }

    /** JSON POST to one Host route. */
    async function post(route, body) {
      const response = await fetch(`${PREFIX}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-mover': '1' },
        body: JSON.stringify(body),
      })
      return response.json()
    }

    /**
     * Resolve the slot's `t` with a browser-language fallback.
     * @param t - registration translator, when the locale service shared one.
     */
    function translator(t) {
      const fallback = String(navigator.language || '').toLowerCase().startsWith('zh') ? zh : en
      return (key) => {
        if (typeof t === 'function') {
          const text = t(key)
          if (typeof text === 'string' && text !== '' && text !== key) return text
        }
        return fallback[key] ?? key
      }
    }

    /** Ordered `data-row-key` rows of the tree that owns this element. */
    function treeRows(element) {
      const tree = element.closest('[role="tree"]')
      if (!tree) return null
      return Array.from(tree.querySelectorAll('[data-row-key]')).map((row) => ({
        row,
        key: row.getAttribute('data-row-key') ?? '',
      }))
    }

    /** The Workspace that owns the row at `index`, by nearest preceding Workspace row. */
    function workspaceAt(rows, index) {
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const key = rows[cursor]?.key ?? ''
        if (key.startsWith('workspace:')) return { id: key.slice('workspace:'.length), row: rows[cursor].row }
      }
      return null
    }

    /** Where a drop would land: a Workspace row, or the Workspace owning a Session row. */
    function dropTarget(element) {
      const row = element?.closest?.('[data-row-key]')
      if (!row) return null
      const rows = treeRows(row)
      if (!rows) return null
      const index = rows.findIndex((entry) => entry.row === row)
      if (index < 0) return null
      const key = rows[index].key
      if (key.startsWith('workspace:')) return { id: key.slice('workspace:'.length), row }
      if (key.startsWith('session:')) return workspaceAt(rows, index)
      return null
    }

    /** Sidebar title of a Workspace row, for the notice text. */
    function rowTitle(row) {
      return (row?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    }

    const CSS = `
      .dsm-workspace-drop { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover) !important; }
      .dsm-notice { pointer-events: auto; position: fixed; left: 50%; bottom: 28px; z-index: 70; display: flex; align-items: center; gap: 12px; max-width: min(520px, 82vw); padding: 10px 12px 10px 16px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv2); font-family: var(--dsw-font-family), system-ui, sans-serif; font-size: 13px; line-height: 20px; transform: translateX(-50%); }
      .dsm-notice[data-kind='error'] { border-color: var(--dsw-alias-state-danger-primary); }
      .dsm-notice-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .dsm-notice-action { flex: none; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-brand-primary); font-family: inherit; font-size: 12px; cursor: pointer; }
      .dsm-notice-action:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsm-notice-action:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      @media (prefers-reduced-motion: no-preference) {
        .dsm-notice { animation: dsm-in 140ms ease-out; }
        @keyframes dsm-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
      }
    `

    /**
     * Drag layer: watches the sidebar tree, accepts a cross-Workspace drop, and
     * shows one notice with an undo.
     * @param props - slot props plus the locale `t`.
     */
    function Mover({ t }) {
      const label = translator(t)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const drag = React.useRef(null)
      const highlighted = React.useRef(null)
      const busyRef = React.useRef(false)

      /** Drop the highlight on whatever Workspace row carried it. */
      const clearHighlight = React.useCallback(() => {
        highlighted.current?.classList.remove(DROP_CLASS)
        highlighted.current = null
      }, [])

      /** Drag and undo await the same Host transaction and its actual outcome. */
      const relocate = React.useCallback(async (sessionId, workspaceId, title, undoTo, undoing = false) => {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(true)
        try {
          const result = await post('relocate', { sessionId, workspaceId })
          if (result.ok) {
            try { await refreshMoved(sessionId) } catch (error) { console.warn('session-mover metadata refresh', error) }
            setNotice({
              kind: 'ok',
              text: undoing ? label('undone') : label('moved').replace('{name}', title),
              undo: undoTo ? { sessionId, workspaceId: undoTo } : null,
            })
          } else {
            let reason = result.error ?? ''
            if (result.code === 'AGENT_RUNNING') reason = label('running')
            else if (['SESSION_BUSY', 'MOVE_IN_PROGRESS'].includes(result.code)) reason = label('pending')
            else if (result.code === 'UNSUPPORTED') reason = label('unsupported')
            if (result.restoreError) reason += ' — ' + label('restoreFailed')
            setNotice({ kind: 'error', text: label('failed').replace('{reason}', reason), undo: null })
          }
        } catch (error) {
          setNotice({ kind: 'error', text: label('failed').replace('{reason}', String(error?.message ?? error)), undo: null })
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      }, [label])

      React.useEffect(() => {
        const onDragStart = (event) => {
          const row = event.target?.closest?.('[data-row-key]')
          const key = row?.getAttribute('data-row-key') ?? ''
          if (!key.startsWith('session:')) return
          const rows = treeRows(row)
          if (!rows) return
          const index = rows.findIndex((entry) => entry.row === row)
          const owner = workspaceAt(rows, index)
          drag.current = { sessionId: key.slice('session:'.length), source: owner?.id ?? null }
        }

        const onDragOver = (event) => {
          const current = drag.current
          if (!current) return
          const target = dropTarget(event.target)
          if (!target || !target.id || target.id === current.source) {
            clearHighlight()
            return
          }
          if (highlighted.current !== target.row) {
            clearHighlight()
            highlighted.current = target.row
            target.row.classList.add(DROP_CLASS)
          }
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          event.preventDefault()
        }

        const onDrop = (event) => {
          const current = drag.current
          drag.current = null
          clearHighlight()
          if (!current) return
          const target = dropTarget(event.target)
          if (!target || !target.id || target.id === current.source) return
          event.preventDefault()
          event.stopPropagation()
          void relocate(current.sessionId, target.id, rowTitle(target.row), current.source)
        }

        const onDragEnd = () => {
          drag.current = null
          clearHighlight()
        }

        document.addEventListener('dragstart', onDragStart, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('drop', onDrop, true)
        document.addEventListener('dragend', onDragEnd, true)
        return () => {
          document.removeEventListener('dragstart', onDragStart, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('drop', onDrop, true)
          document.removeEventListener('dragend', onDragEnd, true)
          clearHighlight()
        }
      }, [clearHighlight, relocate])

      React.useEffect(() => {
        if (!notice || busy) return undefined
        const timer = window.setTimeout(() => { setNotice(null) }, notice.undo ? 10000 : 6000)
        return () => { window.clearTimeout(timer) }
      }, [notice, busy])

      if (!notice && !busy) return null

      return h(
        'div',
        {
          className: 'dsm-notice',
          'data-plugin': '@local/session-mover',
          'data-kind': notice?.kind ?? 'ok',
          role: 'status',
          'aria-live': 'polite',
        },
        h('span', { className: 'dsm-notice-text' }, busy ? label('busy') : notice.text),
        notice?.undo && !busy
          ? h('button', {
            type: 'button',
            className: 'dsm-notice-action',
            onClick: () => {
              const action = notice.undo
              void relocate(action.sessionId, action.workspaceId, '', null, true)
            },
          }, label('undo'))
          : null,
      )
    }

    /** Diagnostic seat: reports the sidebar grouping whenever it changes. */
    function Observer() {
      const last = React.useRef('')
      React.useEffect(() => {
        const tick = () => {
          const tree = document.querySelector('[data-slot="sidebar.workspaces"] [role="tree"]')
          if (!tree) return
          const rows = []
          let group = null
          for (const el of Array.from(tree.querySelectorAll('[data-row-key]'))) {
            const key = el.getAttribute('data-row-key') ?? ''
            const text = (el.textContent ?? '').trim().slice(0, 40)
            if (key.startsWith('workspace:')) {
              group = key.slice('workspace:'.length)
              rows.push({ kind: 'workspace', id: group, title: text.slice(0, 30) })
            } else if (key.startsWith('session:')) {
              rows.push({ kind: 'session', id: key.slice('session:'.length), group, title: text.slice(0, 24) })
            } else if (key.startsWith('overflow:')) {
              rows.push({ kind: 'overflow', id: key.slice('overflow:'.length), group, title: text })
            }
          }
          const signature = JSON.stringify(rows.map((row) => [row.kind, row.id, row.group, row.title]))
          if (signature === last.current) return
          last.current = signature
          post('probe', { at: new Date().toISOString(), rows }).catch(() => { last.current = '' })
        }
        tick()
        const timer = window.setInterval(tick, 2000)
        return () => { window.clearInterval(timer) }
      }, [])
      return null
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        clientContext = ctx
        ctx.effect(() => {
          const fiber = ctx.inject(['sessions'], child => {
          const api = child.get('sessions')
          const concrete = api?.[Symbol.for('cordis.original')] ?? api
          const manager = concrete?.manager
          if (!manager || typeof concrete.handleSessionAdded !== 'function') return
          const original = concrete.handleSessionAdded
          const descriptor = Object.getOwnPropertyDescriptor(concrete, 'handleSessionAdded')
          const wrapped = function (summary) {
            const previous = manager.summaries.find(row => row.sessionId === summary.sessionId)
            const changed = previous?.cwd && summary.cwd && previous.cwd !== summary.cwd
            const result = original.call(this, summary)
            if (changed) void refreshMoved(summary.sessionId).catch(error => console.warn('session-mover refresh', error))
            return result
          }
          concrete.handleSessionAdded = wrapped
          child.effect(() => () => {
            if (concrete.handleSessionAdded !== wrapped) return
            if (descriptor) Object.defineProperty(concrete, 'handleSessionAdded', descriptor)
            else delete concrete.handleSessionAdded
          }, 'session-mover: restore session metadata listener')
          })
          return () => fiber.dispose()
        }, 'session-mover: preserve client session and refresh moved metadata')
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-mover: locale')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/session-mover'
          tag.dataset.pluginCss = '@local/session-mover/session-mover.css'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'session-mover: styles')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-mover.mover',
          locale: NS,
          order: 63,
        }, Mover)), 'session-mover: drag layer')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-mover.observer',
          locale: NS,
          order: 64,
        }, Observer)), 'session-mover: observer')
      },
    }
  },
})
