// Disposable test fixture. Only the backed-up pilot can be operated on.
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const ID = 'session-7ff31c6b-7ccd-41bf-80d4-9898709ce6cd'
const RAW = Symbol.for('cordis.original')
const raw = v => v?.[RAW] ?? v
const digest = events => createHash('sha256').update(JSON.stringify(events)).digest('hex')
export function installVerification(ctx) {
  let clientWanted = false
  const clientReports = {}
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/__session-mover/verify-client', handler: async (req, res) => {
    if (req.headers['x-session-mover'] !== '1') { res.statusCode=403; res.end(); return }
    if (req.method === 'POST') { const chunks=[]; for await (const c of req) chunks.push(c); const report=JSON.parse(Buffer.concat(chunks).toString()); clientReports[report.clientId]=report }
    res.setHeader('content-type','application/json'); res.end(JSON.stringify({ ok:true, wanted:clientWanted, reports:clientReports }))
  } }), 'session-mover: disposable connected-client verification')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/__session-mover/verify',
    handler: async (req, res) => {
      const reply = (status, value) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
      if (req.headers['x-session-mover'] !== '1') return reply(403, { ok: false })
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (body.sessionId !== ID) throw Error('Only the pilot is accepted')
        if (body.action === 'clientStart') clientWanted = true
        if (body.action === 'clientStop') clientWanted = false
        const agents = ctx.get('agents'), controller = ctx.get('sessionController')
        const others = agents.list().filter(a => a.id !== ID)
        if (body.action === 'resume' || body.action === 'seed') {
          const found = await controller.resolveAgent(ID)
          if (found.error) throw Error(found.error.message)
          if (body.action === 'seed') {
            const { createUserMessage, createDeveloperMessage } = await import(pathToFileURL('D:/SoftWare/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js').href)
            found.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Session mover history preservation fixture' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
            found.agent.inject(createUserMessage({ content: [{ type: 'text', text: 'Session mover pending input fixture; do not execute' }], source: { kind: 'user' } }))
          }
        }
        let result
        const target = ctx.get('workspaceRegistry').get('a379ab96-88e1-4086-b235-9d8ea03ad662')
        if (body.action === 'toolMove') {
          const execution = await ctx.get('tools').execute({ callId: randomUUID(), name: 'session_move', arguments: { action: 'move', sessionId: ID, workspaceId: body.workspaceId }, signal: new AbortController().signal })
          if (execution.isError) throw Error(JSON.stringify(execution.error))
          result = execution.value
        }
        if (body.action === 'failAttach') {
          const concrete = raw(target), original = concrete.attachSession
          concrete.attachSession = async function (id) { if (id === ID) throw Error('controlled attach failure'); return original.call(this, id) }
          try { result = await ctx.get('sessionMover').move({ sessionId: ID, workspaceId: target.id }) }
          finally { delete concrete.attachSession }
        }
        if (body.action === 'busyMove') {
          const agent = raw(agents.get(ID)); let release
          const waiting = new Promise(resolve => { release = resolve })
          const maintenance = agent.runMaintenance(() => waiting)
          try { result = await ctx.get('sessionMover').move({ sessionId: ID, workspaceId: target.id }) }
          finally { release(); await maintenance }
        }
        if (body.action === 'dispose') {
          const agent = raw(agents.get(ID))
          if (agent) {
            if (agent.phase.kind !== 'idle') throw Error('Pilot is not idle')
            const fibers = new Set([ctx.root.fiber]); for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) fibers.add(fiber)
            const matches = [...fibers].flatMap(f => [...f._disposables]).filter(fn => fn[Symbol.for('cordis.effect')]?.label === `agentLoop.lifecycle(${ID})`)
            if (matches.length !== 1) throw Error('Expected one lifecycle effect')
            await matches[0]()
          }
        }
        const snapshot = await controller.inspect(ID)
        const agent = raw(agents.get(ID))
        reply(200, { ok: true, result, state: { live: Boolean(agent), session: Boolean(ctx.get('sessions').get(ID)), cwd: snapshot.meta.cwd, events: snapshot.events.length, historyHash: digest(snapshot.events), userMessages: snapshot.events.filter(e => e.type === 'user/message').length, queue: agent?.inbox.current() ?? null, status: agent?.status, holders: ctx.get('workspaceRegistry').list().filter(w => w.sessionIds.includes(ID)).map(w => w.id), othersUnchanged: others.every(a => raw(agents.get(a.id)) === raw(a)) } })
      } catch (error) { reply(400, { ok: false, error: error.message, stack: error.stack }) }
    },
  }), 'session-mover: disposable pilot verification')
}
