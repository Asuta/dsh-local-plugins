function reportClientStage(stage, error) {
  const detail = String(error?.message ?? error ?? '').slice(0, 2000);
  reportClientStage.queue = (reportClientStage.queue ?? Promise.resolve()).then(async () => {
    try { await fetch('/desktop-navigation/client-status', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage, error: detail }) }); } catch { /* Diagnostics must never prevent UI activation. */ }
  });
  return reportClientStage.queue;
}

function installNavigation(ctx) {
  installChatNavigation(ctx, (sessionId) => createNativeOpener({
    cwd: () => ctx.get('sessions')?.list?.getSnapshot()?.byId?.[sessionId]?.cwd,
    remote: { openWorkspacePath(request) {
      const api = ctx.get('remote')?.session;
      if (typeof api?.openWorkspacePath !== 'function') throw new Error('native-unavailable');
      return api.openWorkspacePath(request);
    } },
    available: async () => (await ctx.get('remote')?.session?.canOpenWorkspacePath?.()) === true,
    inspectPath: async (path) => {
      const response = await fetch('/desktop-navigation/path-info', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'invalid-path');
      return result;
    },
  }), message => reportClientStage('navigation-render-error', message), react);
}

/** Owns only its own list box. Closed content is inert immediately and removed after the transition. */
function RecentMotionList({ folded, className, children }) {
  const [mounted, setMounted] = react.useState(!folded);
  const [shown, setShown] = react.useState(!folded);
  if (!folded && !mounted) setMounted(true);
  const reduce = react.useRef(false);
  react.useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { reduce.current = query.matches; if (query.matches && folded) setMounted(false); };
    change(); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [folded]);
  react.useEffect(() => {
    let frame; let timer;
    if (!folded) { setMounted(true); frame = requestAnimationFrame(() => setShown(true)); }
    else { setShown(false); if (reduce.current) setMounted(false); else timer = setTimeout(() => setMounted(false), 190); }
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [folded]);
  return react.createElement('div', { className: 'desktop-navigation-recent-motion', 'data-open': shown && !folded ? '' : undefined, 'aria-hidden': folded ? 'true' : undefined, ref: element => { if (element) element.inert = folded; } },
    react.createElement('div', { className: 'desktop-navigation-recent-clip' }, mounted ? react.createElement('ul', { className }, children) : null),
    react.createElement('style', null, '.desktop-navigation-recent-motion{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows 180ms ease,opacity 140ms ease}.desktop-navigation-recent-motion[data-open]{grid-template-rows:1fr;opacity:1}.desktop-navigation-recent-clip{min-height:0;overflow:hidden}.aalpzW_chevron{transition:transform 180ms ease!important}@media(prefers-reduced-motion:reduce){.desktop-navigation-recent-motion,.aalpzW_chevron,[data-dsh-recent-section-chevron]{transition:none!important}}'));
}
