import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

// ---------------------------------------------------------------- host half
const host = await import(pathToFileURL(PLUGIN + '/index.js').href)
record('host index.js parses and exports apply()', typeof host.apply === 'function')
record('host declares inject', Array.isArray(host.inject) && host.inject.includes('webServer') && host.inject.includes('connection'), host.inject.join(','))

// -------------------------------------------------------------- client half
let captured = null
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def } } }

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useCallback: (fn) => fn,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
await import(pathToFileURL(PLUGIN + '/client.js').href)
record('client.js parses and calls __ModuleLoader__.load', captured !== null, captured && captured.id)
record('client bundle id is the package name', captured?.id === '@local/archived-sessions', String(captured?.id))

const clientModule = captured.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
})
record('client factory returns apply()', typeof clientModule.apply === 'function')
record('client declares its services', Array.isArray(clientModule.inject), clientModule.inject.join(','))

const registrations = []
const dictionaries = []
const clientCtx = {
  locale: {
    register: (ns, locale) => { dictionaries.push(ns + ':' + locale); return () => {} },
    bind: () => (key) => key,
  },
  slots: {
    inject: (key, callback) => { callback(); return () => {} },
    register: (options) => { registrations.push(options); return () => {} },
  },
  effect: () => {},
}
clientModule.apply(clientCtx)

const mainReg = registrations.find((r) => r.name === 'main')
const sectionReg = registrations.find((r) => r.name === 'settings.section')
record('keeps the main keyed slot (stale-selection safety net)', mainReg !== undefined, JSON.stringify(mainReg))
record('registers a settings.section entry', sectionReg !== undefined, JSON.stringify(sectionReg))
record('retires the sidebar.panellist button', registrations.every((r) => r.name !== 'sidebar.panellist'))
record(
  'settings section id === main key (one surface, two seats)',
  sectionReg?.id !== undefined && sectionReg.id === mainReg?.key,
  `id=${sectionReg?.id} key=${mainReg?.key}`,
)
record('settings section nav label resolves', typeof sectionReg?.label === 'function' && sectionReg.label() !== '', String(sectionReg?.label?.()))
record('registers locale dictionaries', dictionaries.length >= 2, dictionaries.join(' '))

// render smoke test: the page must not throw on empty, populated, or ghost data
const source = (snapshot) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
const renderPage = (workspacesSnap, sessionsSnap) => {
  const page = registrations.find((r) => r.name === 'main')
  const component = page.__component
  return component
}
const componentOf = (options) => options.__component

// capture components the way apply() passed them
const captured_components = []
const clientCtx2 = {
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: (key, callback) => { callback(); return () => {} },
    register: (options, component) => { captured_components.push({ options, component }); return () => {} },
  },
  effect: () => {},
}
clientModule.apply(clientCtx2)
const pageComponent = captured_components.find((c) => c.options.name === 'main')?.component
const sectionComponent = captured_components.find((c) => c.options.name === 'settings.section')?.component
record('settings section mounts the same page as the main slot', sectionComponent === pageComponent && sectionComponent !== undefined)

const render = (workspacesSnap, sessionsSnap) =>
  pageComponent({
    workspaces: { list: source(workspacesSnap) },
    sessions: { list: source(sessionsSnap) },
    locale: source({ active: 'zh', locales: [], revision: 0 }),
    t: (key) => key,
    close: () => {},
  })

let renderOk = true
let renderError = ''
for (const [label, ws, ss] of [
  ['empty', { items: [], archivedSessionIds: [] }, { ids: [], byId: {} }],
  [
    'populated',
    { items: [{ workspaceId: 'w1', title: 'Proj', sessionIds: ['session-1'] }], archivedSessionIds: ['session-1'] },
    { ids: ['session-1'], byId: { 'session-1': { id: 'session-1', title: 'Hello', blank: false, updatedAt: 1700000000000 } } },
  ],
  ['ghost id with no summary', { items: [], archivedSessionIds: ['session-gone'] }, { ids: [], byId: {} }],
]) {
  try {
    render(ws, ss)
  } catch (error) {
    renderOk = false
    renderError += `${label}: ${error.message}; `
  }
}
record('page renders on empty / populated / ghost data', renderOk, renderError)

// ------------------------------------------------- host half behaviour tests
const HOME = await mkdtemp(join(tmpdir(), 'dsh-fake-home-'))
const SESSIONS = join(HOME, 'sessions')
const PROJ = join(SESSIONS, '--D-Project-Demo--')
const PROJCACHE = join(HOME, 'storages', 'session_projcache', 'sessions')

async function seed({ sessionId = 'session-aaaa', extraProjectCopy = false, projcacheExtras = 1, children = [] }) {
  await rm(HOME, { recursive: true, force: true })
  await mkdir(join(PROJ, sessionId), { recursive: true })
  await writeFile(join(PROJ, sessionId, 'session.v4.jsonl.zstd'), 'FAKE-LOG')
  await writeFile(join(PROJ, sessionId, 'session.lock'), '')
  if (extraProjectCopy) {
    const other = join(SESSIONS, '--D-Project-Other--', sessionId)
    await mkdir(other, { recursive: true })
    await writeFile(join(other, 'session.v4.jsonl.zstd'), 'FAKE-LOG-2')
  }
  await mkdir(PROJCACHE, { recursive: true })
  await writeFile(join(PROJCACHE, sessionId + '.json'), '{}')
  for (let i = 0; i < projcacheExtras; i++) await writeFile(join(PROJCACHE, `session-extra-${i}.json`), '{}')
  return { sessionId, children }
}

let currentActivity = []
let snapshots = []
let storageDeleted = []
let ledger = { unarchived: [], detached: [] }
const warnings = []

function makeHostCtx() {
  const routes = []
  const ctx = {
    logger: { warn: (m) => warnings.push(String(m)) },
    get(name) {
      if (name === 'dshHomePath') return (...segments) => join(HOME, ...segments)
      if (name === 'storageDomain') {
        return { get: () => ({ table: () => ({ delete: async (id) => { storageDeleted.push(id) } }) }) }
      }
      return undefined
    },
    async waterfall(_name, _request, next) {
      return currentActivity.length > 0 ? currentActivity : next()
    },
    sessionPersistence: {
      list: async () => snapshots,
      stat: async (id) => (existsSync(join(PROJ, id)) ? { header: { id } } : undefined),
    },
    workspaceRegistry: {
      unarchiveSession: async (id) => { ledger.unarchived.push(id) },
      list: () => [{ id: 'w1', sessionIds: ['session-aaaa'], detachSession: async (id) => { ledger.detached.push(id) } }],
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    connection: { requestRejection: () => currentRejection },
    effect: (fn) => { fn() },
  }
  return { ctx, routes }
}

let currentRejection
function makeReq({ method = 'POST', url = '/archived-sessions/api/delete', contentType = 'application/json', body = '{}' }) {
  const chunks = [Buffer.from(body)]
  return {
    method,
    url,
    headers: { 'content-type': contentType },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}
function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v },
    end(payload) { this.body = payload ?? '' },
  }
  return res
}

async function invoke(route, req) {
  const res = makeRes()
  await route.handler(req, res)
  let parsed = null
  try { parsed = JSON.parse(res.body) } catch {}
  return { status: res.statusCode, json: parsed, res }
}

// --- scenario 1: happy path
{
  const seeded = await seed({})
  snapshots = []
  currentActivity = []
  currentRejection = undefined
  storageDeleted = []
  ledger = { unarchived: [], detached: [] }
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const route = routes[0]
  record('registers the host route', route?.path === '/archived-sessions/api' && route.kind === 'prefix', JSON.stringify({ kind: route?.kind, path: route?.path }))

  const out = await invoke(route, makeReq({ body: JSON.stringify({ sessionId: seeded.sessionId }) }))
  record('happy path returns 200 ok', out.status === 200 && out.json?.ok === true, JSON.stringify(out.json))
  const movedFrom = join(PROJ, seeded.sessionId)
  record('session directory left the sessions tree', !existsSync(movedFrom))
  const trashRoot = join(HOME, '.deleted-sessions')
  const trashEntries = existsSync(trashRoot) ? await readdir(trashRoot) : []
  record('log parked in the quarantine folder', trashEntries.some((n) => n.endsWith('__' + seeded.sessionId)), trashEntries.join(','))
  record('quarantine manifest written', trashEntries.some((n) => n.endsWith('.json')))
  const manifestName = trashEntries.find((n) => n.endsWith('.json'))
  const manifest = manifestName ? JSON.parse(await readFile(join(trashRoot, manifestName), 'utf8')) : {}
  record('manifest records the original path for recovery', manifest.originalPath === movedFrom, manifest.originalPath)
  record('archived set cleared before the log moved', ledger.unarchived.includes(seeded.sessionId))
  record('workspace membership detached', ledger.detached.includes(seeded.sessionId))
  record('projection cache record deleted via the domain API', storageDeleted.includes(seeded.sessionId))
  record('response reports it is no longer stored', out.json?.value?.stillStored === false, String(out.json?.value?.stillStored))
}

// --- scenario 2: duplicate copies in two project dirs (the fatal mode)
{
  const seeded = await seed({ extraProjectCopy: true })
  snapshots = []
  currentActivity = []
  currentRejection = undefined
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const out = await invoke(routes[0], makeReq({ body: JSON.stringify({ sessionId: seeded.sessionId }) }))
  record(
    'refuses when the id exists in two project dirs (409)',
    out.status === 409 && out.json?.error?.code === 'session/duplicate-artifacts',
    `${out.status} ${out.json?.error?.code}`,
  )
  record('that refusal left the log untouched', existsSync(join(PROJ, seeded.sessionId)))
}

// --- scenario 3: active session
{
  const seeded = await seed({})
  snapshots = []
  currentActivity = [{ kind: 'turn', items: [{ id: 't1', label: 'running turn' }] }]
  currentRejection = undefined
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const out = await invoke(routes[0], makeReq({ body: JSON.stringify({ sessionId: seeded.sessionId }) }))
  record('refuses an active session (409)', out.status === 409 && out.json?.error?.code === 'session/active', `${out.status} ${out.json?.error?.code}`)
  record('that refusal names the activity', JSON.stringify(out.json?.error?.details ?? {}).includes('running turn'))
  record('active refusal left the log untouched', existsSync(join(PROJ, seeded.sessionId)))
}

// --- scenario 4: child sessions
{
  const seeded = await seed({})
  snapshots = [{ header: { id: 'session-child', parentSession: seeded.sessionId } }]
  currentActivity = []
  currentRejection = undefined
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const out = await invoke(routes[0], makeReq({ body: JSON.stringify({ sessionId: seeded.sessionId }) }))
  record('refuses a session that owns children (409)', out.status === 409 && out.json?.error?.code === 'session/has-children', `${out.status} ${out.json?.error?.code}`)
  record('that refusal lists the children', out.json?.error?.details?.children?.[0] === 'session-child')
}

// --- scenario 5: path-traversal id
{
  await seed({})
  snapshots = []
  currentActivity = []
  currentRejection = undefined
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const out = await invoke(routes[0], makeReq({ body: JSON.stringify({ sessionId: '../../../etc/passwd' }) }))
  record('rejects a traversal-shaped sessionId (400)', out.status === 400 && out.json?.error?.code === 'bad-request', `${out.status} ${out.json?.error?.code}`)
}

// --- scenario 6: auth gate
{
  const seeded = await seed({})
  currentRejection = 401
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const out = await invoke(routes[0], makeReq({ body: JSON.stringify({ sessionId: seeded.sessionId }) }))
  record('unauthenticated request is refused (401)', out.status === 401, String(out.status))
  record('auth refusal left the log untouched', existsSync(join(PROJ, seeded.sessionId)))
  currentRejection = undefined
}

// --- scenario 7: method and content-type
{
  const seeded = await seed({})
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const getOut = await invoke(routes[0], makeReq({ method: 'GET', body: '' }))
  record('GET is refused (405)', getOut.status === 405, String(getOut.status))
  const ctOut = await invoke(routes[0], makeReq({ contentType: 'text/plain', body: 'x' }))
  record('non-JSON content-type is refused (415)', ctOut.status === 415, String(ctOut.status))
  const opOut = await invoke(routes[0], makeReq({ url: '/archived-sessions/api/nope', body: '{}' }))
  record('unknown operation is refused (404)', opOut.status === 404, String(opOut.status))
}

// --- scenario 8: guard against resurrecting the legacy projection-cache unit
{
  const seeded = await seed({ projcacheExtras: 0 })
  snapshots = []
  currentActivity = []
  currentRejection = undefined
  storageDeleted = []
  const { ctx, routes } = makeHostCtx()
  host.apply(ctx)
  const out = await invoke(routes[0], makeReq({ body: JSON.stringify({ sessionId: seeded.sessionId }) }))
  record(
    'skips the cache delete when it is the last record',
    out.json?.value?.projectionCache === 'skipped-last-record' && storageDeleted.length === 0,
    String(out.json?.value?.projectionCache),
  )
}

await rm(HOME, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) {
  console.log('FAILURES:')
  for (const f of failed) console.log('  - ' + f.name + (f.detail ? ' :: ' + f.detail : ''))
  process.exitCode = 1
}
