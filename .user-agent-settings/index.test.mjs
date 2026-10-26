import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../user-agent-settings/index.js'
import { MAX_INSTRUCTION_BYTES, MAX_RUNTIME_INSTRUCTION_BYTES } from '../user-agent-settings/core.js'

async function fixture(t, { text, directory = false } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-settings-regression-'))
  const instructionPath = path.join(home, 'AGENTS.md')
  const cleanups = [], hooks = new Map(), contexts = [], warnings = [], services = new Map()
  let route, tool
  const key = {}
  const ctx = {
    logger: { warn(message) { warnings.push(message) } },
    llm: { listProviders: () => [], listModels: async () => [] },
    agents: { list: () => [] },
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
    agentPresets: {
      compositionInventory: async () => [{ id: 'minimal', rows: [] }],
      acquireScope: async () => ({ key, dispose() {} }),
      composedPreset: () => 'minimal',
    },
    systemPrompt: { context(row) { contexts.push(row); return () => {} } },
    connection: { requestRejection: () => undefined },
    webServer: { getOrigin: () => 'http://localhost', register(value) { route = value; return () => {} } },
    tools: { register(value) { tool = value; return () => {} } },
    get(name) { return services.get(name) ?? this[name] },
    provide(name, value) { services.set(name, value); return () => services.delete(name) },
    effect(factory) { const cleanup = factory(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    on(name, fn, options) {
      const rows = hooks.get(name) ?? []; options?.prepend ? rows.unshift(fn) : rows.push(fn); hooks.set(name, rows)
      return () => rows.splice(rows.indexOf(fn), 1)
    },
  }
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await fs.rm(home, { recursive: true, force: true })
  })
  if (directory) await fs.mkdir(instructionPath)
  else if (text !== undefined) await fs.writeFile(instructionPath, text)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try { await apply(ctx) }
  finally { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome }
  const operate = args => services.get('userAgentSettings').operate(args)
  return {
    home, instructionPath, ctx, warnings, contexts, operate, tool: () => tool,
    contextText: () => contexts[0].text({ scope: key }),
    async step(next = () => 'continued') {
      let run = next
      for (const hook of [...hooks.get('agent/pre-step') ?? []].reverse()) { const inner = run; run = () => hook({ agent: { ctx: {} } }, inner) }
      return run()
    },
    async request(payload) {
      const encoded = typeof payload === 'string' ? payload : JSON.stringify(payload)
      const req = Readable.from([Buffer.from(encoded)])
      req.method = 'POST'; req.headers = { 'x-user-agent-settings': '1', origin: 'http://localhost' }
      const res = { statusCode: 0, setHeader() {}, end(text) { this.body = JSON.parse(text) } }
      await route.handler(req, res)
      return res
    },
  }
}

test('runtime accepts native-size instructions while editor still enforces 128 KiB', async t => {
  const text = 'a'.repeat(MAX_INSTRUCTION_BYTES + 1)
  const f = await fixture(t, { text })
  assert(f.contextText().endsWith(text))
  assert.equal(await f.step(), 'continued')
  assert.equal(f.warnings.length, 0)
  await assert.rejects(f.operate({ action: 'read' }), { code: 'TOO_LARGE' })
  assert(f.contextText().endsWith(text))
})

test('exact 1 MiB native runtime boundary loads and deleted instructions clear fallback', async t => {
  const text = 'a'.repeat(MAX_RUNTIME_INSTRUCTION_BYTES)
  const f = await fixture(t, { text })
  assert(f.contextText().endsWith(text))
  assert.equal(f.warnings.length, 0)
  await fs.unlink(f.instructionPath)
  assert.equal(await f.step(), 'continued')
  assert.equal(f.contextText(), '')
  assert.equal(f.warnings.length, 0)
})

test('invalid startup file does not prevent loading or agent steps and logs failure once', async t => {
  const f = await fixture(t, { directory: true })
  assert.equal(f.contextText(), '')
  assert.equal(f.warnings.length, 1)
  const decision = { kind: 'continue', messages: ['unchanged'] }
  assert.equal(await f.step(() => decision), decision)
  assert.equal(f.warnings.length, 1)
  await fs.rmdir(f.instructionPath)
  await fs.writeFile(f.instructionPath, 'recovered instructions')
  assert.equal(await f.step(), 'continued')
  assert(f.contextText().endsWith('recovered instructions'))
  const state = await f.operate({ action: 'read' })
  assert.equal(state.globalInstructionStatus.instructionReadError, null)
})

test('runtime refresh failure clears stale fallback without blocking main or child steps', async t => {
  const f = await fixture(t, { text: 'old preferences' })
  assert(f.contextText().endsWith('old preferences'))
  await fs.writeFile(f.instructionPath, 'a'.repeat(MAX_RUNTIME_INSTRUCTION_BYTES + 1))
  for (const decision of [{ agent: 'main' }, { agent: 'child' }]) assert.equal(await f.step(() => decision), decision)
  assert.equal(f.contextText(), '')
  assert.equal(f.warnings.length, 1)
  await fs.writeFile(f.instructionPath, 'new preferences')
  assert.equal(await f.step(), 'continued')
  assert(f.contextText().endsWith('new preferences'))
})

test('runtime follows native-compatible instruction symlinks but editor refuses to replace them', async t => {
  const f = await fixture(t)
  const target = path.join(f.home, 'linked-instructions.md')
  await fs.writeFile(target, 'linked preferences')
  try { await fs.symlink(target, f.instructionPath, 'file') }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('File symlinks unavailable: ' + error.code); return }; throw error }
  assert.equal(await f.step(), 'continued')
  assert(f.contextText().endsWith('linked preferences'))
  await assert.rejects(f.operate({ action: 'read' }), { code: 'INVALID_FILE' })
  assert.equal(await fs.readFile(target, 'utf8'), 'linked preferences')
})

for (const [name, text] of [
  ['quotes', '"'.repeat(MAX_INSTRUCTION_BYTES)],
  ['backslashes', '\\'.repeat(MAX_INSTRUCTION_BYTES)],
  ['newlines', '\n'.repeat(MAX_INSTRUCTION_BYTES)],
  ['control bytes', '\u0000'.repeat(MAX_INSTRUCTION_BYTES)],
  ['UTF-8', '字'.repeat(Math.floor(MAX_INSTRUCTION_BYTES / 3)) + 'aa'],
]) test('HTTP accepts maximum decoded instruction bytes with JSON-escaped ' + name, async t => {
  const f = await fixture(t)
  const state = await f.operate({ action: 'read' })
  assert.equal(Buffer.byteLength(text), MAX_INSTRUCTION_BYTES)
  const response = await f.request({ action: 'save_instructions', revision: state.instructions.revision, text })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.instructions.text, text)
  assert.equal(await fs.readFile(f.instructionPath, 'utf8'), text)
})

test('registered model tool checks caller policy before saving isolated settings', async t => {
  const f = await fixture(t)
  const state = await f.tool().execute({ action: 'read' })
  const agent = { session: { id: 'restricted-child' } }
  const exec = { agent, callId: 'fixture-save', signal: new AbortController().signal }
  const seen = []
  f.ctx.sandboxPolicy.resolve = input => { seen.push(input); return { mode: 'unknown' } }
  await assert.rejects(f.tool().execute({ action: 'save_instructions', revision: state.instructions.revision, text: 'denied' }, exec), { code: 'PERMISSION_DENIED' })
  await assert.rejects(f.tool().execute({ action: 'save_compaction', revision: state.revision, compaction: null }, exec), { code: 'PERMISSION_DENIED' })
  await assert.rejects(fs.stat(f.instructionPath), { code: 'ENOENT' })
  await assert.rejects(fs.stat(path.join(f.home, 'plugin-data', 'user-agent-settings', 'settings.json')), { code: 'ENOENT' })
  assert(seen.every(input => input.session === agent.session))
  f.ctx.sandboxPolicy.resolve = () => ({ mode: 'danger-full-access' })
  assert.equal((await f.tool().execute({ action: 'save_instructions', revision: state.instructions.revision, text: 'allowed' }, exec)).ok, true)
  assert.equal(await fs.readFile(f.instructionPath, 'utf8'), 'allowed')
  assert.equal((await f.tool().execute({ action: 'save_compaction', revision: state.revision, compaction: null }, exec)).ok, true)
})

test('decoded editor limit and bounded transport size are both enforced without writes', async t => {
  const f = await fixture(t)
  const state = await f.operate({ action: 'read' })
  const rejected = await f.request({ action: 'save_instructions', revision: state.instructions.revision, text: 'a'.repeat(MAX_INSTRUCTION_BYTES + 1) })
  assert.equal(rejected.statusCode, 400); assert.equal(rejected.body.code, 'TOO_LARGE')
  const oversized = await f.request(' '.repeat(MAX_INSTRUCTION_BYTES * 6 + 16 * 1024 + 1))
  assert.equal(oversized.statusCode, 400); assert.equal(oversized.body.code, 'TOO_LARGE')
  await assert.rejects(fs.stat(f.instructionPath), { code: 'ENOENT' })
})
