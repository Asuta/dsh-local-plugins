/**
 * Host half of the archived-sessions manager.
 *
 * The framework has no delete-a-session API anywhere — `sessionPersistence` is
 * append-only (`create/open/stat/list/flush` only), `sessionController` has no
 * delete, and `workspaceRegistry.delete` removes a workspace registration while
 * keeping every session. So permanent deletion is an out-of-band maintenance
 * operation, and this route is the only entry point to it.
 *
 * Everything the App knows about a session is derived from its durable log. The
 * log is therefore the last thing removed and the first thing verified.
 */

import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'archived-sessions'

/**
 * `storageDomain` is deliberately absent: the projection cache is a pure derived
 * cache, so its cleanup is best-effort through `ctx.get` and never gates the
 * operation. `agents`/`sessions` are read through `ctx.get` for the same reason.
 */
export const inject = ['webServer', 'connection', 'workspaceRegistry', 'sessionPersistence']

/** Route prefix. Chosen to avoid `/plugins`, `/open-in-app/*` and the `/api` RPC channel. */
const ROUTE = '/archived-sessions/api'

/** Quarantine folder under DSH_HOME, deliberately OUTSIDE `sessions/`. */
const QUARANTINE_DIR = '.deleted-sessions'

/** Guard against a traversal segment reaching the filesystem as a path. */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{1,200}$/

const MAX_BODY_BYTES = 64 * 1024

/** A session id is a single safe path segment; reject anything else outright. */
function isSafeSessionId(value) {
  return typeof value === 'string' && SAFE_SESSION_ID.test(value) && value !== '.' && value !== '..'
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

function sendMethodNotAllowed(res, allowed) {
  res.setHeader('allow', allowed)
  sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: `use ${allowed}` } })
}

function statusFor(code) {
  switch (code) {
    case 'bad-request': return 400
    case 'session/unknown': return 404
    case 'session/active':
    case 'session/has-children':
    case 'session/duplicate-artifacts': return 409
    default: return 500
  }
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

export function apply(ctx) {
  /** Resolve a path under DSH_HOME through the boot-provided helper when present. */
  const home = (...segments) => {
    const resolver = ctx.get('dshHomePath')
    if (typeof resolver === 'function') return resolver(...segments)
    const base = process.env.DSH_HOME || join(homedir(), '.dsh')
    return join(base, ...segments)
  }

  const sessionsRoot = () => home('sessions')

  /**
   * Find every stored directory for one session id.
   *
   * A session directory is named after the encoded id, and a real `session-<uuid>`
   * id encodes to itself. More than one match is the one condition that breaks the
   * whole application: the JSONL backend throws
   * `duplicate JSONL session id ... appears in multiple project directories`, which
   * fails `sessionPersistence.list()` and with it the session list and workspace
   * grouping. Callers must refuse rather than guess which copy is real.
   */
  async function locateSessionDirs(id) {
    let projectDirs
    try {
      projectDirs = await readdir(sessionsRoot(), { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const found = []
    for (const entry of projectDirs) {
      if (!entry.isDirectory()) continue
      const candidate = join(sessionsRoot(), entry.name, id)
      try {
        const info = await stat(candidate)
        if (info.isDirectory()) found.push(candidate)
      } catch {
        // Absent in this project directory; that is the normal case.
      }
    }
    return found
  }

  /** Stored snapshots, or a refusal reason when the backend itself cannot enumerate. */
  async function storedSnapshots() {
    try {
      return { ok: true, snapshots: await ctx.sessionPersistence.list() }
    } catch (error) {
      return {
        ok: false,
        message: error && error.message ? error.message : String(error),
      }
    }
  }

  /** How many per-record projection-cache documents exist right now. */
  async function projectionCacheCount() {
    try {
      const names = await readdir(home('storages', 'session_projcache', 'sessions'))
      return names.filter((entry) => entry.endsWith('.json') && !entry.includes('.bak.')).length
    } catch {
      return 0
    }
  }

  /**
   * Drop one projection-cache record through the domain API.
   *
   * The domain layer keeps memory authoritative and treats its files as a
   * projection, so deleting the file alone is a no-op — the record keeps being
   * served and is rewritten at the next checkpoint.
   *
   * The last remaining record is deliberately left in place: an empty per-record
   * tree makes the JSON storage backend bootstrap the legacy `single`-layout unit
   * (`storages/session_projcache.json`, v3, ~126 records) back into v7 documents,
   * because v3 sits inside the spec's `compatibleVersions`. One stale record is
   * harmless — a fold seed requires formatVersion, lifecycle and
   * `inheritedEventCount` to match exactly — whereas that resurrection is not.
   */
  async function cleanProjectionCache(id, remaining) {
    if (remaining <= 1) return remaining === 1 ? 'skipped-last-record' : 'absent'
    const domain = ctx.get('storageDomain')?.get?.('session_projcache')
    const table = domain?.table?.('sessions')
    if (table === undefined || typeof table.delete !== 'function') return 'unavailable'
    await table.delete(id)
    return 'deleted'
  }

  /**
   * Permanently remove one archived session.
   *
   * Order matters. The workspace ledger is cleared first so a later failure leaves
   * a clean ledger with an intact log — a recoverable state — rather than a dirty
   * ledger over a missing log. The log itself moves last, and it is moved rather
   * than unlinked so a mistake stays recoverable out of band.
   */
  async function deleteSession(id) {
    if (!isSafeSessionId(id)) {
      return { ok: false, error: { code: 'bad-request', message: 'sessionId must be a plain session id' } }
    }

    // Refuse to touch a session that is still live or still doing work: its write
    // handle keeps the path, and on Windows the lease is a named kernel semaphore
    // that does NOT block the move — the log would silently reappear or corrupt.
    if (ctx.get('agents')?.get?.(id) !== undefined || ctx.get('sessions')?.get?.(id) !== undefined) {
      return { ok: false, error: { code: 'session/active', message: 'session is live in this process' } }
    }
    let activity
    try {
      activity = await ctx.waterfall('workspace/session-activity', { sessionId: id }, () => Promise.resolve([]))
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `activity probe failed: ${error && error.message ? error.message : String(error)}` } }
    }
    if (Array.isArray(activity) && activity.length > 0) {
      return {
        ok: false,
        error: {
          code: 'session/active',
          message: 'session still has running work',
          details: { activity: activity.map((entry) => ({ kind: entry.kind, items: entry.items ?? [] })) },
        },
      }
    }

    // No cascade exists in this model: lineage lives only in the child's immutable
    // header, so deleting a parent would leave silent orphans. Refuse and name them.
    const listed = await storedSnapshots()
    if (!listed.ok) {
      return { ok: false, error: { code: 'session/duplicate-artifacts', message: listed.message } }
    }
    const children = listed.snapshots
      .filter((snapshot) => snapshot?.header?.parentSession === id)
      .map((snapshot) => snapshot.header.id)
    if (children.length > 0) {
      return {
        ok: false,
        error: { code: 'session/has-children', message: 'session still owns child sessions', details: { children } },
      }
    }

    const directories = await locateSessionDirs(id)
    if (directories.length > 1) {
      return {
        ok: false,
        error: {
          code: 'session/duplicate-artifacts',
          message: 'this session id exists in more than one project directory; refusing to guess',
          details: { directories },
        },
      }
    }

    // Ledger first: unarchive is idempotent and skips the existence check, and
    // `archivedSessionIds` never self-prunes, so a leftover id would be a permanent
    // ghost — one that a later id reuse would resolve as already archived.
    const detached = []
    await ctx.workspaceRegistry.unarchiveSession(id)
    for (const workspace of ctx.workspaceRegistry.list()) {
      if (!Array.isArray(workspace.sessionIds) || !workspace.sessionIds.includes(id)) continue
      await workspace.detachSession(id)
      detached.push(workspace.id)
    }

    const projectionCache = await cleanProjectionCache(id, await projectionCacheCount())

    let movedFrom
    let movedTo
    if (directories.length === 1) {
      movedFrom = directories[0]
      const quarantineRoot = home(QUARANTINE_DIR)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      movedTo = join(quarantineRoot, `${stamp}__${id}`)
      await mkdir(quarantineRoot, { recursive: true })
      await rename(movedFrom, movedTo)
      await writeFile(
        join(quarantineRoot, `${stamp}__${id}.json`),
        JSON.stringify({ sessionId: id, removedAt: new Date().toISOString(), originalPath: movedFrom, movedTo }, null, 2),
        'utf8',
      )
    }

    let stillStored = null
    try {
      stillStored = (await ctx.sessionPersistence.stat(id)) !== undefined
    } catch {
      stillStored = null
    }

    return {
      ok: true,
      value: {
        sessionId: id,
        logFound: directories.length === 1,
        movedFrom,
        movedTo,
        quarantine: home(QUARANTINE_DIR),
        ledgerUnarchived: true,
        ledgerDetached: detached,
        projectionCache,
        stillStored,
      },
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          // A destructive route carries the same browser authentication and
          // Host/Origin checks as the shipped ones; an unauthenticated local
          // process must not be able to delete a session with one POST.
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            sendJson(res, rejection, { ok: false, error: { code: 'unauthorized', message: 'request rejected' } })
            return
          }
          if (req.method !== 'POST') {
            sendMethodNotAllowed(res, 'POST')
            return
          }
          const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
          if (contentType !== 'application/json') {
            sendJson(res, 415, { ok: false, error: { code: 'unsupported-media-type', message: 'content-type must be application/json' } })
            return
          }

          const pathname = new URL(String(req.url), 'http://localhost').pathname
          const operation = pathname.slice(ROUTE.length).replace(/^\//, '')
          if (operation !== 'delete') {
            sendJson(res, 404, { ok: false, error: { code: 'unknown-operation', message: `unknown operation "${operation}"` } })
            return
          }

          let body
          try {
            body = await readJsonBody(req)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: error && error.message ? error.message : String(error) } })
            return
          }

          try {
            const result = await deleteSession(body.sessionId)
            sendJson(res, result.ok ? 200 : statusFor(result.error.code), result)
          } catch (error) {
            ctx.logger.warn(`archived-sessions: delete failed: ${error && error.stack ? error.stack : String(error)}`)
            sendJson(res, 500, {
              ok: false,
              error: { code: 'internal', message: error && error.message ? error.message : String(error) },
            })
          }
        },
      }),
    `archived-sessions: POST ${ROUTE}/delete`,
  )
}
