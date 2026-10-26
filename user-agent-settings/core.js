import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

export const MAX_INSTRUCTION_BYTES = 128 * 1024
// Match the native instruction loader without relaxing editor/write protections.
export const MAX_RUNTIME_INSTRUCTION_BYTES = 1024 * 1024
export const digest = text => createHash('sha256').update(text).digest('hex')
export const fault = (code, message) => Object.assign(new Error(message), { code })
export function homePath(env = process.env) {
  const value = env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
  return path.resolve(value === '~' ? os.homedir() : /^[~][\\/]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value)
}
async function readText(file, optional = false, { runtime = false } = {}) {
  const limit = runtime ? MAX_RUNTIME_INSTRUCTION_BYTES : MAX_INSTRUCTION_BYTES
  try {
    const stat = runtime ? await fs.stat(file) : await fs.lstat(file)
    if (!stat.isFile() || (!runtime && stat.isSymbolicLink())) throw fault('INVALID_FILE', 'The settings target must be a regular file' + (runtime ? '' : ', not a symbolic link'))
    const tooLarge = () => fault('TOO_LARGE', runtime ? 'File exceeds the 1 MiB runtime instruction limit' : 'File exceeds the 128 KiB editor limit')
    if (stat.size > limit) throw tooLarge()
    const content = await fs.readFile(file)
    if (content.length > limit) throw tooLarge()
    return { exists: true, text: content.toString('utf8') }
  } catch (error) { if (optional && error.code === 'ENOENT') return { exists: false, text: '' }; throw error }
}
async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = file + '.' + randomUUID() + '.tmp'
  try { await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file) }
  finally { await fs.rm(temporary, { force: true }) }
}
export function createSettingsCore({ home = homePath(), llm, adapter } = {}) {
  const instructionFile = path.join(home, 'AGENTS.md')
  const selectionFile = path.join(home, 'plugin-data', 'user-agent-settings', 'settings.json')
  let selection = null, selectionRevision = digest('missing'), tail = Promise.resolve()
  const serial = operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next }
  async function load() {
    const saved = await readText(selectionFile, true)
    if (saved.exists) { const parsed = JSON.parse(saved.text); selection = normalizeSelection(parsed.compaction); selectionRevision = digest(saved.text) }
    else { selection = null; selectionRevision = digest('missing') }
    return selection
  }
  function normalizeSelection(value) {
    if (value === null || value === undefined) return null
    if (!value || typeof value !== 'object' || typeof value.provider !== 'string' || typeof value.model !== 'string' || !value.provider.trim() || !value.model.trim() || value.provider.length > 256 || value.model.length > 512) throw fault('BAD_SELECTION', 'Choose a provider and model, or follow the conversation model')
    return { provider: value.provider.trim(), model: value.model.trim() }
  }
  async function instructions({ runtime = false } = {}) {
    const content = await readText(instructionFile, true, { runtime })
    return { path: instructionFile, ...content, revision: digest((content.exists ? 'present:' : 'missing:') + content.text), maxBytes: runtime ? MAX_RUNTIME_INSTRUCTION_BYTES : MAX_INSTRUCTION_BYTES }
  }
  async function saveInstructions({ text, revision }) {
    return serial(async () => {
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_INSTRUCTION_BYTES) throw fault('TOO_LARGE', 'Instruction text must be UTF-8 text up to 128 KiB')
      const current = await instructions()
      if (typeof revision !== 'string' || revision !== current.revision) throw fault('CONFLICT', 'Global instructions changed elsewhere. Reload before saving')
      if (current.exists && current.text === text) return current
      await atomicWrite(instructionFile, text)
      return instructions()
    })
  }
  async function saveCompaction({ compaction, revision }) {
    return serial(async () => {
      const current = await readText(selectionFile, true)
      const actualRevision = current.exists ? digest(current.text) : digest('missing')
      if (revision !== actualRevision) throw fault('CONFLICT', 'Compression settings changed elsewhere. Reload before saving')
      const next = normalizeSelection(compaction)
      await adapter?.validate(next)
      if (next && !adapter) await llm.resolveModelInfo(next.provider, next.model)
      const text = JSON.stringify({ version: 1, compaction: next }, null, 2) + '\n'
      await atomicWrite(selectionFile, text)
      selection = next; selectionRevision = digest(text)
      adapter?.refresh?.()
      return { compaction: selection, revision: selectionRevision, status: adapter?.status?.() ?? null }
    })
  }
  async function models() {
    const providers = llm.listProviders()
    const entries = await Promise.all(providers.map(async provider => {
      try { return { ...provider, models: (await llm.listModels(provider.id)).map(model => ({ id: model.id, name: model.name })) } }
      catch (error) { return { ...provider, models: [], error: error.message } }
    }))
    return entries
  }
  return { load, instructions, saveInstructions, saveCompaction, models, getSelection: () => selection, setAdapter: value => { adapter = value }, snapshot: () => serial(async () => { await load(); return { instructions: await instructions(), compaction: selection, revision: selectionRevision, status: adapter?.status?.() ?? null } }) }
}
