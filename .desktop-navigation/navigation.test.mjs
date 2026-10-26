import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseLocalPath, createNativeOpener } from '../desktop-navigation/navigation-core.js';
import { installChatNavigation } from '../desktop-navigation/entry-adapter.js';
import { inspectLocalPath } from '../desktop-navigation/index.js';

const FakeReact = { createElement: (type, props) => ({ type, props }), useMemo: factory => factory() };
function nativeEntry() {
  const component = function NativeChat() {};
  const openFile = async () => 'original-open-result';
  return { component, options: { id: 'chat', order: 0, priority: 0, label: () => 'Chat' }, inject: sessionId => ({ sessionId, openFile }), children: { 'conversation.chat.flow': { kind: 'single', scope: 'session' } }, store: { nativeStore: true }, locale: 'chat', select: () => true };
}
function registryFixture(entry = nativeEntry()) {
  let entries = entry ? [entry] : [];
  const listeners = new Set(); const registrations = []; const disposers = [];
  let version = 0; let unsubscribed = 0; let bumps = 0;
  const emit = () => { version++; for (const listener of [...listeners]) listener(); };
  const slots = {
    entriesOfSlot: () => entries,
    subscribe(_key, listener) { listeners.add(listener); return () => { unsubscribed++; listeners.delete(listener); }; },
    inject(_key, callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); return dispose; },
    register(options, component) {
      assert.equal(options.id, 'desktop-enhancements.invalidate');
      assert.equal(options.name, 'conversation.view');
      assert.equal(options.children, undefined);
      assert.equal(component(), null);
      const added = { options, component }; registrations.push(added); bumps++; emit();
      return () => { registrations.splice(registrations.indexOf(added), 1); emit(); };
    },
  };
  return { ctx: { slots }, slots, registrations, disposers, get version() { return version; }, get unsubscribed() { return unsubscribed; }, get bumps() { return bumps; }, get listeners() { return listeners.size; }, change(next) { entries = next ? [next] : []; emit(); } };
}

test('normalizes Windows paths, relative paths, file URIs and line anchors', () => {
  assert.equal(parseLocalPath('D:/项目/a b.txt#L24-L30'), 'D:\\项目\\a b.txt');
  assert.equal(parseLocalPath('./src/../a.txt', 'D:\\Project'), 'D:\\Project\\a.txt');
  assert.equal(parseLocalPath('file:///D:/hello%20world.txt'), 'D:\\hello world.txt');
  assert.equal(parseLocalPath('D:\\a&$(calc).txt'), 'D:\\a&$(calc).txt');
});
test('rejects remote URLs, UNC shares, device paths, bad chars and unresolved paths', () => {
  for (const path of ['https://host/a', '//host/a', '\\\\server\\a', '\\\\?\\D:\\a', 'javascript:alert(1)', 'C:relative.txt', '../a', '/etc/passwd', 'D:\\bad\0.txt', 'D:\\CON.txt', 'file://server/a']) assert.throws(() => parseLocalPath(path));
});
test('directories use direct native open, files reveal, nothing launches in test', async () => {
  const calls = []; const remote = { openWorkspacePath: async request => { calls.push(request); return { opened: true }; } };
  for (const type of ['file', 'directory']) await createNativeOpener({ remote, cwd: 'D:\\Test', available: async () => true, inspectPath: async path => ({ path, type }) })('a.txt');
  assert.deepEqual(calls, [{ path: 'D:\\Test\\a.txt', action: 'reveal' }, { path: 'D:\\Test\\a.txt' }]);
});
test('invalid, missing and unavailable paths never call native opener', async () => {
  let calls = 0; const remote = { openWorkspacePath: async () => { calls++; } };
  for (const [input, available, inspectPath] of [['https://bad', true, async () => ({ type: 'file' })], ['D:/a', false, async () => ({ type: 'file' })], ['D:/a', true, async () => { throw new Error('missing'); }]]) await assert.rejects(createNativeOpener({ remote, available, inspectPath })(input));
  assert.equal(calls, 0);
});
test('component wrapper preserves original descriptor, all authorization resources and rendered props', async () => {
  const original = nativeEntry(); const component = original.component;
  const descriptor = Object.getOwnPropertyDescriptor(original, 'component');
  const resources = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'component'));
  const fixture = registryFixture(original); const warnings = []; const seen = []; const nativeOpen = async path => path;
  const release = installChatNavigation(fixture.ctx, (id, prior) => { seen.push({ id, prior }); return nativeOpen; }, message => warnings.push(message), FakeReact);
  assert.notEqual(original.component, component);
  const props = { ...original.inject('session-a'), children: { child: true }, style: { color: 'inherit' }, renderSlot() {}, SessionProvider() {}, useStore() {}, actions: {}, arbitrary: 42 };
  const rendered = original.component(props);
  assert.equal(rendered.type, component);
  for (const [key, value] of Object.entries(props)) if (key !== 'openFile') assert.equal(rendered.props[key], value);
  assert.equal(rendered.props.openFile, nativeOpen);
  assert.equal(seen[0].id, 'session-a'); assert.equal(seen[0].prior, props.openFile);
  assert.equal(await props.openFile(), 'original-open-result');
  assert.equal(await rendered.props.openFile('D:/a'), 'D:/a');
  for (const [key, value] of Object.entries(resources)) assert.equal(original[key], value);
  assert.equal(Object.getOwnPropertyDescriptor(original, 'component').enumerable, descriptor.enumerable);
  assert.equal(Object.getOwnPropertyDescriptor(original, 'component').configurable, descriptor.configurable);
  assert.equal(fixture.registrations.length, 0); assert.ok(fixture.version >= 2); assert.equal(fixture.listeners, 1);
  release();
  assert.deepEqual(Object.getOwnPropertyDescriptor(original, 'component'), descriptor);
  assert.equal(fixture.registrations.length, 0); assert.equal(fixture.listeners, 0); assert.equal(fixture.unsubscribed, 1); assert.equal(fixture.bumps, 2); assert.deepEqual(warnings, []);
});
test('registry replacement restores old entry and patches only the new current entry', () => {
  const first = nativeEntry(); const firstComp = first.component; const second = nativeEntry(); const secondComp = second.component;
  const fixture = registryFixture(first); const release = installChatNavigation(fixture.ctx, () => async () => {}, () => {}, FakeReact);
  fixture.change(second);
  assert.equal(first.component, firstComp); assert.notEqual(second.component, secondComp);
  release(); assert.equal(second.component, secondComp); assert.equal(fixture.registrations.length, 0); assert.equal(fixture.listeners, 0);
});
test('unknown registries and unsupported/nonwritable entries fail closed', () => {
  assert.throws(() => installChatNavigation({ slots: {} }, () => {}, () => {}, FakeReact), /unsupported-chat-registry/);
  const missingChildren = nativeEntry(); delete missingChildren.children;
  const frozenComponent = nativeEntry(); Object.defineProperty(frozenComponent, 'component', { value: frozenComponent.component, writable: false, configurable: false });
  for (const entry of [null, missingChildren, frozenComponent]) {
    const warnings = []; const fixture = registryFixture(entry); const component = entry?.component;
    assert.throws(() => installChatNavigation(fixture.ctx, () => async () => {}, value => warnings.push(value), FakeReact), /chat-wrapper-not-installed/);
    assert.equal(entry?.component, component); assert.ok(warnings.length > 0); assert.equal(fixture.registrations.length, 0);
    assert.equal(fixture.listeners, 0); assert.equal(fixture.unsubscribed, 1);
  }
});
test('concurrent component owners are never overwritten on teardown or mistaken for our wrapper', () => {
  const entry = nativeEntry(); const fixture = registryFixture(entry); const release = installChatNavigation(fixture.ctx, () => async () => {}, () => {}, FakeReact);
  const other = function OtherOwner() {}; entry.component = other;
  release(); assert.equal(entry.component, other);
  const owned = function AlreadyOwned() {}; Object.defineProperty(owned, Symbol.for('desktop-enhancements.chat-wrapper'), { value: true });
  const second = nativeEntry(); second.component = owned;
  const next = registryFixture(second); const warnings = [];
  assert.throws(() => installChatNavigation(next.ctx, () => async () => {}, value => warnings.push(value), FakeReact), /chat-wrapper-not-installed/);
  assert.equal(second.component, owned); assert.ok(warnings.includes('unsupported-chat-component')); assert.equal(next.listeners, 0);
});
test('canonical Cordis original identity is patched while proxy reference and resources stay intact', () => {
  const entry = nativeEntry(); const component = entry.component; const proxy = { [Symbol.for('cordis.original')]: entry, options: entry.options };
  const fixture = registryFixture(proxy); const release = installChatNavigation(fixture.ctx, () => async () => {}, () => {}, FakeReact);
  assert.notEqual(entry.component, component); assert.equal(proxy[Symbol.for('cordis.original')], entry);
  release(); assert.equal(entry.component, component);
});
test('Host metadata enforces local mapping, canonical target and existence', async () => {
  const ctx = { fs: { processPathFromHostPath: p => p, resolve: async p => ({ p }), processPath: t => t.p, stat: async () => ({ type: 'directory' }) } };
  assert.deepEqual(await inspectLocalPath(ctx, 'D:/test'), { path: 'D:\\test', type: 'directory' });
  ctx.fs.stat = async () => undefined; await assert.rejects(inspectLocalPath(ctx, 'D:/missing'));
  ctx.fs.processPathFromHostPath = () => undefined; await assert.rejects(inspectLocalPath(ctx, 'D:/hidden'));
});
test('client artifact keeps loader contract, folded paging, reduced motion and original four dependencies', async () => {
  const source = await readFile(new URL('../desktop-navigation/client.js', import.meta.url), 'utf8'); let module;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { module = value; } } } });
  assert.equal(module.id, '@local/desktop-enhancements'); assert.equal(typeof module.factory, 'function');
  assert.match(source, /RecentMotionList, \{ folded: recentFolded/); assert.match(source, /!recentFolded && visibleRows.length < rows.length/);
  assert.match(source, /prefers-reduced-motion:reduce/); assert.match(source, /exports.inject = inject;/); assert.doesNotMatch(source, /exports.inject = .*"remote.session"/);
});
test('full client factory/apply preserves native Chat entry, registers only Recent and renders native opener through owned wrapper', async () => {
  const source = await readFile(new URL('../desktop-navigation/client.js', import.meta.url), 'utf8');
  let loaded; let fetches = 0; let launches = 0; let serviceReads = 0; const statuses = []; const requests = [];
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { loaded = value; } } }, URL, console,
    fetch: async (url, options) => { if (url === '/desktop-navigation/client-status') { statuses.push(JSON.parse(options.body)); return { ok: true }; } fetches++; return { ok: true, json: async () => ({ path: 'D:\\Test\\a.txt', type: 'file' }) }; },
  });
  const runtime = loaded.factory(name => { requests.push(name); return name === 'react' ? FakeReact : {}; });
  assert.deepEqual(Array.from(runtime.inject), ['slots', 'locale', 'uiSession', 'uiWorkspace']);
  assert.deepEqual(requests, ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', 'react/jsx-runtime']);
  const original = nativeEntry(); const component = original.component; const descriptor = Object.getOwnPropertyDescriptor(original, 'component');
  const fixture = registryFixture(original); const recent = []; const services = {}; const disposers = [];
  const markerRegister = fixture.slots.register;
  fixture.slots.register = (options, Comp) => {
    assert.notEqual(options.id, 'chat', 'must not duplicate Chat registration');
    if (options.name === 'sidebar.footer.action') { const item = { options, Comp }; recent.push(item); return () => recent.splice(recent.indexOf(item), 1); }
    return markerRegister(options, Comp);
  };
  const ctx = { ...fixture.ctx, get(name) { serviceReads++; return services[name]; }, effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose); }, locale: { register() { return () => {}; } }, uiWorkspace: {} };
  runtime.apply(ctx);
  assert.equal(serviceReads, 0); assert.deepEqual(recent.map(item => item.options.id), ['recent']); assert.equal(fixture.registrations.length, 0);
  assert.notEqual(original.component, component); assert.equal(original.options.id, 'chat');
  const nativeProps = { ...original.inject('session-fixture'), renderSlot() {}, SessionProvider() {}, style: { display: 'flex' } };
  const rendered = original.component(nativeProps);
  assert.equal(rendered.type, component); assert.equal(rendered.props.renderSlot, nativeProps.renderSlot); assert.equal(rendered.props.SessionProvider, nativeProps.SessionProvider); assert.equal(rendered.props.style, nativeProps.style);
  await assert.rejects(rendered.props.openFile('D:/Test/a.txt'), /native-unavailable/); assert.equal(fetches, 0); assert.equal(launches, 0);
  assert.equal(await nativeProps.openFile(), 'original-open-result');
  services.remote = { session: { canOpenWorkspacePath: async () => true, openWorkspacePath: async request => { launches++; assert.equal(request.action, 'reveal'); return { opened: true }; } } };
  await rendered.props.openFile('D:/Test/a.txt'); assert.equal(fetches, 1); assert.equal(launches, 1);
  await new Promise(setImmediate);
  assert.deepEqual(statuses.map(status => status.stage), ['factory', 'starting', 'recent-ready', 'navigation-ready']);
  fixture.disposers.reverse().forEach(dispose => dispose()); disposers.reverse().forEach(dispose => dispose());
  assert.deepEqual(Object.getOwnPropertyDescriptor(original, 'component'), descriptor); assert.equal(recent.length, 0); assert.equal(fixture.registrations.length, 0); assert.equal(fixture.listeners, 0); assert.equal(fixture.unsubscribed, 1);
});
