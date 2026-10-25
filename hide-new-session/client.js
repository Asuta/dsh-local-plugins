/**
 * Client half of the hide-new-session bundle.
 *
 * The New Session control at the top of the sidebar is drawn by the shipped
 * ui-sidebar shell itself — it is not a slot occupant, so there is no seat to
 * leave empty and no registration that could switch it off. The one stable
 * handle on it is its CSS-module class name: the shell writes
 * `className: SidebarRoot_module_css_default.newSession`, and the build emits
 * that as `<hash>_newSession` (the hash changes between builds, the local name
 * does not). Matching the local-name suffix therefore keeps working across
 * rebuilds without pinning a hash.
 *
 * Only the button is targeted: the same rule also matches the label/shortcut
 * spans nested inside it, which is harmless because the parent is not rendered.
 * The collapsed rail icon and the Windows titlebar variant are the same button,
 * so both states are covered.
 *
 * The shell's own brand row remains a New Session shortcut and the keyboard
 * shortcut still works; this plugin only removes the button from view.
 */

window.__ModuleLoader__.load({
  id: '@local/hide-new-session',
  factory() {
    const CSS = 'button[class*="newSession"] { display: none !important; }'
    const TAG_ID = '@local/hide-new-session/hide-new-session.css'

    return {
      apply(ctx) {
        ctx.effect(() => {
          // Idempotent across HMR re-activation: reuse an existing tag.
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`)
          if (existing !== null) return () => { existing.remove() }

          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/hide-new-session'
          tag.dataset.pluginCss = TAG_ID
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'hide-new-session: styles')
      },
    }
  },
})
