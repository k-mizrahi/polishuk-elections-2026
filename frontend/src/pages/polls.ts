import { partyName, t } from '../lib/i18n'
import { activeParties, fetchParties, fetchWeeks, supabase } from '../lib/supabase'
import { callout, card, el, fmtDate, initPage, ltr, partyChip, skeleton, wideTable } from '../lib/ui'
import type { Party, Poll, PollResult } from '../lib/database.types'

type PollWithResults = Poll & { poll_results: PollResult[] }

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

async function render(): Promise<void> {
  const [parties, weeks, { data, error }] = await Promise.all([
    fetchParties(),
    fetchWeeks(),
    supabase!
      .from('polls')
      .select('*, poll_results(*)')
      .eq('status', 'approved')
      .order('fieldwork_end', { ascending: false })
      .limit(60),
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

  const renderView = () => {
    host.replaceChildren(view === 'chart' ? trendChart(polls, columns) : detailTable(polls, columns, weekPolls, avgLabel))
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

const SVGNS = 'http://www.w3.org/2000/svg'
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v))
  for (const c of kids) n.append(c)
  return n
}

/** One line per party over time (x = fieldwork end, y = seats). Hovering a legend
 *  chip highlights that party's line. Rendered LTR so time reads oldest→newest
 *  regardless of page direction. */
function trendChart(polls: PollWithResults[], columns: Party[]): HTMLElement {
  const pts = [...polls]
    .map((p) => ({ t: new Date(p.fieldwork_end).getTime(), poll: p }))
    .sort((a, b) => a.t - b.t)

  const W = 820, H = 380, M = { top: 16, right: 16, bottom: 34, left: 34 }
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t
  const yMax = Math.max(5, Math.ceil(Math.max(...pts.flatMap((p) => columns.map((c) => seatsOf(p.poll, c.id)))) / 5) * 5)
  const x = (tt: number) => M.left + (t1 === t0 ? iw / 2 : ((tt - t0) / (t1 - t0)) * iw)
  const y = (v: number) => M.top + ih - (v / yMax) * ih

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-auto', role: 'img' })

  // y gridlines + labels
  for (let v = 0; v <= yMax; v += 5) {
    svg.append(s('line', { x1: M.left, y1: y(v), x2: W - M.right, y2: y(v), stroke: '#e2e8f0' }))
    svg.append(s('text', { x: M.left - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#94a3b8' }, String(v)))
  }
  // x date ticks (~5)
  const nTicks = Math.min(5, pts.length)
  for (let i = 0; i < nTicks; i++) {
    const tt = t0 + ((t1 - t0) * i) / Math.max(1, nTicks - 1)
    svg.append(s('text', { x: x(tt), y: H - 12, 'text-anchor': 'middle', 'font-size': 11, fill: '#94a3b8' }, fmtDate(new Date(tt).toISOString())))
  }

  // one polyline (+ dots) per party
  const lineByCode = new Map<string, SVGGElement>()
  for (const c of columns) {
    const g = s('g', { 'data-code': c.code }) as SVGGElement
    const pointsStr = pts.map((p) => `${x(p.t)},${y(seatsOf(p.poll, c.id))}`).join(' ')
    g.append(s('polyline', { points: pointsStr, fill: 'none', stroke: c.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }))
    for (const p of pts) g.append(s('circle', { cx: x(p.t), cy: y(seatsOf(p.poll, c.id)), r: 2.5, fill: c.color }))
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

  return el('div', {}, el('div', { dir: 'ltr', class: 'overflow-x-auto' }, svg), legend)
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
