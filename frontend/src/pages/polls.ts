import { partyName, t } from '../lib/i18n'
import { activeParties, fetchParties, fetchWeeks, supabase } from '../lib/supabase'
import { callout, card, el, fmtDate, initPage, ltr, partyChip, skeleton, wideTable } from '../lib/ui'
import type { Party, Poll, PollResult } from '../lib/database.types'

type PollWithResults = Poll & { poll_results: PollResult[] }

/** One chart point: every approved poll whose fieldwork ended in one Sunday-to-Saturday week. */
type WeekBucket = { start: number; label: string; polls: PollWithResults[] }

/** The chart always shows the last four weekly averages — a fixed point count
 *  rather than a date window, so it never empties out during a scraping gap and
 *  never silently narrows to one or two points. Fewer are drawn only when the
 *  data does not go back that far. */
const CHART_POINTS = 4
const TABLE_POLLS = 60

/** The Sunday on or before a UTC instant — the start of its game week. */
function weekStartOf(ms: number): number {
  const d = new Date(ms)
  // getUTCDay(): Sun=0 … Sat=6, so the day index is itself the offset back to Sunday.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay())
}

const root = document.getElementById('root')!
await initPage('polls')

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

/** Group polls into Sunday-to-Saturday weeks — the same window the scoring average
 *  uses (docs/02 §2) — oldest first. Keyed off fieldwork_end rather than
 *  game_week_id, because polls fielded outside the game's schedule have no
 *  game_week_id and would silently vanish from the chart. */
function weekBuckets(polls: PollWithResults[]): WeekBucket[] {
  const byStart = new Map<number, PollWithResults[]>()
  for (const p of polls) {
    const start = weekStartOf(new Date(p.fieldwork_end).getTime())
    byStart.set(start, [...(byStart.get(start) ?? []), p])
  }
  return [...byStart.entries()]
    .map(([start, ps]) => ({ start, label: t('dashboard.weekOf', { date: fmtDate(new Date(start).toISOString()) }), polls: ps }))
    .sort((a, b) => a.start - b.start)
}

async function render(): Promise<void> {
  // Every approved poll, not a page of them: a weekly average computed from a
  // truncated week is simply wrong, and a `limit` cuts mid-week. The table view
  // still shows only the most recent TABLE_POLLS rows.
  const [parties, weeks, { data, error }] = await Promise.all([
    fetchParties(),
    fetchWeeks(),
    supabase!
      .from('polls')
      .select('*, poll_results(*)')
      .eq('status', 'approved')
      .order('fieldwork_end', { ascending: false }),
  ])
  if (error) throw error
  const polls = (data ?? []) as PollWithResults[]

  if (!polls.length) {
    root.replaceChildren(card(el('p', { class: 'text-slate-600' }, t('polls.empty'))))
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const currentWeek =
    weeks.find((w) => w.status === 'open') ??
    weeks.find((w) => w.week_start <= today && w.week_end >= today)

  // columns: currently-active parties plus any party appearing in a fetched poll
  const usedIds = new Set(polls.flatMap((p) => p.poll_results.map((r) => r.party_id)))
  const columns = parties.filter(
    (p) => usedIds.has(p.id) || (currentWeek && activeParties([p], currentWeek).length > 0),
  )

  // current week's running average (client-side, from approved polls)
  const weekPolls = currentWeek ? polls.filter((p) => p.game_week_id === currentWeek.id) : []
  const avgLabel = weekPolls.length ? t('polls.avgRow', { n: weekPolls.length }) : t('polls.avgNone')

  // --- view toggle: trend chart (default) / detailed table
  let view: 'chart' | 'table' = 'chart'
  const host = el('div', {})
  const toggle = el('div', { class: 'inline-flex rounded-xl bg-slate-100 p-1 mb-4' })

  // The last CHART_POINTS weeks that actually have polls — counted, not dated,
  // so a gap in ingest shortens the span the chart covers rather than emptying
  // it. `polls` is non-empty here, so there is always at least one point.
  const buckets = weekBuckets(polls).slice(-CHART_POINTS)

  const renderView = () => {
    host.replaceChildren(
      view === 'chart'
        ? trendChart(buckets, columns)
        : detailTable(polls.slice(0, TABLE_POLLS), columns, weekPolls, avgLabel),
    )
  }
  const renderToggle = () => {
    const mk = (v: 'chart' | 'table', label: string) =>
      el(
        'button',
        {
          class: `rounded-lg px-4 py-1.5 text-sm font-bold transition ${v === view ? 'bg-white text-blue-900 shadow' : 'text-slate-600 hover:text-blue-900'}`,
          onclick: () => { view = v; renderToggle(); renderView() },
        },
        label,
      )
    toggle.replaceChildren(mk('chart', t('polls.viewChart')), mk('table', t('polls.viewTable')))
  }
  renderToggle()
  renderView()

  root.replaceChildren(
    card(
      el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-1' }, toggle, el('span', { class: 'text-sm text-slate-500' }, avgLabel)),
      host,
    ),
  )
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

/** One line per party over time (x = week start, y = that week's average seats).
 *  Hovering a legend chip highlights that party's line; hovering — or, on touch,
 *  tapping — a point opens a card naming the polls that went into the average.
 *  Rendered LTR so time reads oldest→newest regardless of page direction. */
function trendChart(buckets: WeekBucket[], columns: Party[]): HTMLElement {
  const avg = (b: WeekBucket, partyId: number) =>
    b.polls.reduce((sum, p) => sum + seatsOf(p, partyId), 0) / b.polls.length

  const W = 820, H = 380, M = { top: 16, right: 16, bottom: 34, left: 34 }
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom
  const t0 = buckets[0].start, t1 = buckets[buckets.length - 1].start
  const yMax = Math.max(5, Math.ceil(Math.max(...buckets.flatMap((b) => columns.map((c) => avg(b, c.id)))) / 5) * 5)
  const x = (tt: number) => M.left + (t1 === t0 ? iw / 2 : ((tt - t0) / (t1 - t0)) * iw)
  const y = (v: number) => M.top + ih - (v / yMax) * ih

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-auto', role: 'img' })

  // y gridlines + labels
  for (let v = 0; v <= yMax; v += 5) {
    svg.append(s('line', { x1: M.left, y1: y(v), x2: W - M.right, y2: y(v), stroke: '#e2e8f0' }))
    svg.append(s('text', { x: M.left - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#94a3b8' }, String(v)))
  }
  // x date ticks (~5)
  const nTicks = Math.min(5, buckets.length)
  for (let i = 0; i < nTicks; i++) {
    const tt = t0 + ((t1 - t0) * i) / Math.max(1, nTicks - 1)
    // The end ticks sit on the plot edges, so a centred label overflows the
    // viewBox and gets clipped ("2.8.202"). Anchor them inward instead.
    const anchor = i === 0 ? 'start' : i === nTicks - 1 ? 'end' : 'middle'
    svg.append(s('text', { x: x(tt), y: H - 12, 'text-anchor': anchor, 'font-size': 11, fill: '#94a3b8' }, fmtDate(new Date(tt).toISOString())))
  }

  const tip = el('div', {
    class: 'absolute z-10 hidden max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-sm pointer-events-none',
  })

  // one polyline (+ dots) per party
  const lineByCode = new Map<string, SVGGElement>()
  for (const c of columns) {
    const g = s('g', { 'data-code': c.code }) as SVGGElement
    const pointsStr = buckets.map((b) => `${x(b.start)},${y(avg(b, c.id))}`).join(' ')
    g.append(s('polyline', { points: pointsStr, fill: 'none', stroke: c.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }))
    for (const b of buckets) {
      const cx = x(b.start), cy = y(avg(b, c.id))
      g.append(s('circle', { cx, cy, r: 3, fill: c.color }))
      // A separate, invisible, larger hit area: a 3px dot is not a usable hover
      // target and is far below the ~44px touch target a phone needs.
      const hit = s('circle', { cx, cy, r: 11, fill: 'transparent', class: 'cursor-pointer' })
      const open = (ev: MouseEvent) => showTip(ev, b, c)
      hit.addEventListener('mouseenter', open)
      hit.addEventListener('click', open)
      hit.addEventListener('mouseleave', hideTip)
      g.append(hit)
    }
    svg.append(g)
    lineByCode.set(c.code, g)
  }

  const setHighlight = (code: string | null) => {
    for (const [c, g] of lineByCode) g.setAttribute('opacity', code == null || c === code ? '1' : '0.12')
  }

  // legend with hover-highlight
  const legend = el(
    'div',
    { class: 'flex flex-wrap gap-x-4 gap-y-1.5 mt-4', onmouseleave: () => setHighlight(null) },
    columns.map((c) =>
      el(
        'span',
        {
          class: 'inline-flex items-center gap-1.5 text-sm text-slate-700 cursor-default',
          onmouseenter: () => setHighlight(c.code),
        },
        partyChip(c),
        partyName(c),
      ),
    ),
  )

  const scroller = el('div', { dir: 'ltr', class: 'overflow-x-auto' }, svg)
  // The tooltip lives outside the scroller so it is never clipped by it, and is
  // positioned from pointer coordinates rather than SVG user units — the svg is
  // `w-full h-auto` over a fixed viewBox, so the two do not share a scale.
  const wrap = el('div', { class: 'relative' }, scroller, tip)

  function showTip(ev: MouseEvent, b: WeekBucket, c: Party): void {
    const value = avg(b, c.id)
    const rows = [...b.polls]
      .sort((p, q) => (p.fieldwork_end < q.fieldwork_end ? 1 : -1))
      .map((p) => {
        const r = p.poll_results.find((x) => x.party_id === c.id)
        const sub = r?.below_threshold === true
        return el(
          'li',
          { class: 'flex items-baseline justify-between gap-3' },
          el('span', { class: 'text-slate-600 truncate', dir: 'auto' }, `${p.pollster} · ${fmtDate(p.fieldwork_end)}`),
          el(
            'span',
            {
              class: sub ? 'text-slate-400 shrink-0' : 'font-bold text-slate-800 shrink-0',
              dir: 'ltr',
              title: sub ? t('polls.subThreshold') : '',
            },
            String(seatsOf(p, c.id)),
          ),
        )
      })

    tip.replaceChildren(
      el(
        'div',
        { class: 'flex items-center gap-1.5 font-bold text-blue-900' },
        partyChip(c),
        partyName(c),
      ),
      el('div', { class: 'text-slate-500 text-xs mb-2' }, `${b.label} · ${t('dashboard.tipPolls', { n: b.polls.length })}`),
      el(
        'div',
        { class: 'mb-2 text-slate-800' },
        t('polls.tipAvg'),
        ' ',
        ltr(value.toFixed(2)),
      ),
      el('div', { class: 'text-xs font-bold text-slate-500 mb-1' }, t('polls.tipIncluded')),
      el('ul', { class: 'space-y-0.5 text-xs' }, rows),
    )

    const box = wrap.getBoundingClientRect()
    tip.classList.remove('hidden')
    // Clamp inside the wrapper so a point near an edge does not push the card
    // off-screen — matters most in the narrow mobile column.
    const tw = tip.offsetWidth, th = tip.offsetHeight
    const left = Math.min(Math.max(ev.clientX - box.left + 14, 4), Math.max(4, box.width - tw - 4))
    const top = Math.min(Math.max(ev.clientY - box.top - th - 10, 4), Math.max(4, box.height - th - 4))
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  }

  function hideTip(): void {
    tip.classList.add('hidden')
  }

  // Touch has no mouseleave: tapping anywhere else on the chart dismisses the card.
  scroller.addEventListener('click', (ev) => {
    if (!(ev.target instanceof SVGCircleElement)) hideTip()
  })

  return el('div', {}, el('p', { class: 'text-sm text-slate-500 mb-2' }, t('polls.chartNote')), wrap, legend)
}

// ---------------------------------------------------------------- detailed table (secondary view)

function detailTable(polls: PollWithResults[], columns: Party[], weekPolls: PollWithResults[], avgLabel: string): HTMLElement {
  const partyHeader = (p: Party) => el('span', { class: 'inline-flex items-center gap-1.5' }, partyChip(p), partyName(p))
  const headers: (string | Node)[] = [
    t('polls.colDate'), t('polls.colPollster'), t('polls.colPublisher'), t('polls.colSample'),
    ...columns.map(partyHeader),
  ]

  const resultCell = (poll: PollWithResults, p: Party): string | Node => {
    const r = poll.poll_results.find((x) => x.party_id === p.id)
    if (!r) return '–'
    if (r.below_threshold) {
      return el('span', { class: 'text-slate-400 text-xs cursor-help', dir: 'ltr', title: t('polls.subThreshold') }, r.pct != null ? `${r.pct}%` : '0')
    }
    return ltr(String(r.seats))
  }

  const avgRow: (string | Node)[] = [
    avgLabel, '', '', '',
    ...columns.map((p) => (weekPolls.length ? ltr((weekPolls.reduce((sum, poll) => sum + seatsOf(poll, p.id), 0) / weekPolls.length).toFixed(2)) : '')),
  ]
  const rows = polls.map((poll): (string | Node)[] => [
    ltr(fmtDate(poll.fieldwork_end)),
    poll.pollster,
    poll.publisher ?? '–',
    poll.sample_size ? ltr(poll.sample_size.toLocaleString('en-US')) : '–',
    ...columns.map((p) => resultCell(poll, p)),
  ])

  return wideTable(headers, [avgRow, ...rows], { highlightFirstRow: true })
}
