/**
 * Session mover (Host half).
 *
 * Moves one closed Session into another Workspace the way the app itself
 * would: the log folder travels to the target Workspace's folder, the log
 * header's `cwd` is rewritten to that folder's path, and the Workspace entity's
 * own `attachSession` / `detachSession` (validated against the header) does the
 * accounting. The registry's canonical-cwd index is refreshed for that one
 * Session first, because it only rebuilds on startup.
 *
 * Every move is backed up (log folder + Workspace index) and rolled back if the
 * attach is refused, so a failure leaves the previous state rather than a
 * half-moved Session. Routes live on the app's own loopback server behind a
 * custom header a cross-origin page cannot send without a preflight.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createMover } from './mover.js?v=0.2.1-final'

const PREFIX = '/__session-mover'
const HEADER = 'x-session-mover'
const MAX_BODY = 256 * 1024

/** The `.dsh` home directory that holds storages, sessions and backups. */
function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const profile = process.env.DSH_PROFILE_DIR
  if (profile) return path.dirname(path.dirname(profile))
  return path.join(os.homedir(), '.dsh')
}

function workspaceFile() {
  return path.join(dshHome(), 'storages', 'workspace.json')
}

function sessionsRoot() {
  return path.join(dshHome(), 'sessions')
}

/** Owned directory for backups and diagnostics. */
function pluginDir() {
  return path.join(dshHome(), 'backups', 'session-mover')
}

/** Folder name a Workspace path is filed under: drive colon dropped, separators as '-'. */
function folderNameFor(workspacePath) {
  const normalized = workspacePath.replace(/[\\/]+$/, '')
  return `--${normalized.replace(/^([A-Za-z]):/, '$1').replace(/[\\/]+/g, '-')}--`
}

async function readWorkspaces() {
  try {
    return JSON.parse(await fs.readFile(workspaceFile(), 'utf8'))
  } catch {
    return null
  }
}

/** Workspace ids that list a Session in the durable index. */
function holders(index, sessionId) {
  const workspaces = index?.tables?.workspaces
  if (!workspaces || typeof workspaces !== 'object') return []
  return Object.entries(workspaces)
    .filter(([, entry]) => Array.isArray(entry?.sessionIds) && entry.sessionIds.includes(sessionId))
    .map(([id, entry]) => ({ workspaceId: entry?.workspaceId ?? id, title: entry?.title ?? null, path: entry?.path ?? null }))
}

async function backupIndex(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = pluginDir()
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `workspace-${stamp}-${reason}.json`)
  await fs.copyFile(workspaceFile(), target)
  return target
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function authorized(req) {
  return String(req.headers[HEADER] ?? '') === '1'
}

/** Locate the folder that currently holds one Session's log directory. */
async function findSessionFolder(sessionId) {
  let names = []
  try {
    names = await fs.readdir(sessionsRoot())
  } catch {
    return null
  }
  for (const name of names) {
    const sessionFolder = path.join(sessionsRoot(), name, sessionId)
    try {
      if ((await fs.stat(sessionFolder)).isDirectory()) return { folderName: name, sessionFolder }
    } catch {
      /* not in this folder */
    }
  }
  return null
}

/** Rewrite one Session log's header `cwd`, keeping the compressed JSONL shape. */
async function rewriteSessionCwd(sessionFolder, nextCwd) {
  const { zstdCompressSync, zstdDecompressSync } = await import('node:zlib')
  const file = path.join(sessionFolder, 'session.v4.jsonl.zstd')
  const compressed = await fs.readFile(file)
  const first = zstdDecompressSync(compressed, { info: true })
  const consumed = first.engine.bytesWritten
  if (!Number.isSafeInteger(consumed) || consumed <= 0 || consumed > compressed.length) throw new Error('cannot locate the first zstd frame safely')
  const text = first.buffer.toString('utf8')
  const trailing = text.endsWith('\n') ? '\n' : ''
  const lines = (trailing ? text.slice(0, -1) : text).split('\n')
  if (lines.length === 0) throw new Error('session log is empty')
  const header = JSON.parse(lines[0])
  if (header?.type !== 'session' || typeof header?.id !== 'string') throw new Error('unexpected session header')
  const previousCwd = header.cwd ?? null
  header.cwd = nextCwd
  lines[0] = JSON.stringify(header)
  const rewritten = zstdCompressSync(Buffer.from(`${lines.join('\n')}${trailing}`, 'utf8'))
  await fs.writeFile(file, Buffer.concat([rewritten, compressed.subarray(consumed)]))
  return { previousCwd, nextCwd }
}

/** Move one directory, falling back to copy+remove across volumes. */
async function moveDir(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.rename(from, to)
  } catch {
    await fs.cp(from, to, { recursive: true })
    await fs.rm(from, { recursive: true, force: true })
  }
}

/**
 * Drop this Session from the registry's canonical-cwd index so the next
 * `readSessionHeader` re-reads persistence instead of a startup-time cache.
 * Undocumented internal fields: absence is reported, never fatal, and a stale
 * cache only makes `attachSession` refuse with its own validation error.
 */
function evictHeaderIndex(registry, sessionId) {
  const report = {}
  for (const key of ['headers', 'sessionPaths', 'missingSessionPaths', 'invalidSessionPaths']) {
    const map = registry?.[key]
    if (map && typeof map.delete === 'function') {
      try {
        report[key] = map.delete(sessionId)
      } catch {
        report[key] = 'failed'
      }
    } else {
      report[key] = 'absent'
    }
  }
  return report
}

export const inject = ['webServer']

/**
 * Register the loopback routes the Client half calls.
 * @param ctx - plugin context; `webServer` is required, the rest optional.
 */
export function apply(ctx) {
  const mover = createMover(ctx, {
    findSessionFolder, sessionsRoot, folderNameFor, pluginDir, backupIndex,
    rewriteSessionCwd, evictHeaderIndex, readWorkspaces, holders,
  })
  ctx.effect(() => ctx.provide('sessionMover', mover), 'session-mover: shared operation')
  ctx.effect(() => ctx.get('tools')?.register({
    name: 'session_move',
    deferLoading: true,
    description: 'List workspace identifiers or move an idle conversation to another workspace, changing its working directory. Loaded conversations are safely reopened with their pending input preserved. Running conversations must be stopped first.',
    parameters: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['list', 'move'] },
        sessionId: { type: 'string', description: 'Conversation id for move.' },
        workspaceId: { type: 'string', description: 'Target workspace id for move; obtain it with list.' },
      }, required: ['action'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (args?.action === 'list') return mover.list()
      if (args?.action !== 'move') throw new Error('Unknown action')
      return mover.move(args)
    },
  }), 'session-mover: operation tool')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: `${PREFIX}/settled`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false })
      if (req.method !== 'POST') return send(res, 405, { ok: false })
      try { send(res, 200, await mover.settle((await readJson(req)).sessionId)) }
      catch (error) { send(res, 400, { ok: false, error: error.message }) }
    },
  }), 'session-mover: settled metadata barrier')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: `${PREFIX}/status`,
    handler: (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      send(res, 200, { ok: true, ...mover.status() })
    },
  }), 'session-mover: operation status')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/ping`,
    handler: (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      send(res, 200, { ok: true, app: 'session-mover', origin: ctx.webServer.getOrigin() })
    },
  }), 'session-mover: ping route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/env`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      let zstd = false
      try {
        const zlib = await import('node:zlib')
        zstd = typeof zlib.zstdCompressSync === 'function'
      } catch {
        zstd = false
      }
      send(res, 200, {
        ok: true,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        zstd,
        sessionsRoot: sessionsRoot(),
        index: { headers: 'headers' in (ctx.get('workspaceRegistry') ?? {}) },
      })
    },
  }), 'session-mover: env route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/sessions`,
    handler: (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      const registry = ctx.get('workspaceRegistry')
      if (!registry) return send(res, 200, { ok: false, error: 'workspaceRegistry unavailable' })
      send(res, 200, {
        ok: true,
        workspaces: registry.list().map((workspace) => ({
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessions: [...workspace.sessionIds],
        })),
      })
    },
  }), 'session-mover: sessions route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/live`,
    handler: (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      const agents = ctx.get('agents')
      send(res, 200, { ok: true, live: agents ? agents.list().map((agent) => String(agent.id)) : [] })
    },
  }), 'session-mover: live route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/move`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
      try {
        const body = await readJson(req)
        const sessionId = String(body.sessionId ?? '')
        const workspaceId = String(body.workspaceId ?? '')
        if (!sessionId || !workspaceId) throw new Error('sessionId and workspaceId are required')
        const controller = ctx.get('workspaceController')
        if (!controller) throw new Error('workspaceController is not available')
        await backupIndex('before-reorder')
        const result = await controller.insertSessionBefore({
          workspaceId,
          sessionId,
          ...(body.beforeSessionId ? { beforeSessionId: String(body.beforeSessionId) } : {}),
        })
        send(res, 200, { ok: true, workspace: result?.workspace ?? null })
      } catch (error) {
        send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'session-mover: reorder route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/cwd`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
      try {
        const body = await readJson(req)
        const sessionId = String(body.sessionId ?? '')
        const target = String(body.path ?? '')
        if (!sessionId || !target) throw new Error('sessionId and path are required')
        const agents = ctx.get('agents')
        const workingDirectory = ctx.get('workingDirectory')
        if (!agents || !workingDirectory) throw new Error('agents or workingDirectory is not available')
        const agent = agents.get(sessionId)
        if (!agent) return send(res, 200, { ok: false, reason: 'not-live' })
        send(res, 200, { ok: true, directory: await workingDirectory.set(agent, target) })
      } catch (error) {
        send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'session-mover: cwd route')

  /** One operation for drag, undo and the agent tool. */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: `${PREFIX}/relocate`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
      try {
        const result = await mover.move(await readJson(req))
        send(res, result.ok ? 200 : 409, result)
      } catch (error) {
        send(res, 400, { ok: false, code: 'BAD_REQUEST', error: error.message })
      }
    },
  }), 'session-mover: relocate route')

  /**
   * Recovery: account one on-disk Session to its own Workspace again after an
   * interrupted move left it unaccounted. Same validated attach as a move.
   */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/reattach`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
      try {
        const body = await readJson(req)
        const sessionId = String(body.sessionId ?? '')
        const workspaceId = String(body.workspaceId ?? '')
        const registry = ctx.get('workspaceRegistry')
        if (!registry) throw new Error('workspaceRegistry is not available')
        const workspace = registry.get(workspaceId)
        if (!workspace) throw new Error('unknown workspace')
        await backupIndex('before-reattach')
        const evicted = evictHeaderIndex(registry, sessionId)
        await workspace.attachSession(sessionId)
        send(res, 200, {
          ok: true,
          evicted,
          workspace: { id: workspace.id, title: workspace.title, sessions: [...workspace.sessionIds] },
          index: holders(await readWorkspaces(), sessionId),
        })
      } catch (error) {
        send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'session-mover: reattach route')


  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${PREFIX}/probe`,
    handler: async (req, res) => {
      if (!authorized(req)) return send(res, 403, { ok: false, error: 'missing header' })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })
      try {
        const body = await readJson(req)
        const dir = pluginDir()
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, 'rows-latest.json'), JSON.stringify(body, null, 2), 'utf8')
        send(res, 200, { ok: true })
      } catch (error) {
        send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'session-mover: probe route')
}
