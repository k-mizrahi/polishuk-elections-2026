import '../style.css'
import type { Session } from '@supabase/supabase-js'
import { applyI18n, getLang, partyName, switchLang, t, type Lang } from './i18n'
import { getProfile, supabase } from './supabase'
import type { Party, Profile } from './database.types'

// ---------------------------------------------------------------- DOM helpers

type Child = Node | string | null | undefined

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v as EventListener)
    } else if (k === 'class') {
      node.className = String(v)
    } else {
      node.setAttribute(k, String(v))
    }
  }
  for (const c of children.flat()) if (c != null) node.append(c)
  return node
}

/**
 * Return the URL only if it is an http/https link, else null. Guards against
 * `javascript:`/`data:` URIs reaching an <a href> — poll source_url comes from
 * the (untrusted, openly-editable) Wikipedia scraper and is clicked by the admin.
 */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    const proto = new URL(u, location.origin).protocol
    return proto === 'http:' || proto === 'https:' ? u : null
  } catch {
    return null
  }
}

/** Mixed-direction safety: numbers/handles/URLs inside RTL text. */
export function ltr(text: string | number): HTMLElement {
  return el('span', { dir: 'ltr' }, String(text))
}

export const BTN =
  'bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl py-3 px-8 shadow-md transition'
export const BTN_SM =
  'bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl py-2 px-4 text-sm shadow-md transition'
export const BTN_GHOST =
  'bg-sky-100 hover:bg-sky-200 text-blue-900 font-bold rounded-xl py-2 px-4 text-sm transition'

export function card(...children: (Child | Child[])[]): HTMLElement {
  return el('section', { class: 'bg-white rounded-2xl shadow-xl p-6 md:p-8' }, ...children)
}

const CALLOUT = {
  amber: 'bg-amber-50 border border-amber-200 text-amber-900',
  emerald: 'bg-emerald-50 border border-emerald-200 text-emerald-900',
  red: 'bg-red-50 border border-red-200 text-red-900',
} as const

export function callout(kind: keyof typeof CALLOUT, ...children: Child[]): HTMLElement {
  return el('div', { class: `${CALLOUT[kind]} rounded-lg p-3 text-sm` }, ...children)
}

export function skeleton(lines = 3): HTMLElement {
  return el(
    'div',
    { class: 'animate-pulse space-y-3' },
    Array.from({ length: lines }, () => el('div', { class: 'h-4 bg-slate-200 rounded' })),
  )
}

export function partyChip(p: Party): HTMLElement {
  return el('span', {
    class: 'inline-block w-3 h-3 rounded-full shrink-0',
    style: `background:${p.color}`,
  })
}

// ---------------------------------------------------------------- dates & countdown

export function fmtDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const locale = getLang() === 'he' ? 'he-IL' : 'en-GB'
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    ...opts,
  }).format(new Date(iso))
}

export function fmtDateTime(iso: string): string {
  return fmtDate(iso, { hour: '2-digit', minute: '2-digit' })
}

/** Live countdown into `node`; calls onExpire once when the target passes. */
export function countdown(targetIso: string, node: HTMLElement, onExpire?: () => void): void {
  const end = new Date(targetIso).getTime()
  const tick = () => {
    const s = Math.floor((end - Date.now()) / 1000)
    if (s <= 0) {
      clearInterval(id)
      node.textContent = t('common.locked')
      onExpire?.()
      return
    }
    const d = Math.floor(s / 86400)
    const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
      .map((x) => String(x).padStart(2, '0'))
      .join(':')
    node.textContent = d > 0 ? t('common.countdownDays', { d, time: hms }) : hms
  }
  tick()
  const id = setInterval(tick, 1000)
}

// ---------------------------------------------------------------- page chrome

export interface Ctx {
  lang: Lang
  session: Session | null
  profile: Profile | null
}

const NAV = ['polls', 'dashboard', 'leaderboard', 'bets', 'archive', 'rules'] as const

function renderHeader(active: string): void {
  const nav = el(
    'nav',
    { class: 'flex flex-wrap gap-1 text-sm font-bold' },
    NAV.map((p) =>
      el(
        'a',
        {
          href: `${p}.html`,
          class:
            p === active
              ? 'bg-sky-100 text-blue-900 rounded-lg px-3 py-1.5'
              : 'text-slate-600 hover:text-blue-900 hover:bg-sky-50 rounded-lg px-3 py-1.5',
        },
        t(`nav.${p}`),
      ),
    ),
  )
  const langBtn = el(
    'button',
    {
      class: 'border border-slate-300 hover:bg-sky-50 text-slate-700 text-sm font-bold rounded-lg px-2.5 py-1.5',
      onclick: () => switchLang(getLang() === 'he' ? 'en' : 'he'),
    },
    getLang() === 'he' ? 'EN' : 'עב',
  )
  const header = el(
    'header',
    { class: 'bg-white shadow-md' },
    el(
      'div',
      { class: 'max-w-4xl mx-auto px-4 py-3 flex items-center flex-wrap gap-x-4 gap-y-2' },
      el('a', { href: 'index.html', class: 'text-blue-900 font-extrabold text-xl whitespace-nowrap' }, t('app.title')),
      nav,
      el(
        'div',
        { class: 'ms-auto flex items-center gap-2' },
        el('span', { id: 'auth-slot', class: 'text-sm font-bold' }, el('a', { href: 'login.html', class: 'text-blue-700 hover:underline' }, t('nav.login'))),
        langBtn,
      ),
    ),
  )
  document.getElementById('app-header')!.replaceWith(header)
}

function renderFooter(): void {
  const link = (href: string, label: string, dir?: string) =>
    el('a', { href, class: 'hover:text-blue-900 hover:underline', target: '_blank', rel: 'noopener', dir }, label)
  const footer = el(
    'footer',
    { class: 'mt-8 py-6 text-center text-sm text-slate-600' },
    el(
      'div',
      { class: 'max-w-4xl mx-auto px-4 flex justify-center gap-4 flex-wrap' },
      el('a', { href: 'rules.html', class: 'hover:text-blue-900 hover:underline' }, t('footer.rules')),
      link('https://github.com/k-mizrahi/polishuk-elections-2026', 'GitHub', 'ltr'),
      link('https://x.com/_kobim', '@_kobim', 'ltr'),
    ),
  )
  document.getElementById('app-footer')!.replaceWith(footer)
}

function renderBanner(): void {
  if (supabase || sessionStorage.getItem('bannerDismissed')) return
  const banner = el(
    'div',
    { class: 'bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm flex items-center gap-3' },
    el('span', { class: 'flex-1' }, t('banner.notConnected')),
    el(
      'button',
      {
        class: 'font-bold text-amber-900 hover:underline shrink-0',
        onclick: (e: Event) => {
          sessionStorage.setItem('bannerDismissed', '1')
          ;(e.target as HTMLElement).closest('div')!.remove()
        },
      },
      t('banner.dismiss'),
    ),
  )
  document.getElementById('main')!.prepend(banner)
}

function updateAuthSlot(ctx: Ctx): void {
  const slot = document.getElementById('auth-slot')
  if (!slot || !ctx.session) return
  const label = ctx.profile?.handle ?? ctx.profile?.display_name ?? t('nav.profile')
  slot.replaceChildren(
    el('a', { href: 'profile.html', class: 'text-blue-700 hover:underline' }, label),
    el(
      'button',
      {
        class: 'text-slate-500 hover:text-blue-900 text-xs ms-2',
        onclick: async () => {
          await supabase?.auth.signOut()
          location.href = 'index.html'
        },
      },
      t('nav.logout'),
    ),
  )
}

/** Render chrome (always succeeds), then resolve auth state. Every page starts here. */
export async function initPage(active: string): Promise<Ctx> {
  document.title = active === 'index' ? t('app.title') : `${t(`title.${active}`)} · ${t('app.title')}`
  renderHeader(active)
  renderFooter()
  renderBanner()
  applyI18n()
  const ctx: Ctx = { lang: getLang(), session: null, profile: null }
  if (supabase) {
    try {
      ctx.session = (await supabase.auth.getSession()).data.session
      if (ctx.session) ctx.profile = await getProfile(ctx.session.user.id)
    } catch {
      // chrome must render even when Supabase is unreachable
    }
  }
  updateAuthSlot(ctx)
  return ctx
}

// ---------------------------------------------------------------- wide tables

/** Horizontal-scroll table with a sticky first column (RTL-aware via `start-0`). */
export function wideTable(headers: (string | Node)[], rows: (string | Node)[][], opts?: { highlightFirstRow?: boolean }): HTMLElement {
  const th = (c: string | Node, sticky: boolean) =>
    el('th', { class: `px-3 py-2 text-start whitespace-nowrap font-bold text-blue-900 ${sticky ? 'sticky start-0 bg-white z-10' : ''}` }, c)
  const trs = rows.map((r, i) => {
    const hl = opts?.highlightFirstRow && i === 0
    return el(
      'tr',
      { class: hl ? 'bg-sky-100 font-bold' : 'border-t border-slate-100' },
      r.map((c, j) =>
        el('td', { class: `px-3 py-2 whitespace-nowrap ${j === 0 ? `sticky start-0 z-10 ${hl ? 'bg-sky-100' : 'bg-white'}` : ''}` }, c),
      ),
    )
  })
  return el(
    'div',
    { class: 'overflow-x-auto' },
    el('table', { class: 'w-full text-sm text-slate-700' }, el('thead', {}, el('tr', {}, headers.map((h, i) => th(h, i === 0)))), el('tbody', {}, trs)),
  )
}

// ---------------------------------------------------------------- 120-seat stepper form

export interface SeatFormHandle {
  root: HTMLElement
  values(): Record<string, number>
  setValues(v: Record<string, number>): void
  valid(): boolean
  onChange(cb: () => void): void
}

/**
 * One row per party with − / + steppers; sticky sum bar; 1–3 invalid per the
 * DB check (seats = 0 or seats >= 4). Steppers jump the invalid gap: 0 ⇄ 4.
 */
export function seatForm(parties: Party[], initial: Record<string, number>, readOnly = false): SeatFormHandle {
  const inputs = new Map<string, HTMLInputElement>()
  const rowEls = new Map<string, { row: HTMLElement; hint: HTMLElement }>()
  const listeners: (() => void)[] = []

  const sumBar = el('div', { class: 'sticky top-0 z-20 rounded-lg font-bold text-center py-2 px-3 mb-2' })

  const rowValue = (code: string) => {
    const n = parseInt(inputs.get(code)!.value, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  const rowValid = (v: number) => v === 0 || v >= 4

  function refresh(): void {
    let sum = 0
    let allValid = true
    for (const [code, { row, hint }] of rowEls) {
      const v = rowValue(code)
      sum += v
      const ok = rowValid(v)
      allValid &&= ok
      row.classList.toggle('bg-red-50', !ok)
      inputs.get(code)!.classList.toggle('border-red-400', !ok)
      hint.classList.toggle('hidden', ok)
    }
    const exact = sum === 120
    sumBar.className = `sticky top-0 z-20 rounded-lg font-bold text-center py-2 px-3 mb-2 ${
      exact && allValid ? 'bg-emerald-100 text-emerald-800' : sum > 120 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
    }`
    sumBar.textContent =
      sum > 120
        ? t('bets.sumOver', { sum, n: sum - 120 })
        : exact
          ? t('bets.sumExact')
          : t('bets.sumUnder', { sum, n: 120 - sum })
    listeners.forEach((cb) => cb())
  }

  const step = (code: string, dir: 1 | -1) => {
    const v = rowValue(code)
    // skip the invalid 1–3 band
    const next = dir === 1 ? (v < 4 ? 4 : v + 1) : v <= 4 ? 0 : v - 1
    inputs.get(code)!.value = String(next)
    refresh()
  }

  const stepBtn = (label: string, onclick: () => void) =>
    el('button', { type: 'button', class: 'w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-lg shrink-0', onclick }, label)

  const rows = parties.map((p) => {
    const input = el('input', {
      type: 'number',
      min: '0',
      dir: 'ltr',
      inputmode: 'numeric',
      value: String(initial[p.code] ?? 0),
      disabled: readOnly,
      class: 'w-14 text-center border border-slate-300 rounded-lg py-1.5 font-bold text-slate-800 disabled:bg-slate-50',
      onfocus: (e: Event) => (e.target as HTMLInputElement).select(),
      oninput: refresh,
    })
    inputs.set(p.code, input)
    const hint = el('span', { class: 'text-red-600 text-xs hidden' }, t('bets.rowHint'))
    const row = el(
      'div',
      { class: 'flex items-center gap-3 py-2 border-b border-slate-100 rounded-lg px-1' },
      partyChip(p),
      el('span', { class: 'flex-1 text-slate-800 font-medium' }, partyName(p), ' ', hint),
      readOnly ? null : stepBtn('−', () => step(p.code, -1)),
      input,
      readOnly ? null : stepBtn('+', () => step(p.code, 1)),
    )
    rowEls.set(p.code, { row, hint })
    return row
  })

  const root = el('div', {}, sumBar, el('div', {}, rows))
  refresh()

  return {
    root,
    values: () => Object.fromEntries([...inputs.keys()].map((c) => [c, rowValue(c)])),
    setValues(v) {
      for (const [c, input] of inputs) input.value = String(v[c] ?? 0)
      refresh()
    },
    valid: () => [...inputs.keys()].every((c) => rowValid(rowValue(c))) && [...inputs.keys()].reduce((s, c) => s + rowValue(c), 0) === 120,
    onChange: (cb) => listeners.push(cb),
  }
}

/**
 * Round a fractional seat vector to a valid 120 bet: largest-remainder to hit
 * 120, then push values in the illegal 1–3 band to 0/4 and rebalance on the
 * biggest parties.
 */
export function roundTo120(fractional: Record<string, number>, codes: string[]): Record<string, number> {
  const vals = codes.map((c) => Math.max(0, fractional[c] ?? 0))
  const floors = vals.map(Math.floor)
  let deficit = 120 - floors.reduce((a, b) => a + b, 0)
  const byRemainder = codes
    .map((_, i) => i)
    .sort((a, b) => (vals[b] - floors[b]) - (vals[a] - floors[a]))
  for (const i of byRemainder) {
    if (deficit <= 0) break
    floors[i] += 1
    deficit -= 1
  }
  // fix the 1–3 band
  for (let i = 0; i < floors.length; i++) {
    if (floors[i] >= 1 && floors[i] <= 3) floors[i] = floors[i] >= 3 ? 4 : 0
  }
  // rebalance to exactly 120 on the largest parties (keeping every value valid)
  let diff = floors.reduce((a, b) => a + b, 0) - 120
  const bigFirst = codes.map((_, i) => i).sort((a, b) => floors[b] - floors[a])
  while (diff !== 0) {
    let moved = false
    for (const i of bigFirst) {
      if (diff > 0 && floors[i] >= 5) {
        floors[i] -= 1
        diff -= 1
        moved = true
      } else if (diff < 0 && floors[i] >= 4) {
        floors[i] += 1
        diff += 1
        moved = true
      }
      if (diff === 0) break
    }
    if (!moved) break // degenerate vector; leave best effort
  }
  return Object.fromEntries(codes.map((c, i) => [c, floors[i]]))
}
