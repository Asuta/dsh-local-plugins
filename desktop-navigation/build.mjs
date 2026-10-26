import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('./', import.meta.url);
const source = process.env.DESKTOP_NAV_RECENT_SOURCE;
await mkdir(new URL('vendor/', root), { recursive: true });
let client = await readFile(source ? source.replace(/[/\\]+$/, '') + '/lib/client.js' : new URL('vendor/recent-original.js', root), 'utf8');
const originalHash = createHash('sha256').update(client).digest('hex');
if (originalHash !== 'f37ef572734da68056a8385d833af5354f5fa4641d166c59cbc71791daf2ba8e') throw new Error('Unexpected upstream dsh-recent build; review before adapting');
if (source) {
  await writeFile(new URL('vendor/recent-original.js', root), client);
  await copyFile(source.replace(/[/\\]+$/, '') + '/LICENSE', new URL('vendor/LICENSE.dsh-recent', root));
}
client = client.replace(/\r\n/g, '\n');
const replaceOnce = (from, to) => { if (client.split(from).length !== 2) throw new Error('Upstream recent build changed: ' + from.slice(0, 60)); client = client.replace(from, to); };
replaceOnce('id: "dsh-recent"', 'id: "@local/desktop-enhancements"');
replaceOnce('!recentFolded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {', '/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(RecentMotionList, { folded: recentFolded,');
replaceOnce('visibleRows.length < rows.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {', '!recentFolded && visibleRows.length < rows.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {');
replaceOnce('\t\t\t\trows.length\n\t\t\t]);', '\t\t\t\trows.length,\n\t\t\t\trecentFolded\n\t\t\t]);');
const navigation = (await readFile(new URL('navigation-core.js', root), 'utf8')).replace(/export /g, '');
const adapter = (await readFile(new URL('entry-adapter.js', root), 'utf8')).replace(/export /g, '');
const extension = await readFile(new URL('client-extension.js', root), 'utf8');
replaceOnce('\t\tvar module = { exports: {} };', '\t\treportClientStage("factory");\n\t\tvar module = { exports: {} };');
replaceOnce('\t\texports.apply = apply;', `${navigation}\n${adapter}\n${extension}\n\t\texports.apply = function(ctx) {\n  reportClientStage('starting');\n  try {\n    apply(ctx); reportClientStage('recent-ready');\n    try { installNavigation(ctx); reportClientStage('navigation-ready'); }\n    catch (error) { reportClientStage('navigation-error', error); }\n  } catch (error) { reportClientStage('apply-error', error); throw error; }\n};`);
replaceOnce('\t\texports.inject = inject;', '\t\texports.inject = inject;');
client = client.replace(/\/\/# sourceMappingURL=client.js.map\s*$/, '');
await writeFile(new URL('client.js', root), client);
await writeFile(new URL('vendor/UPSTREAM.json', root), JSON.stringify({ package: 'dsh-recent', version: '0.1.0', license: 'MIT', author: 'ttmouse', source: 'https://github.com/ttmouse/dsh-recent', sha256: originalHash, changes: ['180ms height and opacity disclosure', 'arrow reduced-motion rule', 'disable sentinel while folded', 'Chat native file navigation adapter'] }, null, 2));
console.log('Built desktop-navigation; upstream sha256:', originalHash);
