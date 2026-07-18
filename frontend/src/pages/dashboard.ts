import { partyName, t } from '../lib/i18n'
import { fetchParties, supabase } from '../lib/supabase'
import { callout, card, el, fmtDate, initPage, partyChip, skeleton } from '../lib/ui'
import type { Poll, PollResult } from '../lib/database.types'

type PollWithResults = Poll & { poll_results: PollResult[] }
type Mode = 'parties' | 'block'

/** A line on the chart: label + color + a per-poll value. */
type Series = { label: string; color: string; value: (p: PollWithResults) => number }

/** One chart point: all selected-pollster polls of one Friday-to-Friday week. */
type WeekBucket = { start: number; label: string; polls: PollWithResults[] }

const root = document.getElementById('root')!
await initPage('dashboard')

if (!supabase) {
  root.replaceChildren(card(skeleton(8)))
} else {
  try {
    await render()
  } catch {
    root.replaceChildren(callout('red', t('common.loadError')))
  }
}

/** seats a party gets in a poll (below-threshold / absent → 0), matching the average rule. */
function seatsOf(poll: PollWithResults, partyId: number): number {
  const r = poll.poll_results.find((x) => x.party_id === partyId)
  if (!r || r.below_threshold) return 0
  return Number(r.seats)
}

/** Group polls into Friday-to-Friday weeks (the game's average window), oldest first. */
function weekBuckets(polls: PollWithResults[]): WeekBucket[] {
  const byStart = new Map<number, PollWithResults[]>()
  for (const p of polls) {
    const d = new Date(p.fieldwork_end)
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() - 5 + 7) % 7))
    byStart.set(start, [...(byStart.get(start) ?? []), p])
  }
  return [...byStart.entries()]
    .map(([start, ps]) => ({ start, label: t('dashboard.weekOf', { date: fmtDate(new Date(start).toISOString()) }), polls: ps }))
    .sort((a, b) => a.start - b.start)
}

async function render(): Promise<void> {
  const [parties, { data, error }] = await Promise.all([
    fetchParties(),
    supabase!
      .from('polls')
      .select('*, poll_results(*)')
      .eq('status', 'approved')
      .order('fieldwork_end', { ascending: true }),
  ])
  if (error) throw error
  const polls = (data ?? []) as PollWithResults[]

  if (!polls.length) {
    root.replaceChildren(card(el('p', { class: 'text-slate-600' }, t('polls.empty'))))
    return
  }

  const pollsters = [...new Set(polls.map((p) => p.pollster))].sort()
  const usedIds = new Set(polls.flatMap((p) => p.poll_results.map((r) => r.party_id)))
  const partyCols = parties.filter((p) => usedIds.has(p.id))

  // --- selection state; party selection is per-mode (lines default all, bloc starts empty)
  let mode: Mode = 'parties'
  const pollsterSel = new Set(pollsters)
  const partySel = new Set(partyCols.map((p) => p.id))
  const blockSel = new Set<number>()

  const toggle = el('div', { class: 'inline-flex rounded-xl bg-slate-100 p-1' })
  const filtersHost = el('div', { class: 'space-y-4' })
  const chartHost = el('div', {})
  const rerender = () => {
    renderToggle()
    renderFilters()
    renderChart()
  }

  function renderToggle(): void {
    const mk = (m: Mode, label: string) =>
      el(
        'button',
        {
          class: `rounded-lg px-4 py-1.5 text-sm font-bold transition ${m === mode ? 'bg-white text-blue-900 shadow' : 'text-slate-600 hover:text-blue-900'}`,
          onclick: () => { mode = m; rerender() },
        },
        label,
      )
    toggle.replaceChildren(mk('parties', t('dashboard.modeParties')), mk('block', t('dashboard.modeBlock')))
  }

  const chipBtn = (on: boolean, onclick: () => void, ...content: (Node | string)[]) =>
    el(
      'button',
      {
        class: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition ${
          on ? 'bg-sky-100 border-sky-300 text-blue-900' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
        }`,
        onclick,
      },
      ...content,
    )

  function filterGroup(label: string, chips: Node[], onAll: () => void, onClear: () => void): HTMLElement {
    const small = (txt: string, onclick: () => void) =>
      el('button', { class: 'text-xs font-bold text-blue-700 hover:underline', onclick }, txt)
    return el(
      'div',
      {},
      el(
        'div',
        { class: 'flex items-center gap-3 mb-1.5' },
        el('span', { class: 'text-sm font-bold text-blue-900' }, label),
        small(t('dashboard.selectAll'), onAll),
        small(t('dashboard.clear'), onClear),
      ),
      el('div', { class: 'flex flex-wrap gap-1.5' }, chips),
    )
  }

  function renderFilters(): void {
    const refresh = () => { renderFilters(); renderChart() }
    const pollsterChips = pollsters.map((name) =>
      chipBtn(
        pollsterSel.has(name),
        () => { pollsterSel.has(name) ? pollsterSel.delete(name) : pollsterSel.add(name); refresh() },
        name,
      ),
    )
    const sel = mode === 'parties' ? partySel : blockSel
    const partyChips = partyCols.map((p) =>
      chipBtn(
        sel.has(p.id),
        () => { sel.has(p.id) ? sel.delete(p.id) : sel.add(p.id); refresh() },
        partyChip(p),
        partyName(p),
      ),
    )
    filtersHost.replaceChildren(
      filterGroup(
        t('dashboard.pollsters'),
        pollsterChips,
        () => { pollsters.forEach((n) => pollsterSel.add(n)); refresh() },
        () => { pollsterSel.clear(); refresh() },
      ),
      filterGroup(
        mode === 'parties' ? t('dashboard.parties') : t('dashboard.blockParties'),
        partyChips,
        () => { partyCols.forEach((p) => sel.add(p.id)); refresh() },
        () => { sel.clear(); refresh() },
      ),
    )
  }

  function renderChart(): void {
    const shown = polls.filter((p) => pollsterSel.has(p.pollster))
    if (!shown.length) {
      chartHost.replaceChildren(callout('amber', t('dashboard.noMatch')))
      return
    }
    const buckets = weekBuckets(shown)
    const count = el('p', { class: 'text-sm text-slate-500 mb-2' }, t('dashboard.nPolls', { n: shown.length }))

    if (mode === 'parties') {
      const cols = partyCols.filter((p) => partySel.has(p.id))
      if (!cols.length) {
        chartHost.replaceChildren(callout('amber', t('dashboard.pickParties')))
        return
      }
      const series = cols.map((c): Series => ({ label: partyName(c), color: c.color, value: (p) => seatsOf(p, c.id) }))
      chartHost.replaceChildren(count, trendChart(buckets, series))
    } else {
      if (!blockSel.size) {
        chartHost.replaceChildren(callout('amber', t('dashboard.blockHint')))
        return
      }
      const sum: Series = {
        label: t('dashboard.blockSum'),
        color: '#1e3a8a',
        value: (p) => [...blockSel].reduce((s, id) => s + seatsOf(p, id), 0),
      }
      chartHost.replaceChildren(count, trendChart(buckets, [sum], { majority: true, endLabel: true }))
    }
  }

  rerender()
  root.replaceChildren(card(el('div', { class: 'mb-4' }, toggle), filtersHost), card(chartHost))
}

// ---------------------------------------------------------------- SVG trend chart

// no `const SVGNS` here: this function is called during the module's top-level
// `await render()`, before consts below the await would initialize (TDZ).
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  for (const c of kids) n.append(c)
  return n
}

/** One line per series over time (x = week start, y = weekly average seats of the
 *  bucket's polls); native tooltips on points. `majority` draws a dashed guide at
 *  61; `endLabel` prints the last value. Rendered LTR so time reads oldest→newest
 *  regardless of page direction. */
function trendChart(buckets: WeekBucket[], series: Series[], opts: { majority?: boolean; endLabel?: boolean } = {}): HTMLElement {
  const avg = (b: WeekBucket, sr: Series) => b.polls.reduce((s2, p) => s2 + sr.value(p), 0) / b.polls.length

  const W = 820, H = 380, M = { top: 16, right: 16, bottom: 34, left: 34 }
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom
  const t0 = buckets[0].start, t1 = buckets[buckets.length - 1].start
  const rawMax = Math.max(opts.majority ? 65 : 5, ...buckets.flatMap((b) => series.map((sr) => avg(b, sr))))
  const yMax = Math.ceil(rawMax / 5) * 5
  const gridStep = yMax > 60 ? 10 : 5
  const x = (tt: number) => M.left + (t1 === t0 ? iw / 2 : ((tt - t0) / (t1 - t0)) * iw)
  const y = (v: number) => M.top + ih - (v / yMax) * ih

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-auto', role: 'img' })

  // y gridlines + labels
  for (let v = 0; v <= yMax; v += gridStep) {
    svg.append(s('line', { x1: M.left, y1: y(v), x2: W - M.right, y2: y(v), stroke: '#e2e8f0' }))
    svg.append(s('text', { x: M.left - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#94a3b8' }, String(v)))
  }
  // x date ticks (~5)
  const nTicks = Math.min(5, buckets.length)
  for (let i = 0; i < nTicks; i++) {
    const tt = t0 + ((t1 - t0) * i) / Math.max(1, nTicks - 1)
    svg.append(s('text', { x: x(tt), y: H - 12, 'text-anchor': 'middle', 'font-size': 11, fill: '#94a3b8' }, fmtDate(new Date(tt).toISOString())))
  }

  // 61-seat majority guide
  if (opts.majority) {
    svg.append(s('line', { x1: M.left, y1: y(61), x2: W - M.right, y2: y(61), stroke: '#64748b', 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }))
    svg.append(s('text', { x: M.left + 4, y: y(61) - 5, 'font-size': 11, 'font-weight': 'bold', fill: '#64748b' }, '61'))
  }

  // one polyline (+ dots with native tooltips) per series
  const lineByLabel = new Map<string, SVGGElement>()
  for (const sr of series) {
    const g = s('g', {}) as SVGGElement
    const pointsStr = buckets.map((b) => `${x(b.start)},${y(avg(b, sr))}`).join(' ')
    g.append(s('polyline', { points: pointsStr, fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }))
    for (const b of buckets) {
      const v = avg(b, sr)
      g.append(
        s('circle', { cx: x(b.start), cy: y(v), r: 3, fill: sr.color },
          s('title', {}, `${b.label} · ${t('dashboard.tipPolls', { n: b.polls.length })} · ${Number(v.toFixed(1))}`)),
      )
    }
    svg.append(g)
    lineByLabel.set(sr.label, g)
  }

  // last value, printed at the line's end
  if (opts.endLabel) {
    const last = buckets[buckets.length - 1]
    const v = avg(last, series[0])
    svg.append(s('text', { x: x(last.start) - 8, y: y(v) - 10, 'text-anchor': 'end', 'font-size': 14, 'font-weight': 'bold', fill: series[0].color }, String(Number(v.toFixed(1)))))
  }

  const setHighlight = (label: string | null) => {
    for (const [l, g] of lineByLabel) g.setAttribute('opacity', label == null || l === label ? '1' : '0.12')
  }

  // legend with hover-highlight (single series needs no legend)
  const legend =
    series.length < 2
      ? null
      : el(
          'div',
          { class: 'flex flex-wrap gap-x-4 gap-y-1.5 mt-4', onmouseleave: () => setHighlight(null) },
          series.map((sr) =>
            el(
              'span',
              {
                class: 'inline-flex items-center gap-1.5 text-sm text-slate-700 cursor-default',
                onmouseenter: () => setHighlight(sr.label),
              },
              el('span', { class: 'inline-block w-3 h-3 rounded-full shrink-0', style: `background:${sr.color}` }),
              sr.label,
            ),
          ),
        )

  return el('div', {}, el('div', { dir: 'ltr', class: 'overflow-x-auto' }, svg), legend)
}
