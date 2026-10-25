import fs from 'node:fs/promises'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const ORIGINAL = Symbol.for('cordis.original')
const EFFECT = Symbol.for('cordis.effect')
const raw = value => value?.[ORIGINAL] ?? value
const fail = (code, message) => Object.assign(new Error(message), { code })
const message = error => error instanceof Error ? error.message : String(error)

/** Runtime-shape-checked, per-session lifecycle adapter. All patches are effect-owned. */
export function createMover(ctx, io) {
  const moving = new Map()
  const active = new Map()
  const owner = new AsyncLocalStorage()
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const controller = ctx.get('sessionController')
  const registry = ctx.get('workspaceRegistry')
  const persistence = ctx.get('sessionPersistence')
  const resolver = raw(controller)?.agents
  const commands = raw(controller)?.commands
  const factory = raw(agents)?.factory?.target
  const events = raw(ctx.events)
  const restores = []
  let stopping = false
  let supported = false
  let suppressedRemovals = 0

  function patch(target, key, build) {
    target = raw(target)
    if (!target || typeof target[key] !== 'function') throw fail('UNSUPPORTED', `Missing lifecycle adapter: ${key}`)
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    const original = target[key]
    const replacement = build(original)
    Object.defineProperty(target, key, { configurable: true, writable: true, value: replacement })
    const restore = () => {
      if (target[key] !== replacement) return
      if (descriptor) Object.defineProperty(target, key, descriptor)
      else delete target[key]
    }
    restores.push(restore)
    return restore
  }

  const own = id => moving.get(id) !== undefined && owner.getStore() === moving.get(id)
  async function admitted(id, operation) {
    while (moving.has(id) && !own(id)) {
      await moving.get(id).done
      if (stopping) throw fail('UNAVAILABLE', 'Session mover is unloading; retry the operation')
    }
    active.set(id, (active.get(id) ?? 0) + 1)
    try { return await operation() }
    finally {
      const count = active.get(id) - 1
      if (count) active.set(id, count)
      else active.delete(id)
    }
  }

  ctx.effect(() => {
    try {
      if (!resolver || !commands || !factory || !persistence || !registry) throw fail('UNSUPPORTED', 'Required session services are unavailable')
      // This is the shared entry used by Web commands, Typert lookups and follow promotion.
      patch(resolver, 'resolve', original => async function (id, observation) {
        const entry = moving.get(id)
        if (entry && !own(id)) {
          await entry.done
          observation = undefined // an observation retained before a move has the old header
        }
        return admitted(id, () => original.call(this, id, observation))
      })
      // Count whole mutations, including work after agent lookup (attachments, model selection).
      for (const name of ['prompt', 'rename', 'updateQueue', 'selectModel', 'fork', 'create']) {
        patch(commands, name, original => function (request, ...rest) {
          if (!request?.sessionId) return original.call(this, request, ...rest)
          return admitted(request.sessionId, () => original.call(this, request, ...rest))
        })
      }
      patch(ctx.get('commands'), 'execute', original => function (agent, ...rest) {
        return admitted(agent.id, () => {
          if (raw(agents.get(agent.id)) !== raw(agent)) throw fail('SESSION_BUSY', 'The conversation moved; retry the command')
          return original.call(this, agent, ...rest)
        })
      })
      patch(factory, 'resumeWith', original => function (context, store, options) {
        return admitted(options.resumeSessionId, () => original.call(this, context, store, options))
      })
      patch(factory, 'createAgent', original => function (context, options) {
        return admitted(options.sessionId, () => original.call(this, context, options))
      })
      patch(ctx.get('sessionQuery'), 'observeSession', original => function (id, ...rest) {
        return admitted(id, () => original.call(this, id, ...rest))
      })
      patch(persistence, 'open', original => function (id, ...rest) {
        return admitted(id, () => original.call(this, id, ...rest))
      })
      // A transient registry detach during relocation is not a user deletion.
      // Preserve Client Session/binding/draft/scroll identities in every connected window.
      patch(events, 'emit', original => function (...args) {
        const offset = typeof args[0] === 'object' || typeof args[0] === 'function' ? 1 : 0
        if (args[offset] === 'api-session/removed' && moving.has(args[offset + 1])) {
          suppressedRemovals += 1
          return
        }
        return original.apply(this, args)
      })
      supported = true
    } catch (error) {
      for (const restore of restores.splice(0).reverse()) restore()
      ctx.logger.warn(`session-mover: live relocation unavailable: ${message(error)}`)
    }
    return async () => {
      stopping = true
      await Promise.allSettled([...moving.values()].map(entry => entry.done))
      supported = false
      for (const restore of restores.splice(0).reverse()) restore()
    }
  }, 'session-mover: lifecycle admission and transient detach adapter')

  function lifecycle(id) {
    const fibers = new Set([ctx.root.fiber])
    for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) fibers.add(fiber)
    const matches = []
    for (const fiber of fibers) for (const fn of fiber._disposables ?? []) {
      if (fn[EFFECT]?.label === `agentLoop.lifecycle(${id})`) matches.push(fn)
    }
    if (matches.length !== 1) throw fail('UNSUPPORTED', `Expected one lifecycle owner; found ${matches.length}`)
    return matches[0]
  }

  async function unload(agent) {
    agent = raw(agent)
    if (agent.phase?.kind !== 'idle') throw fail('AGENT_RUNNING', 'Stop the reply or tool execution before moving this conversation')
    if (!agent.inbox || typeof agent.inbox.current !== 'function') throw fail('UNSUPPORTED', 'Durable inbox adapter is unavailable')
    const dispose = lifecycle(agent.id)
    const descriptor = Object.getOwnPropertyDescriptor(agent, 'cancel')
    const original = agent.cancel
    // The standard teardown clears the inbox. Keep its durable splices intact instead.
    agent.cancel = function (cause, options) { return original.call(this, cause, { ...options, keepInbox: true }) }
    try {
      await dispose()
      if (agents.get(agent.id) || sessions.get(agent.id)) throw fail('UNLOAD_FAILED', 'The conversation did not fully detach')
    } finally {
      if (descriptor) Object.defineProperty(agent, 'cancel', descriptor)
      else delete agent.cancel
    }
  }

  async function reopen(id, expectedCwd, inbox) {
    const result = await controller.resolveAgent(id)
    if (result.error) throw fail('REOPEN_FAILED', result.error.message)
    const agent = result.agent
    if (agent.session.header.cwd !== expectedCwd) throw fail('REOPEN_FAILED', 'The restored conversation has an unexpected directory')
    if (inbox !== null && JSON.stringify(raw(agent).inbox.current()) !== inbox) throw fail('QUEUE_MISMATCH', 'Pending input changed during restoration')
    return agent
  }

  async function exists(file) {
    try { await fs.lstat(file); return true }
    catch (error) { if (error.code === 'ENOENT') return false; throw error }
  }

  async function transfer(from, to) {
    if (await exists(to)) throw fail('DESTINATION_EXISTS', 'The destination already contains this conversation')
    await fs.mkdir(path.dirname(to), { recursive: true })
    try { await fs.rename(from, to) }
    catch (error) {
      if (error.code !== 'EXDEV') throw error
      // Keep the source until the complete copy exists. The transaction's backup
      // is authoritative if either a copy or source removal fails part way.
      await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
      await fs.rm(from, { recursive: true })
    }
  }

  async function transaction(id, workspaceId) {
    let source, target, located, destination, backup, indexBackup, originalCwd
    let wasLive = false, unloaded = false, touched = false, inbox = null
    try {
      target = registry.get(workspaceId)
      if (!target) throw fail('UNKNOWN_WORKSPACE', 'Unknown target workspace')
      source = registry.list().find(workspace => workspace.sessionIds.includes(id))
      if (!source) throw fail('UNACCOUNTED', 'This conversation has no source workspace')
      if (source.id === target.id) return { ok: true, unchanged: true, sessionId: id }
      const targetPath = await fs.realpath(target.path)
      const targetFolder = io.folderNameFor(targetPath)
      destination = path.join(io.sessionsRoot(), targetFolder, id)
      if (await exists(destination)) throw fail('DESTINATION_EXISTS', 'The destination already contains this conversation')
      if (resolver.resumes?.has(id) || resolver.claims?.has(id)) throw fail('SESSION_BUSY', 'The conversation is being opened or configured; retry shortly')
      const agent = agents.get(id)
      wasLive = Boolean(agent)
      if (!agent && sessions.get(id)) throw fail('SESSION_BUSY', 'The conversation is attached without an ordinary Agent')
      if (agent) {
        const concrete = raw(agent)
        if (concrete.phase?.kind !== 'idle') throw fail('AGENT_RUNNING', 'Stop the reply or tool execution before moving this conversation')
        if (agent.session.header.origin === 'subagent') throw fail('SUBAGENT', 'Move the parent conversation instead of its subagent')
        inbox = JSON.stringify(concrete.inbox.current())
        originalCwd = agent.session.header.cwd
        if (!await sessions.flush(agent.session)) throw fail('SAVE_FAILED', 'No session durability checkpoint participated')
        // Saving can run asynchronous listeners; recheck before lifecycle teardown.
        if (concrete.phase?.kind !== 'idle' || raw(agents.get(id)) !== concrete) throw fail('SESSION_BUSY', 'The conversation became active while saving')
        unloaded = true // teardown can detach successfully and still report a cleanup failure
        await unload(agent)
      }
      located = await io.findSessionFolder(id)
      if (!located) throw fail('NOT_FOUND', 'Session log folder not found')
      if (located.folderName === targetFolder) throw fail('ALREADY_THERE', 'The log is already in that workspace')
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      backup = path.join(io.pluginDir(), 'session-backups', `${id}-${stamp}`)
      await fs.mkdir(path.dirname(backup), { recursive: true })
      await fs.cp(located.sessionFolder, backup, { recursive: true, errorOnExist: true, force: false })
      indexBackup = await io.backupIndex('before-relocate')
      // A preparation-only failure must not rewrite or restore any log bytes.
      touched = true
      const rewrite = await io.rewriteSessionCwd(located.sessionFolder, targetPath)
      originalCwd ??= rewrite.previousCwd
      await transfer(located.sessionFolder, destination)
      io.evictHeaderIndex(registry, id)
      await target.attachSession(id)
      await source.detachSession(id)
      const accounted = io.holders(await io.readWorkspaces(), id)
      if (accounted.length !== 1 || accounted[0].workspaceId !== target.id) throw fail('INDEX_MISMATCH', 'Workspace membership did not settle')
      if (wasLive) await reopen(id, targetPath, inbox)
      // A full summary refresh also covers cold moves and other open windows.
      try {
        const summary = (await controller.list({}, new AbortController().signal)).items.find(row => row.sessionId === id)
        if (summary) ctx.emit('api-session/added', summary)
      } catch (error) { ctx.logger.warn(`session-mover: summary refresh: ${message(error)}`) }
      return {
        ok: true, sessionId: id, reopened: wasLive, queuePreserved: true,
        source: { id: source.id, title: source.title },
        target: { id: target.id, title: target.title },
        cwd: targetPath, backup, indexBackup,
      }
    } catch (error) {
      let restoreError = null
      let rolledBack = false
      try {
        if (touched) {
          const loaded = agents.get(id)
          if (loaded) await unload(loaded)
          if (sessions.get(id)) throw fail('RESTORE_BUSY', 'Cannot restore a log while it remains attached')
          // Both exact paths are derived from the checked UUID and registry paths.
          // Never replace any other conversation or the whole workspace index.
          if (await exists(destination)) await fs.rm(destination, { recursive: true })
          if (await exists(located.sessionFolder)) await fs.rm(located.sessionFolder, { recursive: true })
          await fs.cp(backup, located.sessionFolder, { recursive: true, errorOnExist: true, force: false })
          await target.detachSession(id)
          await source.detachSession(id)
          io.evictHeaderIndex(registry, id)
          await source.attachSession(id)
          const accounted = io.holders(await io.readWorkspaces(), id)
          if (accounted.length !== 1 || accounted[0].workspaceId !== source.id) throw fail('RESTORE_INDEX', 'Original workspace membership could not be restored')
          rolledBack = true
        }
        if (wasLive && (unloaded || touched) && !agents.get(id)) {
          await reopen(id, originalCwd, inbox)
        }
      } catch (restore) { restoreError = message(restore); rolledBack = false }
      return { ok: false, code: error.code ?? 'MOVE_FAILED', error: message(error), rolledBack, restoreError, backup, indexBackup }
    }
  }

  async function move({ sessionId: id, workspaceId }) {
    if (!/^session-[0-9a-f-]{36}$/i.test(id ?? '') || typeof workspaceId !== 'string' || !workspaceId) return { ok: false, code: 'BAD_REQUEST', error: 'Valid sessionId and workspaceId are required' }
    if (stopping || !supported) return { ok: false, code: 'UNSUPPORTED', error: 'This DSH version does not support the lifecycle adapter' }
    if (moving.size) return { ok: false, code: 'MOVE_IN_PROGRESS', error: 'Another conversation is being moved; retry when it finishes' }
    if (active.get(id)) return { ok: false, code: 'SESSION_BUSY', error: 'The conversation has an operation in progress; retry shortly' }
    let release
    const entry = { done: new Promise(resolve => { release = resolve }) }
    moving.set(id, entry)
    try { return await owner.run(entry, () => transaction(id, workspaceId)) }
    finally { moving.delete(id); release() }
  }

  return {
    move,
    settle: async id => { const entry = moving.get(id); if (entry) await entry.done; return { ok: true } },
    list: () => ({ ok: true, workspaces: registry.list().map(w => ({ workspaceId: w.id, title: w.title, path: w.path, sessionCount: w.sessionIds.length })) }),
    status: () => ({ supported, moving: [...moving.keys()], suppressedRemovals }),
  }
}
