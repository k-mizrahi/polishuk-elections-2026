import { partyName, t } from '../lib/i18n'
import { activeParties, fetchParties, fetchWeeks, supabase } from '../lib/supabase'
import { callout, card, el, fmtDate, initPage, ltr, partyChip, skeleton, wideTable } from '../lib/ui'
import type { Poll, PollResult } from '../lib/database.types'

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

  const headers: (string | Node)[] = [
    t('polls.colDate'),
    t('polls.colPollster'),
    t('polls.colPublisher'),
    t('polls.colSample'),
    ...columns.map((p) => el('span', { class: 'inline-flex items-center gap-1.5' }, partyChip(p), partyName(p))),
  ]

  const resultCell = (r: PollResult | undefined): string | Node => {
    if (!r) return '–'
    if (r.below_threshold) {
      return el(
        'span',
        { class: 'text-slate-400 text-xs cursor-help', dir: 'ltr', title: t('polls.subThreshold') },
        r.pct != null ? `${r.pct}%` : '0',
      )
    }
    return ltr(String(r.seats))
  }

  // current week's running average, computed client-side from approved polls
  const weekPolls = currentWeek ? polls.filter((p) => p.game_week_id === currentWeek.id) : []
  const avgLabel = weekPolls.length
    ? t('polls.avgRow', { n: weekPolls.length })
    : t('polls.avgNone')
  const avgRow: (string | Node)[] = [
    avgLabel,
    '',
    '',
    '',
    ...columns.map((p) => {
      if (!weekPolls.length) return ''
      const sum = weekPolls.reduce(
        (s, poll) => s + Number(poll.poll_results.find((r) => r.party_id === p.id && !r.below_threshold)?.seats ?? 0),
        0,
      )
      return ltr((sum / weekPolls.length).toFixed(2))
    }),
  ]

  const rows = polls.map((poll): (string | Node)[] => {
    const byParty = new Map(poll.poll_results.map((r) => [r.party_id, r]))
    return [
      ltr(fmtDate(poll.fieldwork_end)),
      poll.pollster,
      poll.publisher ?? '–',
      poll.sample_size ? ltr(poll.sample_size.toLocaleString('en-US')) : '–',
      ...columns.map((p) => resultCell(byParty.get(p.id))),
    ]
  })

  root.replaceChildren(card(wideTable(headers, [avgRow, ...rows], { highlightFirstRow: true })))
}
