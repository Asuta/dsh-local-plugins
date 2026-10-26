import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompactionAdapter } from '../user-agent-settings/compaction.js'

function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
class BasicCompactionEngine {
  constructor(config = {}) {
    this.config = freeze({ thresholdRatio: .8, retainRatio: .16, headroomTokens: 65536, maxTokens: 321, compactionRetries: 1, maxOverflowRetries: 1, auto: true, summarizationProvider: 'preset', summarizationModel: 'preset-model', modelPolicies: [{ provider: 'main', model: 'chat', summarizationProvider: 'other', summarizationModel: 'other-summary', maxTokens: 222, retainTokens: 12 }], ...config })
    this.ctx = { source: 'engine' }
  }
  async summarize(input, agent, signal) {
    const config = this.config
    const header = agent.session.requestHeader()?.config
    const target = header ?? agent.options
    const policy = config.modelPolicies.find(row => row.provider === target.provider && row.model === target.model) ?? config
    const route = policy.summarizationProvider ? { provider: policy.summarizationProvider, model: policy.summarizationModel } : target
    await input.pause
    return { ...route, maxTokens: policy.maxTokens ?? config.maxTokens, config, ctx: this.ctx, signal, input, agent, receiver: this }
  }
  compactNow(agent, signal) { return this.summarize({}, agent, signal) }
  compactRegion(start, end, agent, signal) { return this.summarize({ start, end }, agent, signal) }
  compactIfNeeded(agent, trigger, signal) { return this.compactRegion(1, 2, agent, signal) }
}
function agent(id, engine, route = { provider: 'main', model: 'chat' }) {
  return { id, ctx: scope({ compaction: engine }), options: { provider: 'options', model: 'fallback' }, session: { requestHeader: () => route === null ? undefined : { config: route } } }
}
function scope(initial = {}) {
  const services = { ...initial }, handlers = new Map(), watches = [], effects = []
  return {
    services, watches, effects, logger: { warn() {} },
    get(key) { return services[key] },
    on(name, fn) { const rows = handlers.get(name) ?? []; rows.push(fn); handlers.set(name, rows); return () => { rows.splice(rows.indexOf(fn), 1) } },
    emit(name, payload) { for (const fn of [...handlers.get(name) ?? []]) fn(payload) },
    names() { return [...handlers.keys()].filter(name => handlers.get(name).length) },
    inject(_keys, callback) {
      const watch = { dispose() { if (watch.dead) return; watch.dead = true; watch.cleanup?.() } }
      watches.push(watch)
      if (services.compaction) watch.cleanup = callback(this)
      watch.reload = () => { watch.cleanup?.(); watch.cleanup = services.compaction ? callback(this) : undefined }
      return watch
    },
    effect(fn) { const cleanup = fn(); let done = false; const off = () => { if (!done) { done = true; return cleanup?.() } }; effects.push(off); return off },
  }
}
function fixture(engines = [new BasicCompactionEngine()]) {
  let selection = null
  const agents = engines.map((engine, index) => agent('s' + index, engine))
  const llm = { listProviders: () => [{ id: 'chosen' }], listModels: async () => [{ id: 'summary' }], stream: () => { throw Error('No real model request allowed') } }
  const ctx = scope({ agents: { list: () => agents }, llm })
  const adapter = createCompactionAdapter(ctx, () => selection)
  return { ctx, adapter, agents, engines, select: value => { selection = value } }
}

test('following conversation overrides preset summary pairs without changing originals', async () => {
  const f = fixture(); const engine = f.engines[0]; const config = engine.config; const owner = f.agents[0]
  const result = await engine.compactNow(owner, undefined)
  assert.equal(result.provider, 'main'); assert.equal(result.model, 'chat')
  assert.equal(result.maxTokens, 222); assert.equal(result.config.modelPolicies[0].retainTokens, 12)
  assert.equal(engine.config, config); assert.equal(engine.config.summarizationProvider, 'preset')
  assert.equal(owner.options.provider, 'options'); assert.equal(owner.session.requestHeader().config.provider, 'main')
  assert(Object.isFrozen(result.config)); assert(Object.isFrozen(result.config.modelPolicies[0]))
  await f.adapter.dispose(); assert.equal(engine.summarize, BasicCompactionEngine.prototype.summarize)
  assert.equal(Object.hasOwn(engine, 'summarize'), false)
})

test('all compaction entry paths use chosen pair while main routing remains unchanged', async () => {
  const f = fixture(); f.select({ provider: 'chosen', model: 'summary' }); const engine = f.engines[0], owner = f.agents[0], signal = new AbortController().signal
  for (const operation of [() => engine.compactIfNeeded(owner, 'pressure', signal), () => engine.compactIfNeeded(owner, 'context-overflow', signal), () => engine.compactNow(owner, signal), () => engine.compactRegion(4, 7, owner, signal)]) {
    const result = await operation(); assert.equal(result.provider, 'chosen'); assert.equal(result.model, 'summary'); assert.equal(result.signal, signal); assert.equal(result.agent, owner)
  }
  assert(!f.ctx.names().includes('llm/stream')); assert(!f.ctx.names().includes('agent/request'))
  assert.equal(f.adapter.status().summariesStarted, 4); assert.equal(owner.session.requestHeader().config.model, 'chat')
  await f.adapter.dispose()
})

test('concurrent summaries capture independent selection and caller ctx', async () => {
  const f = fixture(); const engine = f.engines[0], owner = f.agents[0]; let finish
  const pause = new Promise(resolve => { finish = resolve }); f.select({ provider: 'chosen', model: 'summary' })
  const caller = Object.create(engine); caller.ctx = { source: 'calling-agent-scope' }
  const first = caller.summarize({ pause }, owner)
  f.select(null); const second = await engine.summarize({}, owner); finish(); const result = await first
  assert.equal(result.provider, 'chosen'); assert.equal(second.provider, 'main')
  assert.equal(result.ctx.source, 'calling-agent-scope'); assert.equal(engine.ctx.source, 'engine')
  assert.notEqual(result.receiver, engine); await f.adapter.dispose()
})

test('native options fallback works before first durable routed header', async () => {
  const f = fixture(); const owner = agent('new', f.engines[0], null)
  const result = await f.engines[0].summarize({}, owner)
  assert.equal(result.provider, 'options'); assert.equal(result.model, 'fallback'); await f.adapter.dispose()
})

test('shared instance reference counts survive one agent disposal', async () => {
  const engine = new BasicCompactionEngine(); const f = fixture([engine, engine]); f.select({ provider: 'chosen', model: 'summary' })
  assert.equal(f.adapter.status().activeEngines, 1); assert.equal(f.adapter.status().activeScopes, 2)
  const removed = f.agents.shift(); f.ctx.emit('agent/disposed', { agent: removed })
  assert.equal((await engine.compactNow(f.agents[0])).provider, 'chosen'); assert.equal(f.adapter.status().activeEngines, 1)
  await f.adapter.dispose(); assert.equal(Object.hasOwn(engine, 'summarize'), false)
})

test('new subagent and native engine reload get adapted and old hook restored', async () => {
  const f = fixture(); f.select({ provider: 'chosen', model: 'summary' })
  const child = agent('child', new BasicCompactionEngine()); f.agents.push(child); f.ctx.emit('agent/created', { agent: child })
  assert.equal((await child.ctx.get('compaction').compactNow(child)).provider, 'chosen')
  const old = child.ctx.services.compaction; const replacement = new BasicCompactionEngine(); child.ctx.services.compaction = replacement
  child.ctx.watches[0].reload()
  assert.equal(Object.hasOwn(old, 'summarize'), false); assert.equal((await replacement.compactNow(child)).provider, 'chosen')
  await f.adapter.dispose(); assert.equal(Object.hasOwn(replacement, 'summarize'), false)
})

test('validation is metadata-only and rejects unsupported active engines', async () => {
  const f = fixture(); assert.deepEqual(await f.adapter.validate({ provider: 'chosen', model: 'summary' }), { provider: 'chosen', model: 'summary' })
  await assert.rejects(f.adapter.validate({ provider: 'chosen', model: 'not-listed' }), { code: 'COMPACTION_MODEL_UNAVAILABLE' })
  await assert.rejects(f.adapter.validate({ provider: 'missing', model: 'summary' }), { code: 'COMPACTION_PROVIDER_UNAVAILABLE' })
  await assert.rejects(f.adapter.validate({ provider: '', model: 'summary' }), { code: 'INVALID_COMPACTION_MODEL' })
  class Custom extends BasicCompactionEngine { summarize() { return 'custom' } }
  f.agents.push(agent('custom', new Custom())); f.adapter.refresh()
  assert.equal(f.adapter.status().limitations.length, 1)
  await assert.rejects(f.adapter.validate({ provider: 'chosen', model: 'summary' }), { code: 'COMPACTION_UNSUPPORTED' })
  assert.equal(await f.adapter.validate(null), null); await f.adapter.dispose()
})

test('unsupported engine does not fail creation and never gets patched', async () => {
  const engine = { compactNow() {}, compactRegion() {}, compactIfNeeded() {}, summarize() {} }; const original = engine.summarize
  const f = fixture([engine]); assert.equal(f.adapter.status().available, false); assert.equal(engine.summarize, original)
  await f.adapter.dispose(); await assert.rejects(f.adapter.validate(null), { code: 'COMPACTION_ADAPTER_DISPOSED' })
})

test('restores exact own descriptor and does not clobber later method owner', async () => {
  const engine = new BasicCompactionEngine(); Object.defineProperty(engine, 'summarize', { value: BasicCompactionEngine.prototype.summarize, enumerable: true, configurable: true, writable: false })
  const descriptor = Object.getOwnPropertyDescriptor(engine, 'summarize'); const f = fixture([engine]); await f.adapter.dispose()
  assert.deepEqual(Object.getOwnPropertyDescriptor(engine, 'summarize'), descriptor)
  const g = fixture(); const later = () => 'later owner'; g.engines[0].summarize = later; await g.adapter.dispose(); assert.equal(g.engines[0].summarize, later)
})

test('Cordis original symbol deduplicates distinct traced wrappers of one engine', async () => {
  const engine = new BasicCompactionEngine(); const proxy = () => new Proxy(engine, { get(target, key, receiver) { return key === Symbol.for('cordis.original') ? target : Reflect.get(target, key, receiver) } })
  const f = fixture([proxy(), proxy()]); assert.equal(f.adapter.status().activeEngines, 1); await f.adapter.dispose(); assert.equal(Object.hasOwn(engine, 'summarize'), false)
})

test('Cordis method shadow proxies preserve caller context through native hook', async () => {
  const engine = new BasicCompactionEngine(); const f = fixture([engine]); f.select({ provider: 'chosen', model: 'summary' })
  const callerCtx = { source: 'traceable caller' }
  function withProp(target, prop, value) {
    const props = Object.defineProperty(Object.create(null), prop, { value, writable: false })
    return new Proxy(target, { get: (target, key, receiver) => key in props && key !== 'constructor' ? Reflect.get(props, key, receiver) : Reflect.get(target, key, receiver) })
  }
  const proxy = new Proxy(engine, { get(target, prop, receiver) {
    if (prop === Symbol.for('cordis.original')) return target
    if (prop === 'ctx') return callerCtx
    const value = Reflect.get(target, prop, receiver)
    if (typeof value !== 'function' || typeof prop === 'symbol') return value
    const shadow = withProp(receiver, 'ctx', callerCtx)
    return new Proxy(value, { apply: (fn, thisArg, args) => Reflect.apply(fn, thisArg === receiver ? shadow : thisArg, args) })
  } })
  const result = await proxy.compactNow(f.agents[0])
  assert.equal(result.provider, 'chosen'); assert.equal(result.ctx, callerCtx); assert.equal(engine.ctx.source, 'engine')
  await f.adapter.dispose()
})

test('preset-only serviceFor resolves existing main and child scopes with empty Agent.ctx', async () => {
  const engine = new BasicCompactionEngine(); const main = agent('preset-main', undefined); const child = agent('preset-child', undefined)
  const agents = [main, child]; const revisions = new Map([[main.ctx, engine], [child.ctx, engine]])
  let selection = { provider: 'chosen', model: 'summary' }; const calls = []
  const ctx = scope({ agents: { list: () => agents }, agentPresets: { serviceFor(owner, name) { calls.push([owner, name]); return revisions.get(owner.ctx) } }, llm: { listProviders: () => [{ id: 'chosen' }], listModels: async () => [{ id: 'summary' }] } })
  const adapter = createCompactionAdapter(ctx, () => selection)
  assert.equal(main.ctx.get('compaction'), undefined); assert.equal(child.ctx.get('compaction'), undefined)
  assert.equal(adapter.status().activeEngines, 1); assert.equal(adapter.status().activeScopes, 2); assert.equal(adapter.status().available, true)
  assert(adapter.status().scopes.filter(row => row.kind === 'agent').every(row => row.source === 'preset'))
  assert.equal((await engine.compactNow(main)).provider, 'chosen'); assert.equal((await engine.compactNow(child)).provider, 'chosen')
  assert.deepEqual(await adapter.validate(selection), selection); assert(calls.every(row => row[1] === 'compaction'))
  const next = new BasicCompactionEngine(); revisions.set(main.ctx, next); revisions.set(child.ctx, next); ctx.emit('agent-preset/selected', main.id)
  assert.equal(Object.hasOwn(engine, 'summarize'), false); assert.equal((await next.compactNow(main)).provider, 'chosen')
  selection = null; assert.equal((await next.compactNow(child)).provider, 'main')
  await adapter.dispose(); assert.equal(Object.hasOwn(next, 'summarize'), false)
})

test('preset resolver wins over Agent.ctx service and newly created preset child is covered', async () => {
  const preset = new BasicCompactionEngine(); const decoy = new BasicCompactionEngine(); const main = agent('main', decoy); const agents = [main]
  const ctx = scope({ agents: { list: () => agents }, agentPresets: { serviceFor: () => preset } })
  const adapter = createCompactionAdapter(ctx, () => ({ provider: 'chosen', model: 'summary' }))
  assert.equal(Object.hasOwn(decoy, 'summarize'), false); assert.equal((await preset.compactNow(main)).provider, 'chosen')
  const child = agent('new-preset-child', undefined); agents.push(child); ctx.emit('agent/created', { agent: child })
  assert.equal(adapter.status().activeScopes, 2); assert.equal((await preset.compactNow(child)).provider, 'chosen')
  agents.shift(); ctx.emit('agent/disposed', { agent: main }); assert.equal((await preset.compactNow(child)).provider, 'chosen')
  await adapter.dispose(); assert.equal(Object.hasOwn(preset, 'summarize'), false)
})

test('disposal removes plugin and agent-owned registrations, stays idempotent', async () => {
  const f = fixture(); await f.adapter.dispose(); await f.adapter.dispose()
  assert.equal(f.adapter.status().activeEngines, 0); assert.equal(f.adapter.status().disposed, true); assert.deepEqual(f.ctx.names(), [])
  assert(f.agents.every(row => row.ctx.watches.every(watch => watch.dead)))
  f.ctx.emit('agent/created', { agent: agent('late', new BasicCompactionEngine()) }); assert.equal(f.adapter.status().activeEngines, 0)
})
