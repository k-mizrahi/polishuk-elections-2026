import { switchLang, t, type Lang } from '../lib/i18n'
import { fetchWeeks, supabase, weekNumber } from '../lib/supabase'
import { BTN, callout, card, el, initPage, ltr, skeleton, wideTable } from '../lib/ui'
import type { Bet, Profile, Score } from '../lib/database.types'

const root = document.getElementById('root')!
const ctx = await initPage('profile')
const requestedHandle = new URLSearchParams(location.search).get('u')

if (!supabase) {
  root.replaceChildren(card(skeleton(6)))
} else {
  try {
    await main()
  } catch {
    root.replaceChildren(callout('red', t('common.loadError')))
  }
}

async function main(): Promise<void> {
  const isPublic = requestedHandle !== null && requestedHandle !== ctx.profile?.handle
  if (isPublic) {
    const { data } = await supabase!.from('profiles').select('*').eq('handle', requestedHandle!).maybeSingle()
    const profile = data as Profile | null
    if (!profile) {
      root.replaceChildren(card(el('p', { class: 'text-slate-600' }, t('profile.notFound'))))
      return
    }
    root.replaceChildren(publicCard(profile), await historyCard(profile.id))
    return
  }

  if (!ctx.session || !ctx.profile) {
    root.replaceChildren(
      card(
        el('p', { class: 'text-slate-700 font-bold mb-3' }, t('profile.notLoggedIn')),
        el('a', { href: 'login.html', class: BTN + ' inline-block' }, t('common.toLogin')),
      ),
    )
    return
  }
  root.replaceChildren(editCard(ctx.profile), await historyCard(ctx.profile.id))
}

function publicCard(p: Profile): HTMLElement {
  return card(
    el('h1', { class: 'text-blue-900 font-extrabold text-3xl mb-2' }, `${t('profile.publicTitle')} · ${p.handle}`),
    p.display_name ? el('p', { class: 'text-slate-700' }, p.display_name) : null,
    p.twitter_handle
      ? el('a', { href: `https://x.com/${p.twitter_handle}`, target: '_blank', rel: 'noopener', dir: 'ltr', class: 'text-blue-700 hover:underline' }, `@${p.twitter_handle}`)
      : null,
  )
}

function editCard(p: Profile): HTMLElement {
  const status = el('div', {})
  const displayInput = el('input', { type: 'text', dir: 'auto', value: p.display_name ?? '', class: 'w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800' }) as HTMLInputElement
  const twitterInput = el('input', { type: 'text', dir: 'ltr', value: p.twitter_handle ?? '', class: 'w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800' }) as HTMLInputElement
  const langSel = el(
    'select',
    { class: 'w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white' },
    el('option', { value: 'he', selected: p.lang === 'he' }, t('profile.langHe')),
    el('option', { value: 'en', selected: p.lang === 'en' }, t('profile.langEn')),
  ) as HTMLSelectElement
  const saveBtn = el('button', { class: BTN }, t('profile.save')) as HTMLButtonElement

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    const lang = langSel.value as Lang
    const { error } = await supabase!
      .from('profiles')
      .update({
        display_name: displayInput.value.trim() || null,
        twitter_handle: twitterInput.value.trim().replace(/^@/, '') || null,
        lang,
      })
      .eq('id', p.id)
    saveBtn.disabled = false
    if (error) {
      status.replaceChildren(callout('red', t('profile.saveError', { msg: error.message })))
    } else if (lang !== ctx.lang) {
      switchLang(lang) // persists + reloads the page in the new language
    } else {
      status.replaceChildren(callout('emerald', t('profile.saved')))
    }
  })

  const field = (key: string, input: HTMLElement) =>
    el('div', {}, el('label', { class: 'block text-sm font-bold text-slate-700 mb-1' }, t(key)), input)
  return card(
    el('h1', { class: 'text-blue-900 font-extrabold text-3xl mb-4' }, `${t('profile.title')} · ${p.handle ?? ''}`),
    el('div', { class: 'space-y-4 max-w-md' }, field('profile.displayName', displayInput), field('profile.twitter', twitterInput), field('profile.lang', langSel), saveBtn, status),
  )
}

async function historyCard(userId: string): Promise<HTMLElement> {
  const [weeks, scoresRes, betsRes] = await Promise.all([
    fetchWeeks(),
    supabase!.from('scores').select('*').eq('user_id', userId),
    supabase!.from('bets').select('week_id, kind, is_carried').eq('user_id', userId),
  ])
  const scores = (scoresRes.data ?? []) as Score[]
  const carried = new Map(
    ((betsRes.data ?? []) as Pick<Bet, 'week_id' | 'kind' | 'is_carried'>[]).map((b) => [`${b.week_id}:${b.kind}`, b.is_carried]),
  )

  if (!scores.length) {
    return card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('profile.historyTitle')),
      el('p', { class: 'text-slate-600' }, t('profile.noHistory')),
    )
  }

  scores.sort((a, b) => weekNumber(weeks, a.week_id) - weekNumber(weeks, b.week_id) || a.kind.localeCompare(b.kind))
  const rows = scores.map((s): (string | Node)[] => [
    t('common.week', { n: weekNumber(weeks, s.week_id) }),
    t(s.kind === 'final' ? 'archive.kindFinal' : 'archive.kindPoll'),
    carried.get(`${s.week_id}:${s.kind}`) ? '⟳' : '',
    ltr(Number(s.error).toFixed(2)),
    ltr(Number(s.score).toFixed(1)),
  ])
  const total = scores.reduce((sum, s) => sum + Number(s.score), 0)

  return card(
    el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('profile.historyTitle')),
    wideTable(
      [t('profile.colWeek'), t('profile.colKind'), t('profile.colCarried'), t('profile.colError'), t('profile.colScore')],
      rows,
    ),
    el('p', { class: 'text-slate-800 font-bold mt-3' }, t('profile.totals', { n: total.toFixed(1) })),
  )
}
