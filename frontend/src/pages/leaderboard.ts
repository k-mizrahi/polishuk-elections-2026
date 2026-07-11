import { t } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { callout, card, el, initPage, ltr, skeleton, wideTable } from '../lib/ui'
import type { LeaderboardRow } from '../lib/database.types'

const root = document.getElementById('root')!
await initPage('leaderboard')

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
  // ordering per docs/02 §5 tie-breakers
  const { data, error } = await supabase!
    .from('leaderboard')
    .select('*')
    .order('total', { ascending: false })
    .order('final_total', { ascending: false })
    .order('final_error_total', { ascending: true })
    .order('first_bet_at', { ascending: true, nullsFirst: false })
  if (error) throw error
  const rows = (data ?? []) as LeaderboardRow[]

  if (!rows.length || rows.every((r) => r.total === 0 && r.weeks_played === 0)) {
    root.replaceChildren(card(el('p', { class: 'text-slate-600' }, t('lb.empty'))))
    return
  }

  const headers = ['lb.colRank', 'lb.colPlayer', 'lb.colTotal', 'lb.colFinal', 'lb.colPoll', 'lb.colWeeks', 'lb.colPerWeek'].map((k) => t(k))
  let rank = 0
  let prevTotal: number | null = null
  const tableRows = rows.map((r, i): (string | Node)[] => {
    if (r.total !== prevTotal) {
      rank = i + 1 // ties share a rank number
      prevTotal = r.total
    }
    const player = el(
      'span',
      { class: 'inline-flex items-center gap-2' },
      el('a', { href: `profile.html?u=${encodeURIComponent(r.handle)}`, class: 'text-blue-700 font-bold hover:underline' }, r.handle),
      r.twitter_handle
        ? el('a', { href: `https://x.com/${r.twitter_handle}`, target: '_blank', rel: 'noopener', dir: 'ltr', class: 'text-slate-400 text-xs hover:text-blue-700' }, `@${r.twitter_handle}`)
        : null,
    )
    return [
      String(rank),
      player,
      ltr(r.total.toFixed(1)),
      ltr(r.final_total.toFixed(1)),
      ltr(r.poll_total.toFixed(1)),
      String(r.weeks_played),
      r.weeks_played > 0 ? ltr((r.total / r.weeks_played).toFixed(1)) : '–',
    ]
  })

  root.replaceChildren(
    card(
      wideTable(headers, tableRows),
      el(
        'p',
        { class: 'text-slate-500 text-sm mt-3' },
        t('lb.note'),
        ' ',
        el('a', { href: 'index.html#rules', class: 'text-blue-700 hover:underline' }, t('footer.rules')),
      ),
    ),
  )
}
