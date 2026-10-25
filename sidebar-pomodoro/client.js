/**
 * Sidebar Pomodoro (browser half).
 *
 * Two registrations share one module-level timer store:
 * - `sidebar.footer.action` renders the Pomodoro button in the sidebar foot, in
 *   the same 42px row rhythm as the clock and the Settings trigger (36px circle
 *   in the rail). While a session runs the row also shows the countdown.
 * - `shell.overlay` renders the timer page, frame-wide, only while open.
 *
 * The countdown lives outside React on purpose: closing the page, switching
 * sessions or unmounting the button must not stop a focus round. One ticker runs
 * while `running`, driven by a wall-clock deadline (`endsAt`) so a throttled tab
 * or a paused JS loop cannot drift the round; the store persists to localStorage
 * so a reload resumes the same round. Phase transitions follow the classic
 * four-focus-rounds-then-a-long-break cycle.
 */
window.__ModuleLoader__.load({
  id: '@local/sidebar-pomodoro',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Locale namespace for the visible strings plus their fallbacks. */
    const NS = 'sidebarPomodoro'
    const en = {
      label: 'Pomodoro',
      title: 'Pomodoro',
      close: 'Close pomodoro',
      focus: 'Focus',
      short: 'Short break',
      long: 'Long break',
      start: 'Start',
      resume: 'Resume',
      pause: 'Pause',
      reset: 'Reset',
      skip: 'Skip',
      length: 'Length',
      minutes: 'min',
      today: '{count} pomodoros done',
      round: 'round {round}',
      noticeFocus: 'Focus finished · time for a short break',
      noticeLong: 'Four rounds done · take a long break',
      noticeBreak: 'Break over · back to focus',
    }
    const zh = {
      label: '番茄钟',
      title: '番茄钟',
      close: '关闭番茄钟',
      focus: '专注',
      short: '短休息',
      long: '长休息',
      start: '开始',
      resume: '继续',
      pause: '暂停',
      reset: '重置',
      skip: '跳过',
      length: '时长',
      minutes: '分钟',
      today: '已完成 {count} 个番茄',
      round: '第 {round} 轮',
      noticeFocus: '专注完成 · 休息一下',
      noticeLong: '四轮完成 · 长休息一下',
      noticeBreak: '休息结束 · 继续专注',
    }

    const PHASES = ['focus', 'short', 'long']
    const DEFAULTS = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 }
    const LIMITS = { focus: [5 * 60, 60 * 60], short: [60, 20 * 60], long: [5 * 60, 45 * 60] }
    const STEPS = { focus: 5 * 60, short: 60, long: 5 * 60 }
    const STORAGE_KEY = 'dsh.sidebar-pomodoro.v1'

    /**
     * The single timer store. Mutated in place, then `emit()` publishes a copy.
     * `remaining` is whole seconds, `endsAt` an epoch millisecond deadline.
     */
    const store = {
      phase: 'focus',
      running: false,
      remaining: DEFAULTS.focus,
      endsAt: 0,
      cycle: 0,
      total: 0,
      durations: { focus: DEFAULTS.focus, short: DEFAULTS.short, long: DEFAULTS.long },
      notice: null,
    }

    /** Disposable timer sinks captured from the plugin context in `apply`. */
    const runtime = { interval: null, timeout: null }

    const listeners = new Set()
    let open = false
    let ticker = null
    let noticeTimer = null

    /** Publish the current store state to every mounted component. */
    function emit() {
      for (const notify of listeners) notify()
    }

    /**
     * Subscribe a component to the store.
     * @returns the current snapshot plus a re-render on every change.
     */
    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store)
      React.useEffect(() => {
        const notify = () => { setSnapshot({ ...store }) }
        listeners.add(notify)
        notify()
        return () => { listeners.delete(notify) }
      }, [])
      return snapshot
    }

    /** Flip the shared page flag and notify every registration. */
    function setOpen(next) {
      if (open === next) return
      open = next
      emit()
    }

    /**
     * Subscribe a component to the shared page flag.
     * @returns the current open state, re-rendering on changes.
     */
    function useOpen() {
      const [value, setValue] = React.useState(open)
      React.useEffect(() => {
        const notify = () => { setValue(open) }
        listeners.add(notify)
        notify()
        return () => { listeners.delete(notify) }
      }, [])
      return value
    }

    /** Zero-pad a timer field. */
    function pad(value) {
      return String(value).padStart(2, '0')
    }

    /** Keep a number inside an inclusive range. */
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    /** Render whole seconds as `mm:ss` (minutes may exceed 59). */
    function formatTime(seconds) {
      const safe = Math.max(0, Math.round(seconds))
      return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`
    }

    /**
     * Schedule work through the plugin's disposable timers when available.
     * @returns a disposer.
     */
    function every(callback, delay) {
      if (typeof runtime.interval === 'function') return runtime.interval(callback, delay)
      const handle = window.setInterval(callback, delay)
      return () => { window.clearInterval(handle) }
    }

    /**
     * Delay work through the plugin's disposable timers when available.
     * @returns a disposer.
     */
    function later(callback, delay) {
      if (typeof runtime.timeout === 'function') return runtime.timeout(callback, delay)
      const handle = window.setTimeout(callback, delay)
      return () => { window.clearTimeout(handle) }
    }

    /** Start the single ticker if it is not already running. */
    function startTicker() {
      if (ticker) return
      ticker = every(tick, 250)
    }

    /** Stop the ticker and forget its disposer. */
    function stopTicker() {
      if (!ticker) return
      const dispose = ticker
      ticker = null
      try { dispose() } catch { /* an already-disposed timer is harmless */ }
    }

    /** One tick: refresh the visible seconds, then finish the phase at zero. */
    function tick() {
      const left = Math.max(0, Math.ceil((store.endsAt - Date.now()) / 1000))
      if (left !== store.remaining) {
        store.remaining = left
        emit()
      }
      if (left <= 0) finishPhase()
    }

    /** A short two-note chime; silently skipped when audio is unavailable. */
    let audio = null

    /**
     * Create or resume the audio context while the page still has the user's
     * click, so a completion chime fired later from the ticker can be heard.
     */
    function primeAudio() {
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext
        if (!AudioCtor) return
        if (!audio) audio = new AudioCtor()
        if (audio.state === 'suspended' && typeof audio.resume === 'function') audio.resume()
      } catch { /* no audio output is not a timer failure */ }
    }

    function chime(upbeat) {
      try {
        primeAudio()
        if (!audio) return
        const start = audio.currentTime
        const notes = upbeat ? [880, 1174.66] : [659.25, 880]
        notes.forEach((frequency, index) => {
          const oscillator = audio.createOscillator()
          const gain = audio.createGain()
          const at = start + index * 0.18
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, at)
          gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32)
          oscillator.connect(gain)
          gain.connect(audio.destination)
          oscillator.start(at)
          oscillator.stop(at + 0.36)
        })
      } catch { /* no audio output is not a timer failure */ }
    }

    /** Persist the store so a reload resumes the same round. */
    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          v: 1,
          phase: store.phase,
          running: store.running,
          remaining: store.remaining,
          endsAt: store.endsAt,
          cycle: store.cycle,
          total: store.total,
          durations: store.durations,
        }))
      } catch { /* private mode or a full quota only costs persistence */ }
    }

    /** Drop the completion notice after a moment, replacing any pending one. */
    function scheduleNoticeClear() {
      if (noticeTimer) {
        const previous = noticeTimer
        noticeTimer = null
        try { previous() } catch { /* ignore */ }
      }
      noticeTimer = later(() => {
        noticeTimer = null
        store.notice = null
        emit()
      }, 7000)
    }

    /** The phase a finished (or skipped) phase leads into. */
    function nextPhase(done, cycle) {
      if (done !== 'focus') return 'focus'
      return cycle > 0 && cycle % 4 === 0 ? 'long' : 'short'
    }

    /**
     * Move to the next phase.
     * @param options.count - count the finished round (false for a manual skip).
     * @param options.autostart - start the next phase immediately.
     * @param options.silent - skip the chime and the notice (restore, skip).
     */
    function advance(options) {
      const config = options || {}
      const done = store.phase
      stopTicker()
      if (config.count !== false && done === 'focus') {
        store.cycle += 1
        store.total += 1
      }
      const next = nextPhase(done, store.cycle)
      store.phase = next
      store.remaining = store.durations[next]
      store.running = config.autostart === true
      store.endsAt = store.running ? Date.now() + store.remaining * 1000 : 0
      if (store.running) startTicker()
      if (config.silent) {
        store.notice = null
      } else {
        store.notice = { done, next, at: Date.now() }
        chime(done === 'focus')
        scheduleNoticeClear()
      }
      persist()
      emit()
    }

    /** Start (or resume) the current phase. */
    function start() {
      if (store.running) return
      primeAudio()
      if (store.remaining <= 0) store.remaining = store.durations[store.phase]
      store.running = true
      store.endsAt = Date.now() + store.remaining * 1000
      store.notice = null
      startTicker()
      persist()
      emit()
    }

    /** Freeze the current phase where it stands. */
    function pause() {
      if (!store.running) return
      store.remaining = Math.max(0, Math.ceil((store.endsAt - Date.now()) / 1000))
      store.running = false
      store.endsAt = 0
      stopTicker()
      persist()
      emit()
    }

    /** Start or pause, whichever the current state calls for. */
    function toggleRun() {
      if (store.running) pause()
      else start()
    }

    /** Return the current phase to its full length. */
    function reset() {
      stopTicker()
      store.running = false
      store.endsAt = 0
      store.remaining = store.durations[store.phase]
      store.notice = null
      persist()
      emit()
    }

    /** Jump to the next phase without counting the current one. */
    function skip() {
      const wasRunning = store.running
      advance({ count: false, autostart: wasRunning, silent: true })
    }

    /** Switch phases by hand, paused at that phase's full length. */
    function selectPhase(phase) {
      if (!PHASES.includes(phase) || phase === store.phase) return
      stopTicker()
      store.phase = phase
      store.running = false
      store.endsAt = 0
      store.remaining = store.durations[phase]
      store.notice = null
      persist()
      emit()
    }

    /** Grow or shrink the current phase length, keeping it within limits. */
    function adjustDuration(delta) {
      const phase = store.phase
      const limits = LIMITS[phase]
      const next = clamp(store.durations[phase] + delta, limits[0], limits[1])
      if (next === store.durations[phase]) return
      store.durations[phase] = next
      if (!store.running) store.remaining = next
      persist()
      emit()
    }

    /** Reload the persisted store, resuming or settling a round that ran away. */
    function restore() {
      let saved = null
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { saved = null }
      if (!saved || saved.v !== 1) return

      if (saved.durations) {
        for (const phase of PHASES) {
          const value = Number(saved.durations[phase])
          const limits = LIMITS[phase]
          if (Number.isFinite(value)) {
            store.durations[phase] = clamp(Math.round(value), limits[0], limits[1])
          }
        }
      }
      if (PHASES.includes(saved.phase)) store.phase = saved.phase
      store.cycle = Math.max(0, Math.floor(Number(saved.cycle) || 0))
      store.total = Math.max(0, Math.floor(Number(saved.total) || 0))

      const remaining = Number(saved.remaining)
      if (Number.isFinite(remaining) && remaining > 0) {
        store.remaining = Math.min(Math.round(remaining), store.durations[store.phase])
      }

      if (saved.running && Number(saved.endsAt) > Date.now()) {
        store.running = true
        store.endsAt = Number(saved.endsAt)
        store.remaining = Math.max(0, Math.ceil((store.endsAt - Date.now()) / 1000))
        startTicker()
        return
      }
      if (saved.running) {
        // The round elapsed while the page was closed: settle it into the next
        // phase, paused, so the user is not dropped into a running break.
        store.remaining = 0
        advance({ count: true, autostart: false, silent: true })
      }
    }

    /**
     * Resolve the slot's `t` with a browser-language fallback and `{name}`
     * interpolation, so a missing locale share cannot blank the UI.
     * @param t - the registration translator, when the locale service shared one.
     * @returns a key lookup taking optional interpolation values.
     */
    const fallbackDict = String(navigator.language || '').toLowerCase().startsWith('zh') ? zh : en
    function translator(t) {
      return (key, values) => {
        let text = fallbackDict[key] ?? key
        if (typeof t === 'function') {
          const shared = t(key)
          if (typeof shared === 'string' && shared !== '' && shared !== key) text = shared
        }
        if (values) {
          text = String(text).replace(/\{(\w+)\}/g, (match, name) => (
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
          ))
        }
        return text
      }
    }

    const CSS = `
      /* Seat: the column cell inserted just above the footer action row, so the
         button is a full-width row instead of a clipped second cell beside the
         clock. In the rail the shell centres the foot column, so it shrinks. */
      .dsp-seat { display: flex; flex-direction: column; flex: none; width: 100%; min-width: 0; }
      .dsp-seat[data-rail] { width: auto; align-items: center; }
      /* Footer row: the 42px foot rhythm shared with the clock, 36px in the rail. */
      .dsp-layer { position: relative; flex: none; display: flex; align-items: center; width: 100%; height: 42px; margin: 8px 0 0; }
      .dsp-button { display: flex; align-items: center; gap: 10px; width: calc(100% + 4px); height: 42px; margin: 0 -2px; padding: 0 10px 0 8px; box-sizing: border-box; border: none; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer; overflow: hidden; }
      .dsp-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsp-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
      .dsp-button-icon { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; color: var(--dsw-alias-label-secondary); }
      .dsp-button:hover .dsp-button-icon { color: var(--dsw-alias-label-primary); }
      .dsp-button-icon[data-running] { color: var(--dsw-alias-brand-primary); }
      .dsp-live { position: absolute; right: -1px; top: -1px; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 2px var(--dsw-specific-sidebar-fill); animation: dsp-pulse 2s ease-in-out infinite; }
      .dsp-button-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsp-button-time { flex: none; margin-left: auto; padding-left: 8px; font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; color: var(--dsw-alias-label-tertiary); }
      .dsp-button-time[data-break] { color: var(--dsw-alias-state-success-primary); }
      .dsp-layer[data-rail] { width: 36px; height: 36px; margin: 0; }
      .dsp-layer[data-rail] .dsp-button { justify-content: center; gap: 0; width: 36px; height: 36px; margin: 0; padding: 0; border-radius: 50%; }
      .dsp-layer[data-rail] .dsp-button-label, .dsp-layer[data-rail] .dsp-button-time { display: none; }
      @keyframes dsp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

      /* Timer page: a full-viewport sheet inside the frame-wide overlay layer. */
      .dsp-page { --dsp-accent: var(--dsw-alias-brand-primary); position: fixed; inset: 0; z-index: 62; display: flex; flex-direction: column; box-sizing: border-box; overflow: auto; pointer-events: auto; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family), system-ui, sans-serif; background: radial-gradient(80% 62% at 50% 0%, color-mix(in srgb, var(--dsp-accent) 15%, transparent), transparent 62%), var(--dsw-alias-bg-layer-1); }
      .dsp-page[data-phase="short"], .dsp-page[data-phase="long"] { --dsp-accent: var(--dsw-alias-state-success-primary); }
      .dsp-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 56px; padding: 0 14px 0 20px; box-sizing: border-box; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .dsp-heading { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
      .dsp-heading-icon { display: inline-flex; color: var(--dsp-accent); }
      .dsp-close { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: none; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .dsp-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsp-close:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsp-body { flex: 1; display: flex; align-items: center; justify-content: center; padding: 28px 20px 52px; }
      .dsp-plate { display: flex; flex-direction: column; align-items: center; gap: 16px; width: min(420px, 100%); padding: 24px 26px 20px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 24px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 82%, transparent); box-shadow: var(--dsw-shadow-lv2); }
      .dsp-tabs { display: flex; gap: 2px; padding: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 60%, transparent); }
      .dsp-tab { padding: 6px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 18px; white-space: nowrap; cursor: pointer; }
      .dsp-tab:hover { color: var(--dsw-alias-label-primary); }
      .dsp-tab[data-active] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv1); }
      .dsp-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dsp-dial { position: relative; display: flex; align-items: center; justify-content: center; width: 216px; height: 216px; margin: 2px 0; }
      .dsp-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
      .dsp-ring-track { fill: none; stroke: var(--dsw-alias-border-l1); stroke-width: 9; }
      .dsp-ring-value { fill: none; stroke: var(--dsp-accent); stroke-width: 9; stroke-linecap: round; transition: stroke-dashoffset 240ms linear; }
      .dsp-dial-center { display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .dsp-time { font-size: 50px; font-weight: 600; line-height: 1; letter-spacing: 0.01em; font-variant-numeric: tabular-nums; }
      .dsp-time-label { font-size: 11px; line-height: 14px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
      .dsp-dots { display: flex; align-items: center; gap: 8px; height: 10px; }
      .dsp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-border-l2); }
      .dsp-dot[data-on] { background: var(--dsp-accent); }
      .dsp-controls { display: flex; align-items: center; gap: 10px; }
      .dsp-primary { min-width: 118px; height: 40px; padding: 0 22px; border: 0; border-radius: 999px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
      .dsp-primary:hover { background: var(--dsw-alias-button-primary-hover); }
      .dsp-primary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsp-ghost { height: 40px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
      .dsp-ghost:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsp-ghost:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsp-stepper { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
      .dsp-step { width: 22px; height: 22px; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; line-height: 1; cursor: pointer; }
      .dsp-step:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsp-step:disabled { opacity: 0.38; cursor: default; }
      .dsp-step:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dsp-stepper-value { min-width: 68px; text-align: center; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
      .dsp-stats { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
      .dsp-notice { min-height: 18px; font-size: 12px; line-height: 18px; color: var(--dsp-accent); opacity: 0; transition: opacity 160ms ease; }
      .dsp-notice[data-on] { opacity: 1; }
      @media (max-width: 560px) {
        .dsp-plate { padding: 20px 18px 16px; gap: 14px; }
        .dsp-dial { width: 184px; height: 184px; }
        .dsp-time { font-size: 42px; }
        .dsp-tab { padding: 6px 10px; font-size: 12px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsp-button, .dsp-close, .dsp-ring-value, .dsp-notice { transition: none; }
        .dsp-live { animation: none; }
      }
    `

    /** Tomato glyph shared by the button and the page heading. */
    function TomatoIcon({ size }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { display: 'block' },
        },
        h('path', { d: 'M8 4.4c2.9 0 5 2.1 5 4.9 0 3.1-2.2 5-5 5s-5-1.9-5-5c0-2.8 2.1-4.9 5-4.9Z' }),
        h('path', { d: 'M8 4.4V2.6' }),
        h('path', { d: 'M8 2.9c1-.7 2.2-.8 3.1-.5-.5.8-1.5 1.4-2.6 1.4' }),
      )
    }

    /**
     * Locate, and keep, a seat in the sidebar foot directly above the footer
     * action row.
     *
     * `sidebar.footer.action` renders its occupants as the single cells of one
     * non-wrapping flex row and the clock already claims the full width, so a
     * second occupant lands beside it and is clipped by the column. The shell's
     * other footer surfaces solve this the same way: the slot entry stays an
     * anchor and the real surface is portaled into a node placed in the foot
     * column, which is a vertical stack. The node is re-asserted after shell
     * re-renders, because DOM children a slot appends are not part of the
     * shell's own reconciliation.
     *
     * @param wide - the column state, mirrored onto the seat for rail styling.
     * @returns the seat element, or null while it cannot be placed yet.
     */
    function useSeat(wide) {
      const [seat, setSeat] = React.useState(null)

      // A layout effect, so the seat exists before the first paint and the row
      // never flashes in the clipped slot cell.
      React.useLayoutEffect(() => {
        let host = null
        let observer = null
        let frame = 0
        let attempts = 0

        const schedule = () => {
          if (frame === 0) frame = window.requestAnimationFrame(place)
        }

        const place = () => {
          frame = 0
          // The action row is the preferred anchor; the foot column itself is
          // the fallback, in which case the seat goes in front of its first cell.
          const bar = document.querySelector('[class*="footerActions"]')
          let foot = null
          let anchor = null
          if (bar !== null && bar.parentElement !== null) {
            foot = bar.parentElement
            anchor = bar
          } else {
            const area = document.querySelector('[class*="footArea"]')
            if (area !== null) {
              foot = area
              anchor = area.firstElementChild
            }
          }
          if (foot === null) {
            if (host !== null) {
              host.remove()
              host = null
              setSeat(null)
            }
            if (attempts < 60) {
              attempts += 1
              frame = window.requestAnimationFrame(place)
            }
            return
          }
          if (host === null) {
            host = document.createElement('div')
            host.className = 'dsp-seat'
            host.dataset.plugin = '@local/sidebar-pomodoro'
            setSeat(host)
          }
          if (wide === false) host.setAttribute('data-rail', '')
          else host.removeAttribute('data-rail')
          if (anchor === null) {
            if (host.parentElement !== foot) foot.appendChild(host)
          } else if (anchor !== host && (host.parentElement !== foot || host.nextElementSibling !== anchor)) {
            foot.insertBefore(host, anchor)
          }
          if (observer === null) {
            observer = new MutationObserver(schedule)
            observer.observe(foot, { childList: true })
            if (foot.parentElement !== null) {
              observer.observe(foot.parentElement, { childList: true })
            }
          }
        }

        place()
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame)
          if (observer !== null) observer.disconnect()
          if (host !== null) host.remove()
        }
      }, [wide])

      return seat
    }

    /**
     * The footer button; `wide` is false in the collapsed rail. It renders into
     * the seat when one could be placed, and inline in the slot otherwise so the
     * control never disappears.
     * @param props - slot props `{ wide }` plus the locale `t`.
     */
    function PomodoroButton({ wide, t }) {
      const seat = useSeat(wide)
      const row = h(FooterRow, { wide, t })
      return seat === null ? row : ReactDOM.createPortal(row, seat)
    }

    /**
     * The button row itself.
     * @param props - the column state plus the locale `t`.
     */
    function FooterRow({ wide, t }) {
      const label = translator(t)
      const snapshot = useStore()
      const time = formatTime(snapshot.remaining)
      const title = snapshot.running
        ? `${label('title')} · ${time}`
        : label('title')
      return h(
        'div',
        {
          className: 'dsp-layer',
          'data-rail': wide === false ? '' : undefined,
          'data-plugin': '@local/sidebar-pomodoro',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'dsp-button',
            'aria-label': title,
            'aria-haspopup': 'dialog',
            title,
            onClick: () => { setOpen(true) },
          },
          h(
            'span',
            { className: 'dsp-button-icon', 'data-running': snapshot.running ? '' : undefined },
            h(TomatoIcon, { size: wide === false ? 18 : 16 }),
            snapshot.running ? h('span', { className: 'dsp-live' }) : null,
          ),
          h('span', { className: 'dsp-button-label' }, label('label')),
          snapshot.running
            ? h('span', { className: 'dsp-button-time', 'data-break': snapshot.phase !== 'focus' ? '' : undefined }, time)
            : null,
        ),
      )
    }

    /**
     * The timer page. Mounted in `shell.overlay`, renders nothing while closed.
     * @param props - slot props plus the locale `t`.
     */
    function PomodoroPage({ t }) {
      const label = translator(t)
      const openNow = useOpen()
      const snapshot = useStore()
      const closeRef = React.useRef(null)

      React.useEffect(() => {
        if (!openNow) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => { document.removeEventListener('keydown', onKeyDown, true) }
      }, [openNow])

      React.useEffect(() => {
        if (openNow) closeRef.current?.focus()
      }, [openNow])

      if (!openNow) return null

      const total = snapshot.durations[snapshot.phase]
      const ratio = total > 0 ? clamp(snapshot.remaining / total, 0, 1) : 0
      const circumference = 2 * Math.PI * 78
      const cycleDone = snapshot.cycle > 0 && snapshot.cycle % 4 === 0 ? 4 : snapshot.cycle % 4
      const round = Math.floor(snapshot.cycle / 4) + 1
      const primary = snapshot.running
        ? label('pause')
        : (snapshot.remaining < total ? label('resume') : label('start'))
      const limits = LIMITS[snapshot.phase]
      const noticeKey = snapshot.notice
        ? (snapshot.notice.done !== 'focus'
          ? 'noticeBreak'
          : (snapshot.notice.next === 'long' ? 'noticeLong' : 'noticeFocus'))
        : null

      return h(
        'div',
        {
          className: 'dsp-page',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': label('title'),
          'data-phase': snapshot.phase,
          'data-plugin': '@local/sidebar-pomodoro',
        },
        h(
          'header',
          { className: 'dsp-head' },
          h(
            'div',
            { className: 'dsp-heading' },
            h('span', { className: 'dsp-heading-icon' }, h(TomatoIcon, { size: 18 })),
            h('span', null, label('title')),
          ),
          h(
            'button',
            {
              ref: closeRef,
              type: 'button',
              className: 'dsp-close',
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
          { className: 'dsp-body' },
          h(
            'div',
            { className: 'dsp-plate' },
            h(
              'div',
              { className: 'dsp-tabs', role: 'tablist', 'aria-label': label('length') },
              PHASES.map((phase) => h(
                'button',
                {
                  key: phase,
                  type: 'button',
                  role: 'tab',
                  className: 'dsp-tab',
                  'aria-selected': snapshot.phase === phase ? 'true' : 'false',
                  'data-active': snapshot.phase === phase ? '' : undefined,
                  onClick: () => { selectPhase(phase) },
                },
                label(phase),
              )),
            ),
            h(
              'div',
              { className: 'dsp-dial' },
              h(
                'svg',
                { className: 'dsp-ring', viewBox: '0 0 180 180', 'aria-hidden': true },
                h('circle', { className: 'dsp-ring-track', cx: 90, cy: 90, r: 78 }),
                h('circle', {
                  className: 'dsp-ring-value',
                  cx: 90,
                  cy: 90,
                  r: 78,
                  style: {
                    strokeDasharray: circumference.toFixed(2),
                    strokeDashoffset: (circumference * (1 - ratio)).toFixed(2),
                  },
                }),
              ),
              h(
                'div',
                { className: 'dsp-dial-center' },
                h('div', { className: 'dsp-time', role: 'timer', 'aria-live': 'off' }, formatTime(snapshot.remaining)),
                h('div', { className: 'dsp-time-label' }, label(snapshot.phase)),
              ),
            ),
            h(
              'div',
              { className: 'dsp-dots', 'aria-hidden': true },
              [0, 1, 2, 3].map((index) => h('span', {
                key: index,
                className: 'dsp-dot',
                'data-on': index < cycleDone ? '' : undefined,
              })),
            ),
            h(
              'div',
              { className: 'dsp-controls' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-primary',
                  onClick: toggleRun,
                },
                primary,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-ghost',
                  onClick: reset,
                },
                label('reset'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-ghost',
                  onClick: skip,
                },
                label('skip'),
              ),
            ),
            h(
              'div',
              { className: 'dsp-stepper' },
              h('span', null, label('length')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-step',
                  'aria-label': `${label('length')} -`,
                  disabled: snapshot.durations[snapshot.phase] <= limits[0],
                  onClick: () => { adjustDuration(-STEPS[snapshot.phase]) },
                },
                '−',
              ),
              h(
                'span',
                { className: 'dsp-stepper-value' },
                `${Math.round(snapshot.durations[snapshot.phase] / 60)} ${label('minutes')}`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsp-step',
                  'aria-label': `${label('length')} +`,
                  disabled: snapshot.durations[snapshot.phase] >= limits[1],
                  onClick: () => { adjustDuration(STEPS[snapshot.phase]) },
                },
                '+',
              ),
            ),
            h(
              'div',
              { className: 'dsp-stats' },
              `${label('today', { count: snapshot.total })} · ${label('round', { round })}`,
            ),
            h(
              'div',
              { className: 'dsp-notice', 'data-on': noticeKey ? '' : undefined, 'aria-live': 'polite' },
              noticeKey ? label(noticeKey) : '',
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'timer'],
      apply(ctx) {
        runtime.interval = (callback, delay) => ctx.interval(callback, delay)
        runtime.timeout = (callback, delay) => ctx.timeout(callback, delay)

        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'sidebar-pomodoro: locale')

        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/sidebar-pomodoro'
          tag.dataset.pluginCss = '@local/sidebar-pomodoro/sidebar-pomodoro.css'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => { tag.remove() }
        }, 'sidebar-pomodoro: styles')

        ctx.effect(() => {
          restore()
          return () => {
            stopTicker()
            if (noticeTimer) {
              const dispose = noticeTimer
              noticeTimer = null
              try { dispose() } catch { /* ignore */ }
            }
          }
        }, 'sidebar-pomodoro: countdown')

        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'sidebar-pomodoro.button',
          locale: NS,
          order: 60,
        }, PomodoroButton)), 'sidebar-pomodoro: footer button')

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'sidebar-pomodoro.page',
          locale: NS,
          order: 62,
        }, PomodoroPage)), 'sidebar-pomodoro: timer page')
      },
    }
  },
})
