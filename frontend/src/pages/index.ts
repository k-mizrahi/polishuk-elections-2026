import { t } from '../lib/i18n'
import { fetchWeeks, supabase, weekNumber } from '../lib/supabase'
import { callout, card, countdown, el } from '../lib/ui'
import { initPage } from '../lib/ui'
import type { Bet } from '../lib/database.types'

const ctx = await initPage('index')

const cta = document.getElementById('cta') as HTMLAnchorElement
if (ctx.session) cta.href = 'bets.html'

if (ctx.profile?.is_banned) {
  cta.classList.add('pointer-events-none', 'opacity-50')
  document.getElementById('banned-note')!.replaceWith(callout('amber', t('common.banned')))
} else if (ctx.session && supabase) {
  renderStatusStrip().catch(() => {
    // status strip is a bonus; the static page must survive data failures
  })
}

async function renderStatusStrip(): Promise<void> {
  const weeks = await fetchWeeks()
  const open = weeks.find((w) => w.status === 'open')
  if (!open) return

  const { data: bets } = await supabase!
    .from('bets')
    .select('*')
    .eq('user_id', ctx.session!.user.id)
    .eq('week_id', open.id)
  const byKind = new Map((bets as Bet[] | null)?.map((b) => [b.kind, b]) ?? [])

  // resolve origin weeks of carried bets for the "carried from week N" copy
  const carriedIds = [...byKind.values()].filter((b) => b.is_carried && b.carried_from_bet_id).map((b) => b.carried_from_bet_id!)
  const originWeek = new Map<number, number>()
  if (carriedIds.length) {
    const { data: origins } = await supabase!.from('bets').select('id, week_id').in('id', carriedIds)
    for (const o of (origins ?? []) as { id: number; week_id: number }[]) originWeek.set(o.id, o.week_id)
  }

  const stateLine = (kind: 'final' | 'poll') => {
    const bet = byKind.get(kind)
    let text: string
    let cls: string
    if (!bet) {
      text = t('index.stNone')
      cls = 'text-red-600'
    } else if (bet.is_carried) {
      const from = bet.carried_from_bet_id ? originWeek.get(bet.carried_from_bet_id) : undefined
      text = from ? t('index.stCarried', { n: weekNumber(weeks, from) }) : t('index.stCarriedUnknown')
      cls = 'text-amber-700'
    } else {
      text = t('index.stSubmitted')
      cls = 'text-emerald-700'
    }
    return el(
      'a',
      { href: 'bets.html', class: `flex justify-between gap-4 hover:bg-sky-50 rounded-lg px-2 py-1 ${cls}` },
      el('span', { class: 'font-bold text-slate-800' }, t(kind === 'final' ? 'common.finalBet' : 'common.pollBet')),
      el('span', { class: 'font-bold' }, text),
    )
  }

  const cd = el('span', { class: 'font-bold text-amber-900', dir: 'ltr' })
  countdown(open.lock_at, cd)
  document.getElementById('status-strip')!.replaceChildren(
    card(
      el(
        'div',
        { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
        el('h2', { class: 'text-blue-900 font-extrabold text-xl' }, `${t('index.statusTitle')} · ${t('common.week', { n: weekNumber(weeks, open.id) })}`),
        el('span', { class: 'bg-amber-50 border border-amber-200 rounded-lg px-3 py-1 text-sm text-amber-900' }, t('index.lockLead'), ' ', cd),
      ),
      el('div', { class: 'space-y-1' }, stateLine('final'), stateLine('poll')),
    ),
  )
}
