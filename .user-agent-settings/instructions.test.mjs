import assert from 'node:assert/strict'
import test from 'node:test'
import { createGlobalInstructionsAdapter } from '../user-agent-settings/instructions.js'

const NATIVE = '@deepseek-ai/dsh-agent-instructions'
function fixture() {
  let content = 'Global instructions: preserve $variables literally.'
  let roster = [{ id: 'standard', rows: [{ moduleName: NATIVE, enabled: true }] }, { id: 'minimal', rows: [] }]
  const keys = new Map([['standard', {}], ['minimal', {}]])
  const released = [], leases = [], registrations = [], hooks = new Map()
  let barrier = null, inventories = 0
  const presetOf = new WeakMap()
  const presets = {
    async compositionInventory() { inventories++; if (barrier) await barrier; return roster },
    async acquireScope(id) { const lease = { key: keys.get(id), async [Symbol.asyncDispose]() { released.push(lease) } }; leases.push(lease); return lease },
    composedPreset(agentCtx) { return presetOf.get(agentCtx) },
  }
  const ctx = {
    logger: { warn() {} },
    get(name) { return name === 'agentPresets' ? presets : name === 'systemPrompt' ? { context(row) { const active = { ...row, removed: false }; registrations.push(active); return () => { active.removed = true } } } : undefined },
    on(name, fn) { const rows = hooks.get(name) ?? []; rows.push(fn); hooks.set(name, rows); return () => { rows.splice(rows.indexOf(fn), 1) } },
  }
  function agent(id) { const value = { ctx: {} }; presetOf.set(value.ctx, id); return value }
  async function emit(name, payload) { for (const fn of [...hooks.get(name) ?? []]) await fn(payload) }
  async function step(owner, next = () => ({ kind: 'continue', messages: [], startsRequestSeries: true })) { let thunk = next; for (const fn of [...hooks.get('agent/pre-step') ?? []].reverse()) { const inner = thunk; thunk = () => fn({ agent: owner }, inner) }; return thunk() }
  return {
    ctx, presets, keys, released, leases, registrations, hooks, agent, emit, step,
    getText: () => content, setText: next => { content = next }, setRoster: next => { roster = next },
    setBarrier: value => { barrier = value }, inventories: () => inventories,
  }
}

test('minimal main and child receive one dynamic global context; native default stays empty', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText)
  const context = f.registrations[0]; const main = f.agent('minimal'), child = f.agent('minimal'), native = f.agent('standard')
  assert.equal(context.text({ scope: main }), f.getText()); assert.equal(context.text({ scope: child }), f.getText())
  assert.equal(context.text({ scope: native }), ''); assert.equal(context.text({ scope: f.keys.get('minimal') }), f.getText())
  assert.equal(context.text({ scope: f.keys.get('standard') }), ''); assert.equal(context.text({ scope: {} }), '')
  assert.equal(f.leases.length, 1); assert.equal(adapter.status().presets.find(row => row.id === 'minimal').fallback, true)
  await adapter.dispose()
})

test('unscoped assemblies use current cache; empty instructions emit nothing', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); const context = f.registrations[0]
  assert.equal(context.text({}), f.getText()); f.setText('New global text'); assert.equal(context.text(), 'New global text')
  f.setText('  \n'); assert.equal(context.text({}), ''); assert.equal(context.text({ scope: f.agent('minimal') }), '')
  await adapter.dispose()
})

test('required non-interpolated context survives complete prompt and suppression', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); const row = f.registrations[0]
  assert.equal(row.required, true); assert.equal(row.interpolate, false)
  // Native assembly keeps contexts independently from its effective complete
  // section; suppression filters only contexts where required !== true.
  const complete = { sections: [{ name: 'complete', text: 'custom complete', complete: true }], contexts: f.registrations.filter(item => item.required).map(item => ({ name: item.name, text: item.text({ scope: f.agent('minimal') }), interpolate: item.interpolate })) }
  assert.equal(complete.contexts.length, 1); assert.equal(complete.contexts[0].text, f.getText()); assert.equal(complete.sections[0].text, 'custom complete')
  await adapter.dispose()
})

test('new preset creation awaits fresh scope lease before first step', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); const key = {}; f.keys.set('fresh', key)
  f.setRoster([{ id: 'standard', rows: [{ moduleName: NATIVE, enabled: true }] }, { id: 'minimal', rows: [] }, { id: 'fresh', rows: [] }])
  let finish; f.setBarrier(new Promise(resolve => { finish = resolve })); const owner = f.agent('fresh'); let created = false, admitted = false
  const creating = f.emit('agent/created', { agent: owner }).then(() => { created = true })
  const stepping = f.step(owner, () => { admitted = true; return { kind: 'continue', messages: [], startsRequestSeries: true } })
  await Promise.resolve(); assert.equal(created, false); assert.equal(admitted, false)
  finish(); await creating; const decision = await stepping
  assert.equal(admitted, true); assert.equal(decision.startsRequestSeries, true)
  assert.equal(f.registrations[0].text({ scope: owner }), f.getText()); assert.equal(f.registrations[0].text({ scope: key }), f.getText())
  await adapter.dispose()
})

test('configuration reload refreshes native coverage and releases replaced leases', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); const old = f.leases[0]
  f.setRoster([{ id: 'standard', rows: [{ moduleName: NATIVE, enabled: true }] }, { id: 'minimal', rows: [{ moduleName: NATIVE, enabled: true }] }])
  await f.emit('app-boot/config-reload'); await f.step(f.agent('minimal'))
  assert.equal(f.registrations[0].text({ scope: f.agent('minimal') }), ''); assert(f.released.includes(old)); assert.equal(adapter.status().presets.every(row => row.nativeGlobalFile), true)
  await adapter.dispose()
})

test('disabled native row uses fallback; conditional row reports uncertainty without duplication', async () => {
  const f = fixture(); f.keys.set('conditional', {})
  f.setRoster([{ id: 'minimal', rows: [{ moduleName: NATIVE, enabled: false }] }, { id: 'conditional', rows: [{ moduleName: NATIVE, enabled: 'conditional' }] }])
  const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText)
  assert.equal(f.registrations[0].text({ scope: f.agent('minimal') }), f.getText()); assert.equal(f.registrations[0].text({ scope: f.agent('conditional') }), '')
  assert.equal(adapter.status().limitations.length, 1); assert.equal(adapter.status().limitations[0].id, 'conditional')
  await adapter.dispose()
})

test('unknown preset at admission refreshes before forwarding original waterfall decision', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); f.keys.set('new', {}); f.setRoster([{ id: 'new', rows: [] }])
  const owner = f.agent('new'); const decision = { kind: 'continue', messages: ['untouched'], startsRequestSeries: true, extra: 4 }
  assert.equal(await f.step(owner, () => decision), decision); assert.equal(f.registrations[0].text({ scope: owner }), f.getText())
  await adapter.dispose()
})

test('lease acquisition failure cleans staging and preserves prior accepted mapping', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); const original = f.presets.acquireScope
  f.setRoster([{ id: 'minimal', rows: [] }, { id: 'broken', rows: [] }]); f.presets.acquireScope = async id => { if (id === 'broken') throw Error('fixture acquire failure'); return original(id) }
  await assert.rejects(adapter.refresh(), /fixture acquire failure/)
  assert.equal(adapter.status().generation, 1); assert.match(adapter.status().error, /fixture acquire failure/)
  assert.equal(f.registrations[0].text({ scope: f.agent('minimal') }), f.getText()); assert.equal(f.released.length, 1)
  await adapter.dispose(); assert.equal(f.released.length, f.leases.length)
})

test('disposal removes all registrations, waits in-flight refresh and releases every lease exactly once', async () => {
  const f = fixture(); const adapter = await createGlobalInstructionsAdapter(f.ctx, f.getText); let finish
  f.setBarrier(new Promise(resolve => { finish = resolve })); const rebuilding = adapter.refresh(); const disposing = adapter.dispose(); finish(); await rebuilding; await disposing; await adapter.dispose()
  assert.equal(adapter.status().disposed, true); assert.equal(adapter.status().available, false); assert(f.registrations.every(row => row.removed))
  assert([...f.hooks.values()].every(rows => rows.length === 0)); assert.equal(new Set(f.released).size, f.leases.length); assert.equal(f.released.length, f.leases.length)
  assert.equal(f.registrations[0].text({ scope: f.agent('minimal') }), '')
})
