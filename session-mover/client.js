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
      orderUnavailable: 'Native sidebar ordering is unavailable. No conversation was moved.',
      stalePosition: 'The target position changed. Please drop again.',
      orderFailed: 'The conversation moved, but its display order needs retrying. Use Undo to restore it.',
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
      orderUnavailable: '侧栏排序接口暂不可用，未移动对话',
      stalePosition: '目标位置已变化，请重新拖放',
      orderFailed: '对话已移动，但显示排序未完成，可撤销恢复',
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

    // The native sidebar owns a single persistent store. Do not recreate it or edit localStorage.
    function nativeOrderContext() {
      const scopedUi = clientContext?.get('uiWorkspace')
      const ui = scopedUi?.[Symbol.for('cordis.original')] ?? scopedUi
      const workspaces = clientContext?.get('workspaces')?.list.getSnapshot()
      const list = clientContext?.get('sessions')?.list.getSnapshot()
      const entries = clientContext?.slots.entries('sidebar.workspaces') ?? []
      const candidate = entries.find(entry => entry.store?.spec?.persist === 'dsh.workspace.view.v5' && typeof entry.store.create === 'function')
      const store = candidate?.store.create()
      if (!store?.getSnapshot || !store?.actions?.setSessionOrder || !store?.actions?.setOrderBy || store.actions !== ui?.view || !workspaces || workspaces.phase !== 'ready' || !list || list.phase !== 'ready') throw new Error('ORDER_UNAVAILABLE')
      const view = store.getSnapshot()
      if (!['manual', 'updated'].includes(view.orderBy)) throw new Error('ORDER_UNAVAILABLE')
      const orders = accountOrders(workspaces, list, view)
      return { store, workspaces, list, view, orders, pins: new Set(workspaces.pinnedSessionIds), archived: new Set(workspaces.archivedSessionIds) }
    }

    function recentOrder(ids, summaries) {
      return ids.filter(id => summaries[id]).sort((a, b) => {
        const x = summaries[a].updatedAt, y = summaries[b].updatedAt
        return x === y ? (a < b ? -1 : a === b ? 0 : 1) : x > y ? -1 : 1
      })
    }

    // Mirror native reconciliation including hidden overflow members, new pins and forks.
    function manualOrder(ids, saved, summaries, rowState) {
      const members = new Set(ids), included = new Set(), ordered = []
      for (const id of saved ?? []) if (members.has(id) && !included.has(id)) { ordered.push(id); included.add(id) }
      const archived = new Set(rowState.archivedSessionIds), pins = []
      for (const id of rowState.pinnedSessionIds) if (members.has(id) && !included.has(id) && !archived.has(id) && summaries[id]) { pins.push(id); included.add(id) }
      const ordinary = [], archives = []
      for (const id of recentOrder(ids.filter(id => !included.has(id)), summaries)) (archived.has(id) ? archives : ordinary).push(id)
      const result = [...pins, ...ordered, ...ordinary, ...archives], pending = new Set(ordinary)
      function placeFork(id) {
        if (!pending.delete(id)) return
        const parent = summaries[id]?.parentId
        if (!parent || parent === id || !result.includes(parent)) return
        placeFork(parent)
        result.splice(result.indexOf(id), 1); result.splice(result.indexOf(parent), 0, id)
      }
      for (const id of [...ordinary].reverse()) placeFork(id)
      return result
    }

    function accountOrders(workspaces, list, view) {
      const accounted = new Set(workspaces.items.flatMap(w => w.sessionIds))
      const members = Object.fromEntries(workspaces.items.map(w => [w.workspaceId, w.sessionIds]))
      members[''] = list.ids.filter(id => list.byId[id] && !accounted.has(id))
      members['__flat_session_order__'] = list.ids.filter(id => list.byId[id] && list.byId[id].origin !== 'subagent')
      const current = Object.values(list.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)
      const blank = current?.blank ? current.id : undefined
      return Object.fromEntries(Object.entries(members).map(([key, ids]) => {
        const base = view.orderBy === 'updated' ? recentOrder(ids, list.byId) : manualOrder(ids, view.sessionOrderByAccount[key], list.byId, workspaces)
        return [key, blank && ids.includes(blank) ? [blank, ...base.filter(id => id !== blank)] : base]
      }))
    }

    function ownPartition(context, workspaceId, sessionId) {
      return (context.orders[workspaceId] ?? []).filter(id => id !== sessionId && context.pins.has(id) === context.pins.has(sessionId) && !context.archived.has(id) && !context.list.byId[id]?.blank && context.list.byId[id]?.origin !== 'subagent')
    }

    /** Resolve exact effective position, even when hovering the opposite pin partition. */
    function dropTarget(element, clientY, sessionId, context) {
      const row = element?.closest?.('[data-row-key]')
      if (!row) return null
      const rows = treeRows(row)
      if (!rows) return null
      const index = rows.findIndex(entry => entry.row === row)
      if (index < 0) return null
      const key = rows[index].key
      if (key.startsWith('overflow:')) return null // Expand the native list before choosing hidden positions.
      const workspace = key.startsWith('workspace:') ? { id: key.slice(10), row } : workspaceAt(rows, index)
      if (!workspace?.id || !context.orders[workspace.id] || (!key.startsWith('workspace:') && !key.startsWith('session:') && !key.startsWith('overflow:'))) return null
      const partition = ownPartition(context, workspace.id, sessionId)
      const hovered = key.startsWith('session:') ? key.slice(8) : undefined
      let before = partition[0]
      if (hovered && partition.includes(hovered)) {
        const rect = row.getBoundingClientRect()
        before = clientY < rect.top + rect.height / 2 ? hovered : partition[partition.indexOf(hovered) + 1]
      }
      const workspaceIndex = rows.findIndex(entry => entry.row === workspace.row)
      if (workspaceIndex < 0) return null
      const memberRows = rows.slice(workspaceIndex + 1)
      const untilNextGroup = []
      for (const entry of memberRows) { if (entry.key.startsWith('workspace:')) break; if (entry.key.startsWith('session:')) untilNextGroup.push(entry) }
      // A hidden successor directly after the hovered visible row is an exact visible boundary.
      // A wholly hidden partition has no truthful line until the user expands it.
      if (before && !untilNextGroup.some(entry => entry.key === 'session:' + before) && !(hovered && partition.includes(hovered))) return null
      let lineRow = before ? untilNextGroup.find(entry => entry.key === 'session:' + before)?.row : undefined
      let lineEdge = 'before'
      if (!lineRow) {
        const visibleOwn = untilNextGroup.filter(entry => partition.includes(entry.key.slice(8)))
        if (visibleOwn.length) { lineRow = visibleOwn[visibleOwn.length - 1].row; lineEdge = 'after' }
        else {
          const placeholders = untilNextGroup.filter(entry => context.list.byId[entry.key.slice(8)]?.blank)
          const pins = untilNextGroup.filter(entry => context.pins.has(entry.key.slice(8)))
          lineRow = !context.pins.has(sessionId) && pins.length ? pins[pins.length - 1].row : placeholders[placeholders.length - 1]?.row ?? workspace.row
          lineEdge = 'after'
        }
      }
      return { ...workspace, before, lineRow, lineEdge, position: before ? { anchorSessionId: before, edge: 'before' } : { edge: 'end' } }
    }

    function spliceBefore(order, sessionId, before) {
      const result = order.filter(id => id !== sessionId)
      const index = before === undefined ? result.length : result.indexOf(before)
      if (index < 0) throw new Error('STALE_POSITION')
      result.splice(index, 0, sessionId)
      return result
    }

    function restoreLocalBefore(order, sessionId, saved) {
      const ids = order.filter(id => id !== sessionId), index = saved.indexOf(sessionId)
      const next = saved.slice(index + 1).find(id => ids.includes(id))
      if (next) return next
      const previous = saved.slice(0, index).reverse().find(id => ids.includes(id))
      return previous ? ids[ids.indexOf(previous) + 1] : ids[Math.min(Math.max(index, 0), ids.length)]
    }

    function orderSignature(orders, exclude) {
      return JSON.stringify(Object.keys(orders).sort().map(key => [key, orders[key].filter(id => id !== exclude)]))
    }

    // Wait for the actual workspace stream, not a guessed timer or DOM row count.
    function waitForMembership(sessionId, sourceId, targetId) {
      const source = clientContext.get('workspaces')?.list
      if (!source?.subscribe) return Promise.reject(new Error('ORDER_UNAVAILABLE'))
      return new Promise((resolve, reject) => {
        let stop, timer, done = false
        const finish = error => {
          if (done) return
          done = true; if (timer) window.clearTimeout(timer); stop?.()
          error ? reject(error) : resolve()
        }
        const check = () => {
          const snapshot = source.getSnapshot()
          const target = snapshot.items.find(w => w.workspaceId === targetId)
          const previous = snapshot.items.find(w => w.workspaceId === sourceId)
          if (snapshot.phase === 'ready' && target?.sessionIds.includes(sessionId) && !previous?.sessionIds.includes(sessionId)) finish()
        }
        stop = source.subscribe(check)
        timer = window.setTimeout(() => finish(new Error('Workspace membership did not settle')), 8000)
        check()
      })
    }

    function applyLocalPlacement(context, sessionId, sourceId, targetId, before) {
      const orders = { ...context.orders }
      orders[sourceId] = (orders[sourceId] ?? []).filter(id => id !== sessionId)
      const next = spliceBefore(orders[targetId] ?? [], sessionId, before)
      context.store.actions.setSessionOrder(targetId, next, orders)
      return context.store.getSnapshot()
    }

    /** Sidebar title of a Workspace row, for the notice text. */
    function rowTitle(row) {
      return (row?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    }

    const CSS = `
      .dsm-workspace-drop { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover) !important; }
      .dsm-insertion-line { pointer-events: none; position: fixed; z-index: 75; height: 2px; border-radius: 2px; background: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-bg-overlay); }
      .dsm-insertion-line::before { content: ''; position: absolute; width: 6px; height: 6px; border: 2px solid var(--dsw-alias-brand-primary); border-radius: 50%; background: var(--dsw-alias-bg-overlay); left: -2px; top: -4px; }
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
      const label = React.useMemo(() => translator(t), [t])
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [insertion, setInsertion] = React.useState(null)
      const drag = React.useRef(null)
      const highlighted = React.useRef(null)
      const busyRef = React.useRef(false)

      /** Drop the highlight on whatever Workspace row carried it. */
      const clearHighlight = React.useCallback(() => {
        highlighted.current?.classList.remove(DROP_CLASS)
        highlighted.current = null
        setInsertion(null)
      }, [])

      /** Drag and undo await the same Host transaction and its actual outcome. */
      const relocate = React.useCallback(async (sessionId, workspaceId, title, sourceId, options = {}) => {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(true)
        try {
          const context = nativeOrderContext()
          const saved = { orders: structuredClone(context.orders), mode: context.view.orderBy, sourceId, targetId: workspaceId, localApplied: false }
          const result = await post('relocate', { sessionId, workspaceId, ...(options.undoToken ? { undoToken: options.undoToken } : options.position ? { position: options.position } : {}) })
          if (result.ok) {
            let orderError = false
            try {
              await waitForMembership(sessionId, result.source.id, result.target.id)
              const fresh = nativeOrderContext()
              if (options.undoToken) {
                const original = options.localUndo
                if (original.localApplied) {
                  const before = restoreLocalBefore(fresh.orders[result.target.id] ?? [], sessionId, original.orders[result.target.id] ?? [])
                  const unchanged = fresh.view.orderBy === 'manual' && orderSignature(fresh.view.sessionOrderByAccount, sessionId) === original.afterSignature
                  applyLocalPlacement(fresh, sessionId, result.source.id, result.target.id, before)
                  if (original.mode === 'updated' && unchanged) fresh.store.actions.setOrderBy('updated', {})
                }
              } else {
                let before = options.position?.edge === 'end' ? undefined : options.position?.anchorSessionId ?? ownPartition(fresh, result.target.id, sessionId)[0]
                // A concurrent native pin/reorder must not change another item's order.
                if (before && !ownPartition(fresh, result.target.id, sessionId).includes(before)) before = ownPartition(fresh, result.target.id, sessionId)[0]
                const view = applyLocalPlacement(fresh, sessionId, result.source.id, result.target.id, before)
                saved.localApplied = true
                saved.afterSignature = orderSignature(view.sessionOrderByAccount, sessionId)
              }
            } catch (error) { orderError = true; console.warn('session-mover display order', error) }
            try { await refreshMoved(sessionId) } catch (error) { console.warn('session-mover metadata refresh', error) }
            setNotice({
              kind: orderError ? 'error' : 'ok',
              text: orderError ? label('orderFailed') : options.undoToken ? label('undone') : label('moved').replace('{name}', title),
              undo: result.undoToken ? { sessionId, workspaceId: result.source.id, sourceId: result.target.id, undoToken: result.undoToken, localUndo: saved } : null,
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
          const reason = error?.message === 'ORDER_UNAVAILABLE' ? label('orderUnavailable') : error?.message === 'STALE_POSITION' ? label('stalePosition') : String(error?.message ?? error)
          setNotice({ kind: 'error', text: label('failed').replace('{reason}', reason), undo: null })
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
          if (!owner?.id || busyRef.current) return
          try {
            const context = nativeOrderContext()
            if (context.archived.has(key.slice(8))) return
            drag.current = { sessionId: key.slice(8), source: owner.id }
          } catch { drag.current = null }
        }

        const onDragOver = (event) => {
          const current = drag.current
          if (!current) return
          let target
          try { target = dropTarget(event.target, event.clientY, current.sessionId, nativeOrderContext()) } catch { clearHighlight(); return }
          if (!target || !target.id || target.id === current.source) {
            clearHighlight()
            return
          }
          if (highlighted.current !== target.row) {
            clearHighlight()
            highlighted.current = target.row
            target.row.classList.add(DROP_CLASS)
          }
          const rect = target.lineRow.getBoundingClientRect()
          const tree = target.row.closest('[role=tree]')
          let viewportTop = 0, viewportBottom = window.innerHeight
          for (let parent = tree; parent; parent = parent.parentElement) {
            if (/auto|scroll|hidden|clip/.test(window.getComputedStyle(parent).overflowY)) { const bounds = parent.getBoundingClientRect(); viewportTop = Math.max(viewportTop, bounds.top); viewportBottom = Math.min(viewportBottom, bounds.bottom) }
          }
          const y = target.lineEdge === 'before' ? rect.top : rect.bottom
          const nextInsertion = y >= viewportTop && y <= viewportBottom ? { left: rect.left + 12, top: y - 1, width: Math.max(0, rect.width - 24) } : null
          setInsertion(previous => JSON.stringify(previous) === JSON.stringify(nextInsertion) ? previous : nextInsertion)
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          event.preventDefault()
          event.stopPropagation()
        }

        const onDrop = (event) => {
          const current = drag.current
          drag.current = null
          clearHighlight()
          if (!current) return
          let target
          try { target = dropTarget(event.target, event.clientY, current.sessionId, nativeOrderContext()) } catch { return }
          if (!target || !target.id || target.id === current.source) return
          event.preventDefault()
          event.stopPropagation()
          void relocate(current.sessionId, target.id, rowTitle(target.row), current.source, { position: target.position })
        }

        const onDragEnd = () => {
          drag.current = null
          clearHighlight()
        }

        document.addEventListener('dragstart', onDragStart, true)
        document.addEventListener('dragover', onDragOver, true)
        document.addEventListener('drop', onDrop, true)
        document.addEventListener('dragend', onDragEnd, true)
        document.addEventListener('scroll', clearHighlight, true)
        return () => {
          document.removeEventListener('dragstart', onDragStart, true)
          document.removeEventListener('dragover', onDragOver, true)
          document.removeEventListener('drop', onDrop, true)
          document.removeEventListener('dragend', onDragEnd, true)
          document.removeEventListener('scroll', clearHighlight, true)
          clearHighlight()
        }
      }, [clearHighlight, relocate])

      React.useEffect(() => {
        if (!notice || busy) return undefined
        const timer = window.setTimeout(() => { setNotice(null) }, notice.undo ? 10000 : 6000)
        return () => { window.clearTimeout(timer) }
      }, [notice, busy])

      if (!notice && !busy) return insertion ? h('div', { className: 'dsm-insertion-line', style: insertion, 'aria-hidden': true }) : null

      return h(React.Fragment, null,
        insertion ? h('div', { className: 'dsm-insertion-line', style: insertion, 'aria-hidden': true }) : null,
        h(
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
              void relocate(action.sessionId, action.workspaceId, '', action.sourceId, { undoToken: action.undoToken, localUndo: action.localUndo })
            },
          }, label('undo'))
          : null,
      ))
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
          if (signature === last.current && last.ready) return
          last.current = signature
          let ordering
          try { const native = nativeOrderContext(); ordering = { ready: true, orderBy: native.view.orderBy, completeCounts: Object.fromEntries(Object.entries(native.orders).map(([key, ids]) => [key, ids.length])) } } catch { ordering = { ready: false } }
          last.ready = ordering.ready
          post('probe', { at: new Date().toISOString(), version: '0.3.0', ordering, rows }).catch(() => { last.current = '' })
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
