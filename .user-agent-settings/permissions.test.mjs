import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsToolExecutor } from '../user-agent-settings/permissions.js'

function fixture({ mode = 'read-only', approval, approve, resolveError } = {}) {
  const resolutions = [], escalations = [], operations = []
  let imports = 0
  const ctx = {
    sandboxPolicy: { resolve(input) { resolutions.push(input); if (resolveError) throw resolveError; return { mode } } },
    get(name) { assert.equal(name, 'approval'); return approval },
  }
  const loadSandbox = async () => {
    imports++
    return { async approveEscalation(request, execution) {
      escalations.push({ request, execution })
      if (approve) return approve(request, execution)
      throw new Error('fixture: no approval channel')
    } }
  }
  const execute = createSettingsToolExecutor(ctx, async args => { operations.push(args); return { ok: true, args } }, loadSandbox)
  const controller = new AbortController()
  const agent = { session: { id: 'child-session', parentSessionId: 'parent-session' } }
  const exec = { agent, callId: 'test-call', signal: controller.signal }
  return { ctx, execute, exec, controller, resolutions, escalations, operations, imports: () => imports }
}

for (const action of ['read', 'models']) test(action + ' does not need write policy, approval, or execution context', async () => {
  const f = fixture()
  assert.equal((await f.execute({ action })).ok, true)
  assert.equal(f.resolutions.length, 0); assert.equal(f.imports(), 0); assert.equal(f.operations.length, 1)
})

for (const action of ['save_instructions', 'save_compaction']) {
  for (const mode of ['read-only', 'workspace-write']) test(action + ' refuses ' + mode + ' before shared operation when approval unavailable', async () => {
    const f = fixture({ mode })
    await assert.rejects(f.execute({ action }, f.exec), /no approval channel/)
    assert.deepEqual(f.resolutions, [{ session: f.exec.agent.session }])
    assert.equal(f.escalations.length, 1); assert.equal(f.operations.length, 0)
    const { request, execution } = f.escalations[0]
    assert.equal(request.requestedMode, 'danger-full-access'); assert.equal(request.effectiveMode, mode)
    assert.match(request.justification, new RegExp(action)); assert.match(request.justification, /other sessions/)
    assert.equal(execution.agent, f.exec.agent); assert.equal(execution.signal, f.exec.signal)
    assert.equal(execution.toolName, 'user_agent_settings'); assert.equal(execution.callId, f.exec.callId)
  })

  test(action + ' accepts effective full access without importing a helper or prompting', async () => {
    const f = fixture({ mode: 'danger-full-access' })
    assert.equal((await f.execute({ action }, f.exec)).ok, true)
    assert.equal(f.operations.length, 1); assert.equal(f.imports(), 0)
    assert.deepEqual(f.resolutions, [{ session: f.exec.agent.session }])
  })

  test(action + ' requires a caller context even when host has full access', async () => {
    const f = fixture({ mode: 'danger-full-access' })
    await assert.rejects(f.execute({ action }), { code: 'PERMISSION_DENIED' })
    assert.equal(f.operations.length, 0); assert.equal(f.resolutions.length, 0)
  })
}

for (const outcome of ['rejected', 'cancelled', 'unavailable']) test('native approval failure propagates unchanged: ' + outcome, async () => {
  const failure = new Error('fixture approval ' + outcome)
  const f = fixture({ approval: {}, approve: async () => { throw failure } })
  await assert.rejects(f.execute({ action: 'save_instructions' }, f.exec), error => error === failure)
  assert.equal(f.operations.length, 0)
})

test('one-shot native approval permits only this call and preserves actual child context', async () => {
  let granted = true
  const approval = { name: 'fixture approval' }
  const f = fixture({ approval, approve: async (_request, execution) => {
    assert.equal(execution.approver, approval)
    if (granted) { granted = false; return 'danger-full-access' }
    throw new Error('next call rejected')
  } })
  assert.equal((await f.execute({ action: 'save_compaction' }, f.exec)).ok, true)
  await assert.rejects(f.execute({ action: 'save_compaction' }, f.exec), /next call rejected/)
  assert.equal(f.operations.length, 1); assert.equal(f.escalations.length, 2)
  assert.equal(f.exec.agent.session.parentSessionId, 'parent-session')
})

test('abort before or during authorization never enters global write operation', async () => {
  const before = fixture({ mode: 'danger-full-access' }); before.controller.abort()
  await assert.rejects(before.execute({ action: 'save_instructions' }, before.exec), { name: 'AbortError' })
  assert.equal(before.operations.length, 0); assert.equal(before.resolutions.length, 0)
  const during = fixture({ approve: async () => { during.controller.abort(); return 'danger-full-access' } })
  await assert.rejects(during.execute({ action: 'save_compaction' }, during.exec), { name: 'AbortError' })
  assert.equal(during.operations.length, 0)
})

test('missing or failing policy never falls back to process privileges', async () => {
  const f = fixture(); delete f.ctx.sandboxPolicy
  await assert.rejects(f.execute({ action: 'save_instructions' }, f.exec), { code: 'PERMISSION_DENIED' })
  const broken = fixture({ resolveError: new Error('policy unavailable') })
  await assert.rejects(broken.execute({ action: 'save_compaction' }, broken.exec), /policy unavailable/)
  const unknown = fixture({ mode: 'unknown' })
  await assert.rejects(unknown.execute({ action: 'save_instructions' }, unknown.exec), { code: 'PERMISSION_DENIED' })
  for (const current of [f, broken, unknown]) assert.equal(current.operations.length, 0)
})

test('unavailable native sandbox module fails closed', async () => {
  let writes = 0
  const execute = createSettingsToolExecutor({ sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) } }, async () => { writes++ }, async () => { throw Error('native helper unavailable') })
  await assert.rejects(execute({ action: 'save_instructions' }, { signal: new AbortController().signal }), /native helper unavailable/)
  assert.equal(writes, 0)
})

test('host calls without an Agent resolve explicit host policy, not a fabricated session', async () => {
  const f = fixture({ mode: 'danger-full-access' }); delete f.exec.agent
  assert.equal((await f.execute({ action: 'save_compaction' }, f.exec)).ok, true)
  assert.deepEqual(f.resolutions, [{}])
})
