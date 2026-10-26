import { createSettingsCore, MAX_INSTRUCTION_BYTES } from './core.js?v=1.0.3'
import { createCompactionAdapter } from './compaction.js?v=1.0.1'
import { createGlobalInstructionsAdapter } from './instructions.js?v=1.0.2'
import { createSettingsToolExecutor } from './permissions.js?v=1.0.3'

export const inject = ['webServer', 'llm', 'agents', 'agentPresets', 'systemPrompt', 'connection', 'sandboxPolicy']
const PREFIX = '/__user-agent-settings'
// JSON can encode one control byte as six bytes (\u0000). Core still
// validates the decoded UTF-8 text against the independent 128 KiB limit.
const MAX_BODY = MAX_INSTRUCTION_BYTES * 6 + 16 * 1024
async function readJson(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { code: 'TOO_LARGE' }); chunks.push(chunk) }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}
function respond(res, status, value) { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value)) }
export async function apply(ctx) {
  const core = createSettingsCore({ llm: ctx.llm })
  await core.load()
  let globalInstructions = null, instructionReadError = null
  async function refreshGlobalInstructions() {
    try {
      globalInstructions = await core.instructions({ runtime: true })
      instructionReadError = null
    } catch (error) {
      // Do not inject stale preferences or let optional fallback I/O gate every
      // main/child request. Native presets keep their own instruction loader.
      globalInstructions = null
      const diagnostic = { code: error.code ?? 'INSTRUCTION_READ_FAILED', message: String(error.message ?? error) }
      if (diagnostic.code !== instructionReadError?.code || diagnostic.message !== instructionReadError?.message) {
        try { ctx.logger?.warn?.('Global instructions refresh: ' + diagnostic.message) } catch {}
      }
      instructionReadError = diagnostic
    }
  }
  await refreshGlobalInstructions()
  const instructionAdapter = await createGlobalInstructionsAdapter(ctx, () => globalInstructions?.text.trim() ? `Global user instructions from ${globalInstructions.path}. Apply as user preferences; system, developer, direct user, project and role-specific instructions retain precedence.\n\n${globalInstructions.text}` : '')
  ctx.effect(() => () => instructionAdapter.dispose(), 'user-agent-settings: dispose global instructions fallback')
  ctx.on('agent/pre-step', async (_step, next) => { await refreshGlobalInstructions(); return next() })
  const adapter = createCompactionAdapter(ctx, core.getSelection)
  core.setAdapter(adapter)
  ctx.effect(() => () => adapter.dispose(), 'user-agent-settings: dispose compaction routing')
  async function operate(args = {}) {
    switch (args.action) {
      case 'read': {
        const presets = await ctx.get('agentPresets')?.compositionInventory?.() ?? []
        const instructionLoaders = presets.map(preset => ({ id: preset.id, name: preset.name ?? preset.id, default: preset.isDefault, nativeGlobalFile: preset.rows.some(row => row.enabled === true && row.moduleName === '@deepseek-ai/dsh-agent-instructions') }))
        await refreshGlobalInstructions()
        const snapshot = await core.snapshot()
        return { ok: true, ...snapshot, instructionLoaders, globalInstructionStatus: { ...instructionAdapter.status(), instructionReadError }, desktopNavigationStatus: ctx.get('desktopNavigationStatus')?.read?.() ?? null, clientAssets: ctx.get('clientModules')?.graph().entries.filter(entry => ['@local/user-agent-settings', '@local/desktop-enhancements'].includes(entry.id)) ?? [] }
      }
      case 'models': return { ok: true, providers: await core.models() }
      case 'save_instructions': {
        const instructions = await core.saveInstructions(args)
        await refreshGlobalInstructions()
        return { ok: true, instructions }
      }
      case 'save_compaction': return { ok: true, ...(await core.saveCompaction(args)) }
      default: throw Object.assign(new Error('Unknown action'), { code: 'BAD_ACTION' })
    }
  }
  ctx.effect(() => ctx.provide('userAgentSettings', { operate }), 'user-agent-settings: shared operations')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: PREFIX + '/operation',
    async handler(req, res) {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) return respond(res, rejection, { ok: false, code: 'FORBIDDEN', error: 'DSH authentication required' })
      if (String(req.headers['x-user-agent-settings'] ?? '') !== '1') return respond(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Missing settings request header' })
      const origin = req.headers.origin
      if (origin && origin !== ctx.webServer.getOrigin()) return respond(res, 403, { ok: false, code: 'FORBIDDEN', error: 'Cross-origin settings requests are not allowed' })
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'POST only' })
      try { respond(res, 200, await operate(await readJson(req))) }
      catch (error) { respond(res, error.code === 'CONFLICT' ? 409 : 400, { ok: false, code: error.code ?? 'SETTINGS_FAILED', error: error.message }) }
    },
  }), 'user-agent-settings: authenticated settings route')
  ctx.effect(() => ctx.get('tools')?.register({
    name: 'user_agent_settings', deferLoading: true,
    description: 'Read or edit the native global AGENTS instructions and choose the model used only for context compression across main agents and subagents. Saves require the revision returned by read and danger-full-access permission or native approval for this call; they affect other sessions. Browser refresh is user-only.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['read', 'models', 'save_instructions', 'save_compaction'] },
      revision: { type: 'string', description: 'For instruction saves use instructions.revision; for compression saves use the top-level revision from read.' },
      text: { type: 'string', description: 'Complete global AGENTS.md contents for save_instructions, up to 128 KiB UTF-8.' },
      compaction: { description: 'For save_compaction: null follows each conversation model; otherwise provide its registered provider and model.', oneOf: [{ type: 'null' }, { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'model'], additionalProperties: false }] },
    }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: createSettingsToolExecutor(ctx, operate),
  }), 'user-agent-settings: agent settings operations')
}
