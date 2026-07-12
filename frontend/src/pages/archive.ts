import { partyName, t } from '../lib/i18n'
import { activeParties, fetchParties, fetchWeeks, supabase, weekNumber } from '../lib/supabase'
import { callout, card, el, fmtDate, initPage, ltr, partyChip, skeleton, wideTable } from '../lib/ui'
import type { Bet, BetKind, BetLine, GameWeek, Party, Score, WeeklyAverage } from '../lib/database.types'

type PublicBet = Bet & { bet_lines: BetLine[]; profiles: { handle: string | null } | null }

const root = document.getElementById('root')!
await initPage('archive')

if (!supabase) {
  root.replaceChildren(card(skeleton(8)))
} else {
  try {
    await main()
  } catch {
    root.replaceChildren(callout('red', t('common.loadError')))
  }
}

async function main(): Promise<void> {
  const [weeks, parties] = await Promise.all([fetchWeeks(), fetchParties()])
  const now = Date.now()
  const revealed = weeks
    .filter((w) => (w.status === 'locked' || w.status === 'scored') && new Date(w.lock_at).getTime() <= now)
    .reverse() // newest first

  if (!revealed.length) {
    root.replaceChildren(card(el('p', { class: 'text-slate-600' }, t('archive.empty'))))
    return
  }

  const picker = el(
    'select',
    { class: 'border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 bg-white' },
    revealed.map((w) =>
      el('option', { value: String(w.id) }, `${t('common.week', { n: weekNumber(weeks, w.id) })} · ${fmtDate(w.week_start)}–${fmtDate(w.week_end)}`),
    ),
  ) as HTMLSelectElement
  const content = el('div', { class: 'space-y-6' }, card(skeleton(6)))
  picker.addEventListener('change', () => {
    renderWeek(parties, revealed.find((w) => w.id === Number(picker.value))!, content)
  })

  root.replaceChildren(
    el('div', {}, el('label', { class: 'block text-sm font-bold text-slate-700 mb-1' }, t('archive.pickWeek')), picker),
    content,
  )
  await renderWeek(parties, revealed[0], content)
}

async function renderWeek(parties: Party[], week: GameWeek, content: HTMLElement): Promise<void> {
  content.replaceChildren(card(skeleton(6)))
  const [avgRes, betsRes, scoresRes] = await Promise.all([
    supabase!.from('weekly_averages').select('*').eq('week_id', week.id),
    supabase!.from('bets').select('*, bet_lines(*), profiles(handle)').eq('week_id', week.id),
    supabase!.from('scores').select('*').eq('week_id', week.id),
  ])
  const averages = (avgRes.data ?? []) as WeeklyAverage[]
  const bets = (betsRes.data ?? []) as PublicBet[]
  const scores = (scoresRes.data ?? []) as Score[]

  const usedIds = new Set([...averages.map((a) => a.party_id), ...bets.flatMap((b) => b.bet_lines.map((l) => l.party_id))])
  const columns = parties.filter((p) => usedIds.has(p.id) || activeParties([p], week).length > 0)
  const partyHeader = (p: Party) => el('span', { class: 'inline-flex items-center gap-1.5' }, partyChip(p), partyName(p))

  // --- finalized average vector
  const avgById = new Map(averages.map((a) => [a.party_id, a.avg_seats]))
  const avgCard = card(
    el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('archive.avgTitle')),
    averages.length
      ? wideTable(
          columns.map(partyHeader),
          [columns.map((p) => (avgById.has(p.id) ? ltr(Number(avgById.get(p.id)).toFixed(2)) : '–'))],
        )
      : callout('amber', t('archive.notScored')),
  )

  // --- everyone's bets with scores; poll/final toggle + sortable by score
  const scoreOf = new Map(scores.map((s) => [`${s.user_id}:${s.kind}`, s]))
  let sortDesc = true
  let kind: BetKind = 'final' // the real game is the default view
  const tableHost = el('div', {})
  const toggle = el('div', { class: 'inline-flex rounded-xl bg-slate-100 p-1 mb-4' })

  const renderTable = () => {
    const sorted = bets
      .filter((b) => b.kind === kind)
      .sort((a, b) => {
        const sa = scoreOf.get(`${a.user_id}:${a.kind}`)?.score ?? -1
        const sb = scoreOf.get(`${b.user_id}:${b.kind}`)?.score ?? -1
        return sortDesc ? sb - sa : sa - sb
      })
    const scoreHeader = el(
      'button',
      { class: 'font-bold text-blue-900 hover:underline', onclick: () => { sortDesc = !sortDesc; renderTable() } },
      `${t('archive.colScore')} ${sortDesc ? '↓' : '↑'}`,
    )
    const rows = sorted.map((b): (string | Node)[] => {
      const s = scoreOf.get(`${b.user_id}:${b.kind}`)
      const lineById = new Map(b.bet_lines.map((l) => [l.party_id, l.seats]))
      return [
        b.profiles?.handle
          ? el('a', { href: `profile.html?u=${encodeURIComponent(b.profiles.handle)}`, class: 'text-blue-700 font-bold hover:underline' }, b.profiles.handle)
          : '–',
        b.is_carried ? '⟳' : '',
        ...columns.map((p) => (lineById.has(p.id) ? ltr(String(lineById.get(p.id))) : '–')),
        s ? ltr(Number(s.error).toFixed(2)) : '–',
        s ? ltr(Number(s.score).toFixed(1)) : '–',
      ]
    })
    tableHost.replaceChildren(
      sorted.length
        ? wideTable(
            [t('archive.colPlayer'), t('archive.colCarried'), ...columns.map(partyHeader), t('archive.colError'), scoreHeader],
            rows,
          )
        : el('p', { class: 'text-slate-600' }, t('archive.noBets')),
    )
  }

  const renderToggle = () => {
    const mk = (k: BetKind, label: string) =>
      el(
        'button',
        {
          class: `rounded-lg px-4 py-1.5 text-sm font-bold transition ${k === kind ? 'bg-white text-blue-900 shadow' : 'text-slate-600 hover:text-blue-900'}`,
          onclick: () => { kind = k; renderToggle(); renderTable() },
        },
        label,
      )
    toggle.replaceChildren(mk('final', t('archive.kindFinal')), mk('poll', t('archive.kindPoll')))
  }
  renderToggle()
  renderTable()

  content.replaceChildren(
    avgCard,
    card(el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('archive.betsTitle')), toggle, tableHost),
  )
}
