const SAVE_ACTIONS = new Set(['save_instructions', 'save_compaction'])
const loadNativeSandbox = () => import('@deepseek-ai/dsh-sandbox')

// UI saves are authenticated user actions. Model saves must additionally honor
// the actual caller's session (including delegated child policy), like the
// native plugin_manager tool; never reuse the UI's trusted write path directly.
export function createSettingsToolExecutor(ctx, operate, loadSandbox = loadNativeSandbox) {
  return async (args, exec) => {
    if (SAVE_ACTIONS.has(args?.action)) {
      if (!exec?.signal || !ctx.sandboxPolicy?.resolve) {
        throw Object.assign(new Error('Global settings saves require a caller execution context and sandbox policy.'), { code: 'PERMISSION_DENIED' })
      }
      exec.signal.throwIfAborted()
      const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(policy?.mode)) {
        throw Object.assign(new Error('Cannot determine the caller permission mode.'), { code: 'PERMISSION_DENIED' })
      }
      if (policy.mode !== 'danger-full-access') {
        // A missing native helper/approver or a denied/cancelled approval must
        // reject the save. Import lazily so read-only discovery needs no helper.
        const { approveEscalation } = await loadSandbox()
        await approveEscalation({
          requestedMode: 'danger-full-access', effectiveMode: policy.mode,
          subject: 'global Agent settings save',
          justification: `user_agent_settings ${args.action}. This writes global DSH settings outside the workspace and affects other sessions.`,
        }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: 'user_agent_settings', signal: exec.signal })
      }
      exec.signal.throwIfAborted()
    }
    return JSON.parse(JSON.stringify(await operate(args)))
  }
}
