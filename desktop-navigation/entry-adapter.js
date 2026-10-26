/**
 * Compatibility seam for native Chat file navigation.
 * Keep the original StoredEntry, children, store and injected-prop caches intact.
 * Only its component is wrapped; the native renderer still builds the complete
 * kit against the original registration and owns every child authorization.
 */
const ORIGINAL = Symbol.for('cordis.original');
const OWNED = Symbol.for('desktop-enhancements.chat-wrapper');
const canonical = value => value?.[ORIGINAL] ?? value;
export function installChatNavigation(ctx, openFactory, warn = console.warn, React) {
  const slots = ctx.slots;
  if (typeof slots?.entriesOfSlot !== 'function' || typeof slots?.register !== 'function' || typeof slots?.inject !== 'function' || typeof slots?.subscribe !== 'function' || !React?.createElement || !React?.useMemo) throw new Error('unsupported-chat-registry');
  return slots.inject('conversation.view', () => {
    let patch = null, stopped = false, changing = false;
    function notify() {
      // A disposed, empty, distinct list cell is the public registry mutation
      // that invalidates renderer caches; it never replaces any native cell.
      const remove = slots.register({ name: 'conversation.view', id: 'desktop-enhancements.invalidate', order: 10000 }, () => null);
      remove();
    }
    function restore() {
      if (!patch) return;
      const { entry, descriptor, wrapper } = patch; patch = null;
      if (entry.component === wrapper) Object.defineProperty(entry, 'component', descriptor);
    }
    function reconcile() {
      if (stopped || changing) return;
      changing = true;
      try {
        const entry = canonical(slots.entriesOfSlot('conversation.view').find(item => item.options?.id === 'chat'));
        if (patch && patch.entry === entry && entry.component === patch.wrapper) return;
        restore();
        if (!entry || typeof entry.component !== 'function' || typeof entry.inject !== 'function' || !entry.children || !entry.store) throw new Error('unsupported-chat-entry');
        const descriptor = Object.getOwnPropertyDescriptor(entry, 'component');
        if (!descriptor || (!descriptor.writable && !descriptor.configurable) || entry.component[OWNED]) throw new Error('unsupported-chat-component');
        const OriginalChat = entry.component;
        function ChatWithNativeNavigation(props) {
          const openFile = React.useMemo(() => openFactory(props.sessionId, props.openFile), [props.sessionId, props.openFile]);
          return React.createElement(OriginalChat, { ...props, openFile });
        }
        Object.defineProperty(ChatWithNativeNavigation, 'displayName', { value: 'ChatWithNativeNavigation' });
        Object.defineProperty(ChatWithNativeNavigation, OWNED, { value: true });
        Object.defineProperty(entry, 'component', { ...descriptor, value: ChatWithNativeNavigation });
        patch = { entry, descriptor, wrapper: ChatWithNativeNavigation };
        notify();
      } catch (error) { warn(error instanceof Error ? error.message : String(error)); }
      finally { changing = false; }
    }
    const unsubscribe = slots.subscribe('conversation.view', reconcile);
    reconcile();
    if (!patch) { stopped = true; unsubscribe(); throw new Error('chat-wrapper-not-installed'); }
    return () => {
      stopped = true; unsubscribe();
      changing = true;
      try { restore(); notify(); } finally { changing = false; }
    };
  });
}
