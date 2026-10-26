import { parseLocalPath } from './navigation-core.js';
export const inject = ['webServer', 'connection', 'fs'];

export async function inspectLocalPath(ctx, input, signal) {
  if (process.platform !== 'win32') throw new Error('native-unavailable');
  const path = parseLocalPath(input);
  const mapped = ctx.fs.processPathFromHostPath(path);
  if (mapped === undefined) throw new Error('non-local-path');
  const target = await ctx.fs.resolve(mapped, { signal });
  const canonical = parseLocalPath(ctx.fs.processPath(target));
  const info = await ctx.fs.stat(target, signal);
  if (!info || !['file', 'directory'].includes(info.type)) throw new Error('path-not-found');
  return { path: canonical, type: info.type };
}

export function apply(ctx) {
  let clientStatus = { stage: 'not-seen', error: '' };
  ctx.provide('desktopNavigationStatus', { read: () => ({ ...clientStatus }) });
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/desktop-navigation/client-status',
    async handler(req, res) {
      const rejected = ctx.connection.requestRejection(req);
      if (rejected !== undefined) { res.statusCode = rejected; res.end(); return; }
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('allow', 'POST'); res.end(); return; }
      if (String(req.headers['content-type']).split(';')[0].trim().toLowerCase() !== 'application/json') { res.statusCode = 415; res.end(); return; }
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) { res.statusCode = 413; res.end(); return; } chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!['factory', 'starting', 'recent-ready', 'navigation-ready', 'navigation-error', 'apply-error'].includes(input.stage) || typeof input.error !== 'string') throw new Error('invalid-status');
        clientStatus = { stage: input.stage, error: input.error.slice(0, 2000) };
        res.statusCode = 200; res.end('{"ok":true}');
      } catch { res.statusCode = 400; res.end('{"ok":false}'); }
    },
  }), 'desktop-navigation: own initialization status');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/desktop-navigation/path-info',
    async handler(req, res) {
      const reject = ctx.connection.requestRejection(req);
      if (reject !== undefined) { res.statusCode = reject; res.end(); return; }
      const send = (status, value) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value)); };
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); send(405, { error: 'method-not-allowed' }); return; }
      if (String(req.headers['content-type']).split(';')[0].trim().toLowerCase() !== 'application/json') { send(415, { error: 'invalid-content-type' }); return; }
      const controller = new AbortController();
      const aborted = () => controller.abort();
      req.on('aborted', aborted);
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 16384) { send(413, { error: 'body-too-large' }); return; } chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = await inspectLocalPath(ctx, input.path, controller.signal);
        send(200, result);
      } catch (error) { send(400, { error: error?.message === 'path-not-found' ? 'path-not-found' : 'invalid-path' }); }
      finally { req.off('aborted', aborted); }
    },
  }), 'desktop-navigation: local path metadata');
}
