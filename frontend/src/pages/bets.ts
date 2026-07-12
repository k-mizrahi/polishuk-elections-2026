import { t } from '../lib/i18n'
import { activeParties, fetchParties, fetchWeeks, supabase, weekNumber } from '../lib/supabase'
import { BTN, BTN_GHOST, callout, card, countdown, el, fmtDate, initPage, seatForm, skeleton } from '../lib/ui'
import type { Bet, BetKind, BetLine, GameWeek, Party } from '../lib/database.types'

type BetWithLines = Bet & { bet_lines: BetLine[] }

const root = document.getElementById('root')!
const ctx = await initPage('bets')

if (!supabase) {
  root.replaceChildren(card(skeleton(6)), card(skeleton(6)))
} else if (!ctx.session) {
  root.replaceChildren(
    card(
      el('p', { class: 'text-slate-700 font-bold mb-3' }, t('bets.notLoggedIn')),
      el('a', { href: 'login.html', class: BTN + ' inline-block' }, t('common.toLogin')),
    ),
  )
} else if (ctx.profile?.is_banned) {
  root.replaceChildren(callout('amber', t('common.banned')))
} else {
  try {
    await render()
  } catch {
    root.replaceChildren(callout('red', t('common.loadError')))
  }
}

async function render(): Promise<void> {
  const [weeks, parties] = await Promise.all([fetchWeeks(), fetchParties()])
  const now = Date.now()
  const open = weeks.find((w) => w.status === 'open' && new Date(w.lock_at).getTime() > now)
  if (open) return renderOpen(weeks, parties, open)

  // most recent week whose lock has passed → read-only reveal
  const locked = [...weeks]
    .filter((w) => w.status !== 'scheduled' && new Date(w.lock_at).getTime() <= now)
    .pop()
  if (locked) return renderLocked(weeks, parties, locked)

  root.replaceChildren(card(el('p', { class: 'text-slate-700 font-bold' }, t('bets.noOpenWeek'))))
}

async function fetchOwnBets(weekId: number): Promise<Map<BetKind, BetWithLines>> {
  const { data, error } = await supabase!
    .from('bets')
    .select('*, bet_lines(*)')
    .eq('user_id', ctx.session!.user.id)
    .eq('week_id', weekId)
  if (error) throw error
  return new Map(((data ?? []) as BetWithLines[]).map((b) => [b.kind, b]))
}

function linesToValues(bet: BetWithLines | undefined, parties: Party[]): Record<string, number> {
  const byId = new Map(parties.map((p) => [p.id, p.code]))
  const values: Record<string, number> = {}
  for (const l of bet?.bet_lines ?? []) {
    const code = byId.get(l.party_id)
    if (code) values[code] = l.seats
  }
  return values
}

async function renderOpen(weeks: GameWeek[], parties: Party[], open: GameWeek): Promise<void> {
  const active = activeParties(parties, open)
  const bets = await fetchOwnBets(open.id)

  const cd = el('span', { class: 'font-bold', dir: 'ltr' })
  countdown(open.lock_at, cd, () => location.reload())
  const header = el(
    'div',
    { class: 'flex items-center justify-between flex-wrap gap-2' },
    el('h2', { class: 'text-blue-900 font-extrabold text-xl' },
      t('bets.weekTitle', { n: weekNumber(weeks, open.id), from: fmtDate(open.week_start), to: fmtDate(open.week_end) })),
    callout('amber', t('bets.lockLead'), ' ', cd),
  )

  const buildCard = (kind: BetKind, extraFills: HTMLElement[] = []) => {
    const bet = bets.get(kind)
    const form = seatForm(active, linesToValues(bet, parties))
    const status = el('div', {})
    const submit = el('button', { class: BTN }, t('bets.submit')) as HTMLButtonElement
    const carriedBanner = bet?.is_carried ? callout('amber', t('bets.carriedUnknown')) : null
    if (bet?.is_carried && bet.carried_from_bet_id) {
      supabase!
        .from('bets')
        .select('week_id')
        .eq('id', bet.carried_from_bet_id)
        .maybeSingle()
        .then(({ data }) => {
          if (data && carriedBanner) carriedBanner.textContent = t('bets.carried', { n: weekNumber(weeks, (data as { week_id: number }).week_id) })
        })
    }

    const update = () => (submit.disabled = !form.valid())
    form.onChange(update)
    update()

    submit.addEventListener('click', async () => {
      submit.disabled = true
      submit.textContent = t('bets.saving')
      const { error } = await supabase!.rpc('upsert_bet', {
        p_week_id: open.id,
        p_kind: kind,
        p_lines: form.values(),
      })
      submit.textContent = t('bets.submit')
      update()
      if (error) {
        const msg = error.message.includes('locked')
          ? t('bets.errLocked')
          : error.message.includes('120')
            ? t('bets.errSum')
            : error.message.includes('banned')
              ? t('common.banned')
              : t('bets.saveError', { msg: error.message })
        status.replaceChildren(callout('red', msg))
      } else {
        carriedBanner?.remove()
        status.replaceChildren(callout('emerald', t('bets.saved')))
      }
    })

    return {
      form,
      el: card(
        el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t(kind === 'final' ? 'bets.finalTitle' : 'bets.pollTitle')),
        carriedBanner,
        form.root,
        extraFills.length ? el('div', { class: 'flex flex-wrap gap-2 mt-4' }, ...extraFills) : null,
        el('div', { class: 'mt-4 space-y-3' }, submit, status),
      ),
    }
  }

  const finalCard = buildCard('final')
  const copyBtn = el('button', { class: BTN_GHOST }, t('bets.copyFinal'))
  const pollCard = buildCard('poll', [copyBtn as HTMLElement])
  copyBtn.addEventListener('click', () => pollCard.form.setValues(finalCard.form.values()))

  root.replaceChildren(header, finalCard.el, pollCard.el)
}

async function renderLocked(weeks: GameWeek[], parties: Party[], week: GameWeek): Promise<void> {
  const active = activeParties(parties, week)
  const bets = await fetchOwnBets(week.id)
  const readOnlyCard = (kind: BetKind) => {
    const bet = bets.get(kind)
    return card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t(kind === 'final' ? 'bets.finalTitle' : 'bets.pollTitle')),
      bet ? seatForm(active, linesToValues(bet, parties), true).root : el('p', { class: 'text-slate-500' }, t('bets.noBet')),
    )
  }
  root.replaceChildren(
    card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-2' }, t('bets.locked')),
      el('p', { class: 'text-slate-700 mb-3' }, t('bets.lockedBody', { n: weekNumber(weeks, week.id) })),
      el('a', { href: 'archive.html', class: 'text-blue-700 font-bold hover:underline' }, t('bets.toArchive')),
    ),
    readOnlyCard('final'),
    readOnlyCard('poll'),
  )
}
