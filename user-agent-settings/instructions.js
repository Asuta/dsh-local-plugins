/**
 * Fill the native global AGENTS gap for presets without agent-instructions.
 * No file access or profile writes; the parent owns the synchronous text cache.
 *
 * Public API: await createGlobalInstructionsAdapter(ctx, getInstructionsText)
 * -> { refresh(): Promise<status>, status(): plain diagnostics,
 *      dispose(): Promise<void> }.
 *
 * Native assembleContextFor(agent) supplies scope=agent. Use that exact public
 * Agent/context relationship and agentPresets.composedPreset(), plus exact
 * acquireScope() keys for cold assembly. No private scope symbols or imports.
 */
const NATIVE_LOADER = '@deepseek-ai/dsh-agent-instructions'
const CONTEXT_NAME = 'user-agent-settings.global-instructions'

export async function createGlobalInstructionsAdapter(ctx, getInstructionsText) {
  if (typeof getInstructionsText !== 'function') throw new TypeError('getInstructionsText must be a function')
  const presets = ctx.get('agentPresets')
  const prompt = ctx.get('systemPrompt')
  if (!presets?.compositionInventory || !presets?.acquireScope || !presets?.composedPreset || !prompt?.context) {
    throw new Error('Global instructions require the native agentPresets and systemPrompt services.')
  }
  let rows = new Map()
  let leases = new Map()
  let pending = null
  let dirty = false
  let disposed = false
  let disposal = null
  let lastError = null
  let generation = 0
  let unregisterContext = null
  const listeners = []

  function warn(error) {
    lastError = error instanceof Error ? error.message : String(error)
    try { ctx.logger?.warn?.('Global instructions adapter: ' + lastError) } catch {}
  }
  function text() {
    const value = getInstructionsText()
    if (typeof value !== 'string') throw new TypeError('getInstructionsText must return a string')
    return value.trim() ? value : ''
  }
  async function release(lease) {
    if (lease?.[Symbol.asyncDispose]) await lease[Symbol.asyncDispose]()
    else if (lease?.dispose) await lease.dispose()
  }
  function modeOf(inventory) {
    const native = (inventory.rows ?? []).filter(row => row.moduleName === NATIVE_LOADER)
    if (native.some(row => row.enabled === true)) return 'native'
    // Conditional ownership is uncertain: suppress our copy instead of risking
    // two copies if the native loader activates. Report it in status.
    if (native.some(row => row.enabled === 'conditional')) return 'uncertain'
    return 'fallback'
  }
  async function rebuild() {
    const inventory = await presets.compositionInventory()
    const nextRows = new Map()
    const nextLeases = new Map()
    try {
      for (const entry of inventory) {
        const mode = modeOf(entry)
        const row = { id: entry.id, mode, broken: typeof entry.broken === 'string' ? entry.broken : null }
        nextRows.set(entry.id, row)
        if (mode !== 'fallback' || row.broken) continue
        const lease = await presets.acquireScope(entry.id)
        if (disposed) { await release(lease); break }
        nextLeases.set(entry.id, lease)
      }
    } catch (error) {
      await Promise.allSettled([...nextLeases.values()].map(release))
      throw error
    }
    if (disposed) {
      await Promise.allSettled([...nextLeases.values()].map(release))
      return
    }
    const previous = leases
    rows = nextRows
    leases = nextLeases
    lastError = null
    generation++
    const results = await Promise.allSettled([...previous.values()].map(release))
    for (const result of results) if (result.status === 'rejected') warn(result.reason)
  }
  function refresh() {
    if (disposed) return Promise.resolve(status())
    dirty = true
    if (pending) return pending
    pending = (async () => {
      while (dirty && !disposed) { dirty = false; await rebuild() }
      return status()
    })().catch(error => { warn(error); throw error }).finally(() => { pending = null })
    return pending
  }
  function fallbackFor(scope) {
    if (scope === undefined) return true
    // Cold presentation acquires and supplies the revision key itself.
    for (const [id, lease] of leases) if (scope === lease.key) return rows.get(id)?.mode === 'fallback'
    // Live main/subagents are their own native prompt assembly scope keys.
    // Reading the composed preset through its public context API is crucial:
    // Agent.ctx.get cannot resolve the isolated preset composition.
    if (scope && typeof scope === 'object' && scope.ctx) {
      const id = presets.composedPreset(scope.ctx)
      return id !== undefined && rows.get(id)?.mode === 'fallback' && !rows.get(id)?.broken
    }
    return false
  }
  function contextText(assembly = {}) {
    if (disposed || !fallbackFor(assembly.scope)) return ''
    return text()
  }
  function status() {
    return {
      available: !disposed && unregisterContext !== null,
      mechanism: 'required-native-prompt-context',
      contextName: CONTEXT_NAME,
      generation, disposed, pending: pending !== null,
      presets: [...rows.values()].map(row => ({
        id: row.id, nativeGlobalFile: row.mode === 'native',
        fallback: row.mode === 'fallback' && !row.broken,
        leaseActive: leases.has(row.id), uncertain: row.mode === 'uncertain', broken: row.broken,
      })),
      limitations: [...rows.values()].filter(row => row.mode === 'uncertain' || row.broken).map(row => ({
        id: row.id, reason: row.broken ?? 'Conditional native instruction loader: fallback suppressed to prevent duplication.',
      })),
      error: lastError,
    }
  }
  async function readyFor(agent) {
    if (pending) await pending
    const id = agent?.ctx ? presets.composedPreset(agent.ctx) : undefined
    if (id !== undefined && !rows.has(id)) await refresh()
  }
  function scheduleRefresh() { refresh().catch(() => {}) }
  function dispose() {
    if (disposal) return disposal
    disposed = true
    const removals = listeners.splice(0)
    if (unregisterContext) { removals.push(unregisterContext); unregisterContext = null }
    disposal = (async () => {
      const removed = await Promise.allSettled(removals.map(off => Promise.resolve().then(off)))
      for (const result of removed) if (result.status === 'rejected') warn(result.reason)
      if (pending) await pending.catch(() => {})
      const previous = leases; leases = new Map()
      const released = await Promise.allSettled([...previous.values()].map(release))
      for (const result of released) if (result.status === 'rejected') warn(result.reason)
    })()
    return disposal
  }
  try {
    listeners.push(ctx.on('agent/created', async ({ agent }) => { await refresh(); await readyFor(agent) }))
    listeners.push(ctx.on('agent/pre-step', async ({ agent }, next) => { await readyFor(agent); return next() }, { prepend: true }))
    listeners.push(ctx.on('app-boot/config-reload', scheduleRefresh))
    listeners.push(ctx.on('agent-preset/selected', scheduleRefresh))
    await refresh()
    unregisterContext = prompt.context({
      name: CONTEXT_NAME, order: 100, text: contextText, required: true, interpolate: false,
    })
  } catch (error) {
    await dispose()
    throw error
  }
  return { refresh, status, dispose }
}
