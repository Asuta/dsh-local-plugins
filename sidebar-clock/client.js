/**
 * Sidebar clock (browser half).
 *
 * Two registrations sharing one module-level "open" flag:
 * - `sidebar.footer.action` renders the clock button in the sidebar foot, in the
 *   same 42px row rhythm as the Settings trigger (36px circle in the rail).
 * - `shell.overlay` renders the clock page itself, frame-wide, only while open.
 *
 * The page is a full-viewport sheet: a header with the title and a close
 * control, then a plate with the analog face, the digital time, the date and
 * the local zone. It follows the theme through `--dsw-alias-*` tokens, takes
 * Esc as well as the close control, and owns its interval/one listener through
 * effects so unmounting leaves nothing behind.
 */
window.__ModuleLoader__.load({
  id: '@local/sidebar-clock',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace for the two visible strings plus their fallbacks. */
    const NS = 'sidebarClock'
    const en = {
      label: 'Clock',
      title: 'Clock',
      close: 'Close clock',
    }
    const zh = {
      label: '时钟',
      title: '时钟',
      close: '关闭时钟',
    }

    /** Open flag shared by the footer button and the overlay page. */
    let isOpen = false
    const subscribers = new Set()

    /**
     * Flip the shared flag and notify both registrations.
     * @param next - the state the page should take.
     */
    function setOpen(next) {
      if (isOpen === next) return
      isOpen = next
      for (const notify of subscribers) notify()
    }

    /**
     * Subscribe a component to the shared flag.
     * @returns the current open state, re-rendering on changes.
     */
    function useOpen() {
      const [value, setValue] = React.useState(isOpen)
      React.useEffect(() => {
        const notify = () => { setValue(isOpen) }
        subscribers.add(notify)
        notify()
        return () => { subscribers.delete(notify) }
      }, [])
      return value
    }

    /** Zero-pad a clock field. */
    function pad(value) {
      return String(value).padStart(2, '0')
    }

    /**
     * Resolve the slot's `t` with a browser-language fallback, so a missing
     * locale share cannot blank the button or the page title.
     * @param t - the registration translator, when the locale service shared one.
     * @returns a key lookup.
     */
    function translator(t) {
      const fallback = String(navigator.language || '').toLowerCase().startsWith('zh') ? zh : en
      return (key) => {
        if (typeof t === 'function') {
          const text = t(key)
          if (typeof text === 'string' && text !== '' && text !== key) return text
        }
        return fallback[key] ?? key
      }
    }

    const CSS = `
      /* Footer seat: the 42px foot row shared with Settings, 36px in the rail. */
      .dsc-layer { position: relative; flex: none; display: flex; align-items: center; width: 100%; height: 42px; margin: 8px 0 0; }
      .dsc-button { display: flex; align-items: center; gap: 10px; width: calc(100% + 4px); height: 42px; margin: 0 -2px; padding: 0 10px 0 8px; box-sizing: border-box; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer; overflow: hidden; }
      .dsc-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsc-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
      .dsc-button-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; color: var(--dsw-alias-label-secondary); }
      .dsc-button:hover .dsc-button-icon { color: var(--dsw-alias-label-primary); }
      .dsc-button-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsc-layer[data-rail] { width: 36px; height: 36px; margin: 0; }
      .dsc-layer[data-rail] .dsc-button { justify-content: center; gap: 0; width: 36px; height: 36px; margin: 0; padding: 0; border-radius: 50%; }
      .dsc-layer[data-rail] .dsc-button-label { display: none; }

      /* Clock page: a full-viewport sheet inside the frame-wide overlay layer. */
      .dsc-page { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; box-sizing: border-box; overflow: auto; pointer-events: auto; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family), system-ui, sans-serif; background: radial-gradient(90% 70% at 50% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent), transparent 62%), var(--dsw-alias-bg-layer-1); }
      .dsc-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 56px; padding: 0 14px 0 20px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .dsc-heading { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
      .dsc-heading-icon { display: inline-flex; color: var(--dsw-alias-label-secondary); }
      .dsc-close { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: none; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .dsc-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsc-close:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsc-body { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 24px 56px; }
      .dsc-plate { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 34px 44px 30px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 28px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 76%, transparent); box-shadow: var(--dsw-shadow-lv2); }
      .dsc-face { position: relative; width: 240px; height: 240px; border: 2px solid var(--dsw-alias-border-l2); border-radius: 50%; background: radial-gradient(circle at 34% 28%, var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-2)); }
      .dsc-tick-layer { position: absolute; inset: 0; pointer-events: none; }
      .dsc-tick { position: absolute; left: 50%; top: 8px; width: 2px; height: 5px; margin-left: -1px; border-radius: 1px; background: var(--dsw-alias-label-tertiary); opacity: 0.55; }
      .dsc-tick[data-hour] { height: 10px; width: 2px; margin-left: -1px; background: var(--dsw-alias-label-secondary); opacity: 0.9; }
      .dsc-hand { position: absolute; left: 50%; bottom: 50%; border-radius: 999px; transform-origin: 50% 100%; }
      .dsc-hand-hour { width: 6px; height: 66px; margin-left: -3px; background: var(--dsw-alias-label-primary); }
      .dsc-hand-minute { width: 4px; height: 94px; margin-left: -2px; background: var(--dsw-alias-label-primary); opacity: 0.85; }
      .dsc-hand-second { width: 2px; height: 106px; margin-left: -1px; background: var(--dsw-alias-brand-primary); }
      .dsc-cap { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px var(--dsw-alias-bg-layer-2); }
      .dsc-digital { font-size: 56px; font-weight: 600; line-height: 1; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
      .dsc-date { font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .dsc-zone { font-size: 12px; line-height: 18px; letter-spacing: 0.04em; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
      @media (max-width: 560px) {
        .dsc-plate { padding: 26px 22px 24px; gap: 16px; }
        .dsc-face { width: 196px; height: 196px; }
        .dsc-hand-hour { height: 54px; }
        .dsc-hand-minute { height: 76px; }
        .dsc-hand-second { height: 86px; }
        .dsc-digital { font-size: 42px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsc-button, .dsc-close { transition: none; }
      }
    `

    /** Small clock glyph shared by the button and the page heading. */
    function ClockIcon({ size }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
        },
        h('circle', { cx: 8, cy: 8, r: 6.25 }),
        h('path', { d: 'M8 4.6V8l2.5 1.7' }),
      )
    }

    /**
     * The footer button; `wide` is false in the collapsed rail.
     * @param props - slot props `{ wide }` plus the locale `t`.
     */
    function ClockButton({ wide, t }) {
      const label = translator(t)
      return h(
        'div',
        { className: 'dsc-layer', 'data-rail': wide === false ? '' : undefined, 'data-plugin': '@local/sidebar-clock' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsc-button',
            'aria-label': label('label'),
            'aria-haspopup': 'dialog',
            title: label('label'),
            onClick: () => { setOpen(true) },
          },
          h('span', { className: 'dsc-button-icon' }, h(ClockIcon, { size: wide === false ? 18 : 16 })),
          h('span', { className: 'dsc-button-label' }, label('label')),
        ),
      )
    }

    /** One ring of 60 ticks, rotated around its own center so the face can resize. */
    function tickRing() {
      const ticks = []
      for (let index = 0; index < 60; index += 1) {
        const hour = index % 5 === 0
        ticks.push(
          h(
            'div',
            { key: `tick-${index}`, className: 'dsc-tick-layer', style: { transform: `rotate(${index * 6}deg)` } },
            h('span', { className: 'dsc-tick', 'data-hour': hour ? '' : undefined }),
          ),
        )
      }
      return ticks
    }

    /**
     * The clock page. Mounted in `shell.overlay`, renders nothing while closed.
     * @param props - slot props plus the locale `t`.
     */
    function ClockPage({ t }) {
      const label = translator(t)
      const open = useOpen()
      const [now, setNow] = React.useState(() => Date.now())
      const closeRef = React.useRef(null)

      // Only tick and take keys while the page is on screen.
      React.useEffect(() => {
        if (!open) return undefined
        setNow(Date.now())
        const handle = window.setInterval(() => { setNow(Date.now()) }, 1000)
        return () => { window.clearInterval(handle) }
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => { document.removeEventListener('keydown', onKeyDown) }
      }, [open])

      React.useEffect(() => {
        if (open) closeRef.current?.focus()
      }, [open])

      if (!open) return null

      const date = new Date(now)
      const hours = date.getHours()
      const minutes = date.getMinutes()
      const seconds = date.getSeconds()
      const digital = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`

      let dateText = ''
      try {
        dateText = new Intl.DateTimeFormat(undefined, {
          year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
        }).format(date)
      } catch {
        dateText = date.toLocaleDateString()
      }

      const offsetMinutes = -date.getTimezoneOffset()
      const sign = offsetMinutes >= 0 ? '+' : '-'
      const magnitude = Math.abs(offsetMinutes)
      const offset = `UTC${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`
      const zone = `${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'} (${offset})`

      return h(
        'div',
        {
          className: 'dsc-page',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': label('title'),
          'data-plugin': '@local/sidebar-clock',
        },
        h(
          'header',
          { className: 'dsc-head' },
          h(
            'div',
            { className: 'dsc-heading' },
            h('span', { className: 'dsc-heading-icon' }, h(ClockIcon, { size: 18 })),
            h('span', null, label('title')),
          ),
          h(
            'button',
            {
              ref: closeRef,
              type: 'button',
              className: 'dsc-close',
              'aria-label': label('close'),
              title: label('close'),
              onClick: () => { setOpen(false) },
            },
            h(
              'svg',
              { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
              h('path', { d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6' }),
            ),
          ),
        ),
        h(
          'main',
          { className: 'dsc-body' },
          h(
            'div',
            { className: 'dsc-plate' },
            h(
              'div',
              { className: 'dsc-face', 'aria-hidden': true },
              tickRing(),
              h('span', {
                className: 'dsc-hand dsc-hand-hour',
                style: { transform: `rotate(${(hours % 12) * 30 + minutes * 0.5}deg)` },
              }),
              h('span', {
                className: 'dsc-hand dsc-hand-minute',
                style: { transform: `rotate(${minutes * 6 + seconds * 0.1}deg)` },
              }),
              h('span', {
                className: 'dsc-hand dsc-hand-second',
                style: { transform: `rotate(${seconds * 6}deg)` },
              }),
              h('span', { className: 'dsc-cap' }),
            ),
            h('div', { className: 'dsc-digital', role: 'timer', 'aria-live': 'off' }, digital),
            h('div', { className: 'dsc-date' }, dateText),
            h('div', { className: 'dsc-zone' }, zone),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'sidebar-clock: locale')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/sidebar-clock'
          tag.dataset.pluginCss = '@local/sidebar-clock/sidebar-clock.css'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'sidebar-clock: styles')

        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'sidebar-clock.button',
          locale: NS,
          order: 50,
        }, ClockButton)), 'sidebar-clock: footer button')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'sidebar-clock.page',
          locale: NS,
          order: 60,
        }, ClockPage)), 'sidebar-clock: clock page')
      },
    }
  },
})
