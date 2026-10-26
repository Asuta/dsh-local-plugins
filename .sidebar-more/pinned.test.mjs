import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const pluginPath = new URL('../sidebar-more/client.js', import.meta.url)
const originalSource = fs.readFileSync(pluginPath, 'utf8')
const marker = '    return {\n      inject:'
assert.equal(originalSource.split(marker).length, 2, 'test exposure marker must be unique')
const source = originalSource.replace(marker, `    globalThis.__test = { pinnedRows, rowStatuses, PinnedRow, currentSessionId, relativeLabel, nativeRowClasses, nativeRowBridge, installNativeRowBridge };\n${marker}`)
const plain = value => JSON.parse(JSON.stringify(value))
const t = (key, values) => values ? `${key}:${JSON.stringify(values)}` : key

function harness({ css = '.native_sessionRow{height:32px}', state = [] } = {}) {
  let cursor = 0
  const effects = []
  const warnings = []
  const states = [...state]
  const primitives = new Proxy({ relativeTime: () => ({ unit: 'minutes', n: 5 }) }, { get(target, key) { return target[key] ??= function Primitive() {} } })
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } } },
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
    useMemo: fn => fn(),
    useRef: current => ({ current }),
    useEffect: () => {},
    useLayoutEffect: fn => { effects.push(fn) },
    useSyncExternalStore: (_subscribe, get) => get(),
  }
  let plugin
  const context = vm.createContext({
    console: { warn: (...args) => warnings.push(args) },
    navigator: { language: 'en' },
    document: { querySelector: () => css === null ? null : ({ textContent: css }) },
    window: {
      cancelAnimationFrame() {}, requestAnimationFrame() { return 1 },
      matchMedia: () => ({ matches: false }),
      __ModuleLoader__: { load(definition) { plugin = definition.factory(name => { if (name === 'react') return React; if (name === 'react-dom') return { createPortal: (body, parent) => ({ body, parent }) }; if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives; throw new Error(`unexpected import ${name}`) }) } },
    },
  })
  vm.runInContext(source, context, { filename: pluginPath.pathname })
  return { api: context.__test, primitives, React, plugin, effects, warnings, states, render(fn, props) { cursor = 0; return fn(props) } }
}

function session(id, extra = {}) { return { id, title: ` ${id} title `, displayTitle: `display ${id}`, updatedAt: 1, running: false, retainedBy: {}, ...extra } }
function rowsFor(h, byId, pinned = Object.keys(byId), statuses = new Map(), extra = {}) { return h.api.pinnedRows({ byId, projectionsBySession: extra.projectionsBySession }, { pinnedSessionIds: pinned, archivedSessionIds: extra.archived ?? [] }, statuses) }
function walk(node, predicate) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(item => walk(item, predicate))
  const matches = predicate(node) ? [node] : []
  return matches.concat(...['children', 'anchor', 'content'].map(key => walk(node.props?.[key], predicate)))
}
function nativeRow(h, overrides = {}) {
  const calls = [], opened = [], renamed = [], unpinned = []
  const renderSlot = (...args) => { calls.push(args); return { type: 'slot', props: { slot: args[0] } } }
  const row = { id: 'p', title: 'Pinned title', updatedAt: 1, running: false, completed: false, runningSubagentCount: 0, ...overrides.row }
  const props = { row, current: true, label: key => key, onOpen: id => opened.push(id), onUnpin: id => unpinned.push(id), native: { renderSlot, t, requestSessionRename: (...args) => renamed.push(args) }, now: 100000, ...overrides }
  props.row = row
  const tree = h.render(h.api.PinnedRow, props)
  return { tree, calls, opened, renamed, unpinned, props, anchor: walk(tree, node => node.props?.['data-sm-native-row'] === '')[0] }
}

test('pinnedRows handles absent data without inventing rows', () => { const h = harness(); assert.deepEqual(plain(h.api.pinnedRows()), []); assert.deepEqual(plain(h.api.pinnedRows({ byId: {} }, {})), []) })
test('pinnedRows filters missing, subagent, blank and archived sessions', () => { const h = harness(); const byId = { normal: session('normal'), child: session('child', { origin: 'subagent' }), blank: session('blank', { blank: true }), archived: session('archived') }; assert.deepEqual(rowsFor(h, byId, ['missing', ...Object.keys(byId)], new Map(), { archived: ['archived'] }).map(row => row.id).join(','), 'normal') })
test('live false running overrides stale true catalog status', () => { const h = harness(); assert.equal(rowsFor(h, { p: session('p', { running: true }) }, ['p'], new Map([['p', { running: false }]]))[0].running, false) })
test('live true running overrides stale false catalog status', () => { const h = harness(); assert.equal(rowsFor(h, { p: session('p') }, ['p'], new Map([['p', { running: true }]]))[0].running, true) })
test('catalog running is fallback when live entry is absent', () => { const h = harness(); assert.equal(rowsFor(h, { p: session('p', { running: true }) })[0].running, true) })
test('sort running first then descending updatedAt with stable ties', () => { const h = harness(); const data = { old: session('old', { updatedAt: 10 }), recent: session('recent', { updatedAt: 30 }), run: session('run', { updatedAt: 1 }), tie: session('tie', { updatedAt: 30 }) }; assert.equal(rowsFor(h, data, Object.keys(data), new Map([['run', { running: true }]])).map(row => row.id).join(','), 'run,recent,tie,old') })
for (const pending of ['approval', 'plan-review', 'question', 'unknown']) test(`pending interaction ${pending} obeys native visible-kind contract`, () => { const h = harness(); const row = rowsFor(h, { p: session('p') }, ['p'], new Map([['p', { pendingInteraction: { kind: pending }, completionUnread: true }]]))[0]; assert.equal(row.pendingInteraction, pending === 'unknown' ? undefined : pending); assert.equal(row.completed, true) })
test('subagent counts prefer live false/true and fall back to catalog', () => { const h = harness(); const byId = { p: session('p'), a: session('a', { running: true }), b: session('b'), c: session('c', { running: true }) }; const statuses = new Map([['a', { running: false }], ['b', { running: true }]]); const row = rowsFor(h, byId, ['p'], statuses, { projectionsBySession: { p: { values: { subagentCatalog: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'missing' }] } } } })[0]; assert.equal(row.runningSubagentCount, 2) })
test('native canonical title is trimmed instead of displayTitle', () => { const h = harness(); assert.equal(rowsFor(h, { p: session('p') })[0].title, 'p title') })
test('native missing canonical title stays empty even with displayTitle', () => { const h = harness(); assert.equal(rowsFor(h, { p: session('p', { title: undefined, displayTitle: 'directory name' }) })[0].title, '') })
test('currentSessionId follows mainView retain count only', () => { const h = harness(); assert.equal(h.api.currentSessionId({ byId: { a: session('a', { retainedBy: { other: 1 } }), b: session('b', { retainedBy: { mainView: 1 } }) } }), 'b'); assert.equal(h.api.currentSessionId(), undefined) })
for (const [name, row, states] of [
  ['idle', {}, ['idle']], ['completion', { completed: true }, ['done']],
  ['running wins completion', { running: true, completed: true }, ['ongoing']],
  ['child wins completion without duplication', { runningSubagentCount: 1, completed: true }, ['ongoing']],
  ['running and child both visible', { running: true, runningSubagentCount: 2 }, ['ongoing', 'ongoing']],
  ['pending wins running completion', { pendingInteraction: 'approval', running: true, completed: true }, ['warning']],
  ['pending and child both visible', { pendingInteraction: 'question', runningSubagentCount: 2 }, ['warning', 'ongoing']],
]) test(`rowStatuses: ${name}`, () => { const h = harness(); const result = h.api.rowStatuses({ runningSubagentCount: 0, ...row }, t); assert.equal(result.map(item => item.state).join(','), states.join(',')); if (row.pendingInteraction) assert.match(result[0].trailingLabel, /status\.compact\./) })
test('rowStatuses chooses singular and plural subagent labels', () => { const h = harness(); assert.match(h.api.rowStatuses({ runningSubagentCount: 1 }, t)[0].label, /one/); assert.match(h.api.rowStatuses({ runningSubagentCount: 2 }, t)[0].label, /other/) })
test('relativeLabel wraps hover distance, but never now', () => { const h = harness(); assert.equal(h.api.relativeLabel(1, 2, t), 'time.minutes:{"n":5}'); assert.match(h.api.relativeLabel(1, 2, t, true), /^time\.ago:/); h.primitives.relativeTime = () => ({ unit: 'now' }); assert.equal(h.api.relativeLabel(1, 2, t, true), 'time.now') })

test('native row derives CSS prefix and native action/menu props exactly', () => { const h = harness(); const r = nativeRow(h); assert.match(r.anchor.props.className, /native_sessionRow/); assert.match(r.anchor.props.className, /native_selected/); const menuCall = r.calls.find(call => call[0] === 'sidebar.workspaces.session.menu.item'); assert.deepEqual(plain(menuCall[1]), { sessionId: 'p', displayTitle: 'Pinned title' }); assert.equal(menuCall[2].hookContext[0], false); assert.equal(typeof menuCall[2].hookContext[1], 'function'); const actionCall = r.calls.find(call => call[0] === 'sidebar.workspaces.session.row.action'); assert.deepEqual(plain(actionCall[1]), { sessionId: 'p', displayTitle: 'Pinned title' }); assert.equal(actionCall.length, 2) })
test('native Menu owns portal anchor close and menu state lifecycle', () => { const h = harness(); const r = nativeRow(h); const menu = walk(r.tree, node => node.type === h.primitives.Menu)[0]; assert.equal(menu.props.portal, true); assert.equal(menu.props.closeOnPointerLeave, true); assert.equal(menu.props.open, false); menu.props.anchor.props.onClick(); assert.equal(h.states[0], true); const rerender = nativeRow(h); assert.equal(rerender.calls.find(call => call[0] === 'sidebar.workspaces.session.menu.item')[2].hookContext[0], true); const nextMenu = walk(rerender.tree, node => node.type === h.primitives.Menu)[0]; nextMenu.props.onClose(); assert.equal(h.states[0], false) })
test('idle row renders leading slot while busy row uses native StateDot', () => { const h = harness(); const idle = nativeRow(h); assert.ok(idle.calls.some(call => call[0] === 'sidebar.session.row.leading')); const running = nativeRow(h, { row: { running: true } }); assert.ok(!running.calls.some(call => call[0] === 'sidebar.session.row.leading')); assert.equal(walk(running.anchor, node => node.type === h.primitives.StateDot)[0].props.state, 'ongoing') })
test('pending trailing label replaces age and native hover seat remains present', () => { const h = harness(); const r = nativeRow(h, { row: { pendingInteraction: 'plan-review' } }); const age = walk(r.anchor, node => node.props?.className === 'native_time')[0]; assert.equal(age.props.children, 'status.compact.planReview'); assert.equal(age.props['aria-hidden'], true); assert.ok(r.calls.some(call => call[0] === 'sidebar.session.row.hover')) })
test('action area isolates click/key propagation without opening session', () => { const h = harness(); const r = nativeRow(h); const actions = walk(r.anchor, node => node.props?.className === 'native_rowActions')[0]; let stopped = 0; actions.props.onClick({ stopPropagation() { stopped++ } }); actions.props.onKeyDown({ stopPropagation() { stopped++ } }); assert.equal(stopped, 2); assert.deepEqual(r.opened, []) })
test('row keys open only when event target is row itself', () => { const h = harness(); const r = nativeRow(h); const target = {}; let prevented = 0; for (const key of ['Enter', ' ']) r.anchor.props.onKeyDown({ key, target, currentTarget: target, preventDefault() { prevented++ } }); r.anchor.props.onKeyDown({ key: 'Enter', target: {}, currentTarget: target, preventDefault() { throw Error('descendant key intercepted') } }); r.anchor.props.onKeyDown({ key: 'Escape', target, currentTarget: target, preventDefault() { throw Error('escape intercepted') } }); assert.equal(prevented, 2); assert.deepEqual(r.opened, ['p', 'p']) })
test('title doubleclick requests native rename and stops propagation', () => { const h = harness(); const r = nativeRow(h); let stopped = false; walk(r.anchor, node => node.props?.className === 'native_title')[0].props.onDoubleClick({ stopPropagation() { stopped = true } }); assert.equal(stopped, true); assert.deepEqual(r.renamed, [['p', 'Pinned title']]) })
test('native HoverCard preserves portal-independent hover properties', () => { const h = harness(); const r = nativeRow(h); const hover = walk(r.tree, node => node.type === h.primitives.HoverCard)[0]; assert.equal(hover.props.openDelayMs, 800); assert.equal(hover.props.grouped, true); assert.equal(hover.props.disabled, false); assert.equal(hover.props.copyText, 'Pinned title'); assert.equal(hover.props.copyLabel, 'copy') })
test('missing native bridge or CSS uses safe fallback with isolated unpin', () => { for (const options of [{ css: null }, {}]) { const h = harness(options); const r = nativeRow(h, options.css === null ? {} : { native: null }); const fallback = walk(r.tree, node => node.props?.className === 'sm-pin-row sm-pin-fallback')[0]; assert.ok(fallback); const button = walk(fallback, node => node.type === 'button')[0]; let stopped = false; button.props.onClick({ stopPropagation() { stopped = true } }); assert.equal(stopped, true); assert.deepEqual(r.unpinned, ['p']); assert.deepEqual(r.opened, []) } })

function bridgeFixture(h, { canonicalProxy = false, descriptor = {} } = {}) {
  function Original(props) { return props }
  const entry = { children: { native: true }, store: { identity: 'native-store' } }
  Object.defineProperty(entry, 'component', { value: Original, writable: true, enumerable: false, configurable: true, ...descriptor })
  let candidate = canonicalProxy ? { [Symbol.for('cordis.original')]: entry } : entry
  let subscribed = null, unsubscribed = 0
  const registrations = []
  const slots = {
    inject(key, callback) { assert.equal(key, 'sidebar.workspaces'); return callback() },
    entriesOfSlot(key) { assert.equal(key, 'sidebar.workspaces'); return candidate ? [candidate] : [] },
    subscribe(key, callback) { assert.equal(key, 'sidebar.workspaces'); subscribed = callback; return () => { unsubscribed++ } },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  }
  return { entry, Original, slots, registrations, get unsubscribed() { return unsubscribed }, change(next) { candidate = next; subscribed() }, reconcile() { subscribed() } }
}
test('bridge wraps native entry preserving component descriptor children and store', () => { const h = harness(); const f = bridgeFixture(h); const before = Object.getOwnPropertyDescriptor(f.entry, 'component'); const children = f.entry.children, store = f.entry.store; const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); const after = Object.getOwnPropertyDescriptor(f.entry, 'component'); assert.notEqual(after.value, before.value); for (const key of ['writable', 'enumerable', 'configurable']) assert.equal(after[key], before[key]); assert.equal(f.entry.children, children); assert.equal(f.entry.store, store); assert.equal(f.registrations.length, 1); assert.equal(f.registrations[0].options.name, 'sidebar.footer.action'); assert.equal('children' in f.registrations[0].options, false); cleanup(); assert.deepEqual(Object.getOwnPropertyDescriptor(f.entry, 'component'), before); assert.equal(f.unsubscribed, 1) })
test('bridge resolves canonical entry behind Cordis proxy', () => { const h = harness(); const f = bridgeFixture(h, { canonicalProxy: true }); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); assert.equal(f.entry.component.displayName, 'WorkspaceWithPinnedRows'); cleanup(); assert.equal(f.entry.component, f.Original) })
test('bridge wrapper forwards exact props and publishes authorized renderer only on commit', () => { const h = harness(); const f = bridgeFixture(h); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); const props = { renderSlot() {}, t, requestSessionRename() {}, wide: true }; const element = h.render(f.entry.component, props); assert.equal(element.type, f.Original); assert.equal(element.props.renderSlot, props.renderSlot); assert.equal(element.props.wide, true); assert.equal(h.api.nativeRowBridge.getSnapshot(), null); const release = h.effects.shift()(); assert.equal(h.api.nativeRowBridge.getSnapshot().renderSlot, props.renderSlot); assert.equal(h.api.nativeRowBridge.getSnapshot().requestSessionRename, props.requestSessionRename); release(); assert.equal(h.api.nativeRowBridge.getSnapshot(), null); cleanup() })
test('bridge reconcile does not double-wrap same entry', () => { const h = harness(); const f = bridgeFixture(h); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); const wrapper = f.entry.component; f.reconcile(); assert.equal(f.entry.component, wrapper); assert.equal(f.registrations.length, 1); cleanup() })
test('replaced native entry restores old descriptor and wraps new entry', () => { const h = harness(); const f = bridgeFixture(h); const next = bridgeFixture(h); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); f.change(next.entry); assert.equal(f.entry.component, f.Original); assert.notEqual(next.entry.component, next.Original); cleanup(); assert.equal(next.entry.component, next.Original) })
test('bridge unload never overwrites another plugin replacement', () => { const h = harness(); const f = bridgeFixture(h); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); function Replacement() {} f.entry.component = Replacement; cleanup(); assert.equal(f.entry.component, Replacement) })
test('bridge refuses fixed component descriptor without mutation', () => { const h = harness(); const f = bridgeFixture(h, { descriptor: { writable: false, configurable: false } }); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); assert.equal(f.entry.component, f.Original); assert.equal(h.warnings.length, 1); cleanup() })
test('bridge release cannot clear a newer occurrence and subscribers dispose', () => { const h = harness(); const a = {}, b = {}; let notifications = 0; const unsubscribe = h.api.nativeRowBridge.subscribe(() => notifications++); h.api.nativeRowBridge.publish(a); h.api.nativeRowBridge.publish(a); h.api.nativeRowBridge.publish(b); h.api.nativeRowBridge.release(a); assert.equal(h.api.nativeRowBridge.getSnapshot(), b); assert.equal(notifications, 2); h.api.nativeRowBridge.release(b); assert.equal(h.api.nativeRowBridge.getSnapshot(), null); assert.equal(notifications, 3); unsubscribe(); h.api.nativeRowBridge.publish(a); assert.equal(notifications, 3) })
test('bridge cleanup clears published state and ignores later callbacks', () => { const h = harness(); const f = bridgeFixture(h); const cleanup = h.api.installNativeRowBridge({ slots: f.slots }); h.api.nativeRowBridge.publish({ renderSlot() {} }); cleanup(); assert.equal(h.api.nativeRowBridge.getSnapshot(), null); f.reconcile(); assert.equal(f.entry.component, f.Original) })
