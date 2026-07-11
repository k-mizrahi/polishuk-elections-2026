import { partyName, t } from '../lib/i18n'
import { fetchParties, supabase } from '../lib/supabase'
import { BTN, BTN_SM, callout, card, el, fmtDate, initPage, ltr, partyChip, seatForm, skeleton, wideTable } from '../lib/ui'
import type { OfficialResult, Party, Poll, PollResult, Profile } from '../lib/database.types'

type PendingPoll = Poll & { poll_results: PollResult[] }

const root = document.getElementById('root')!
const ctx = await initPage('admin')

if (!supabase) {
  root.replaceChildren(card(skeleton(6)))
} else if (!ctx.profile?.is_admin) {
  // UI gate only — RLS is the real gate (docs/01)
  root.replaceChildren(card(el('p', { class: 'text-slate-700 font-bold' }, t('admin.denied'))))
} else {
  renderTabs()
}

/** Every admin write is also recorded in audit_log (docs/04). */
async function audit(action: string, payload: Record<string, unknown>): Promise<void> {
  await supabase!.from('audit_log').insert({ actor: ctx.session!.user.id, action, payload })
}

const TABS = [
  { key: 'admin.tabPolls', render: renderPollQueue },
  { key: 'admin.tabParties', render: renderParties },
  { key: 'admin.tabResults', render: renderResults },
  { key: 'admin.tabUsers', render: renderUsers },
]

function renderTabs(): void {
  const host = el('div', { class: 'space-y-6' })
  const buttons = TABS.map((tab, i) =>
    el('button', {
      class: 'font-bold rounded-xl py-2 px-4 text-sm transition',
      onclick: () => select(i),
    }, t(tab.key)),
  )
  async function select(i: number): Promise<void> {
    buttons.forEach((b, j) => {
      b.className = `font-bold rounded-xl py-2 px-4 text-sm transition ${
        i === j ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-600 hover:text-blue-900'
      }`
    })
    host.replaceChildren(card(skeleton(6)))
    try {
      await TABS[i].render(host)
    } catch (e) {
      host.replaceChildren(callout('red', t('admin.error', { msg: e instanceof Error ? e.message : String(e) })))
    }
  }
  root.replaceChildren(el('div', { class: 'flex flex-wrap gap-2' }, buttons), host)
  void select(0)
}

const INPUT = 'border border-slate-300 rounded-xl px-3 py-2 text-slate-800 bg-white'
const field = (key: string, input: HTMLElement) =>
  el('div', {}, el('label', { class: 'block text-sm font-bold text-slate-700 mb-1' }, t(key)), input)

// ---------------------------------------------------------------- 1 · poll queue

async function renderPollQueue(host: HTMLElement): Promise<void> {
  const [parties, { data, error }] = await Promise.all([
    fetchParties(),
    supabase!.from('polls').select('*, poll_results(*)').eq('status', 'pending').order('scraped_at'),
  ])
  if (error) throw error
  const polls = (data ?? []) as PendingPoll[]
  if (!polls.length) {
    host.replaceChildren(card(el('p', { class: 'text-slate-600' }, t('admin.pendingEmpty'))))
    return
  }
  const order = new Map(parties.map((p) => [p.id, p.sort_order]))
  host.replaceChildren(...polls.map((poll) => pendingPollCard(poll, parties, order)))
}

function pendingPollCard(poll: PendingPoll, parties: Party[], order: Map<number, number>): HTMLElement {
  const byId = new Map(parties.map((p) => [p.id, p]))
  const results = [...poll.poll_results].sort((a, b) => (order.get(a.party_id) ?? 999) - (order.get(b.party_id) ?? 999))
  const inputs = new Map<number, HTMLInputElement>()
  const status = el('div', {})

  const seatCells = results.map((r) => {
    const p = byId.get(r.party_id)
    const input = el('input', {
      type: 'number', min: '0', dir: 'ltr', value: String(r.seats),
      class: 'w-16 text-center border border-slate-300 rounded-lg py-1 font-bold text-slate-800',
    }) as HTMLInputElement
    inputs.set(r.party_id, input)
    return el(
      'div',
      { class: 'flex flex-col items-center gap-1 text-xs text-slate-600' },
      el('span', { class: 'inline-flex items-center gap-1' }, p ? partyChip(p) : null, p ? partyName(p) : String(r.party_id)),
      input,
      r.below_threshold && r.pct != null ? el('span', { class: 'text-slate-400', dir: 'ltr' }, `${r.pct}%`) : null,
    )
  })

  const setStatus = async (newStatus: 'approved' | 'rejected', btn: HTMLButtonElement, cardEl: HTMLElement) => {
    btn.disabled = true
    try {
      const edits: Record<number, number> = {}
      if (newStatus === 'approved') {
        for (const r of results) {
          const v = Number(inputs.get(r.party_id)!.value)
          if (v !== Number(r.seats)) edits[r.party_id] = v
        }
        for (const [partyId, seats] of Object.entries(edits)) {
          const { error } = await supabase!
            .from('poll_results')
            .update({ seats })
            .eq('poll_id', poll.id)
            .eq('party_id', Number(partyId))
          if (error) throw error
        }
      }
      const { error } = await supabase!.from('polls').update({ status: newStatus }).eq('id', poll.id)
      if (error) throw error
      await audit(`poll.${newStatus === 'approved' ? 'approve' : 'reject'}`, { poll_id: poll.id, edits })
      cardEl.remove()
    } catch (e) {
      btn.disabled = false
      status.replaceChildren(callout('red', t('admin.error', { msg: e instanceof Error ? e.message : String(e) })))
    }
  }

  const approveBtn = el('button', { class: BTN_SM }, t('admin.approve')) as HTMLButtonElement
  const rejectBtn = el('button', { class: 'bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded-xl py-2 px-4 text-sm transition' }, t('admin.reject')) as HTMLButtonElement
  const cardEl = card(
    el(
      'div',
      { class: 'flex items-center justify-between flex-wrap gap-2 mb-2' },
      el('h3', { class: 'text-blue-900 font-extrabold' }, `${poll.pollster}${poll.publisher ? ` · ${poll.publisher}` : ''}`),
      el('span', { class: 'text-sm text-slate-500' }, ltr(fmtDate(poll.fieldwork_end)), poll.sample_size ? ` · ${t('admin.sample', { n: poll.sample_size })}` : ''),
    ),
    poll.source_url
      ? el('a', { href: poll.source_url, target: '_blank', rel: 'noopener', class: 'text-blue-700 text-sm hover:underline' }, t('admin.source'))
      : null,
    poll.admin_note ? el('div', { class: 'my-2' }, callout('amber', poll.admin_note)) : null,
    el('div', { class: 'flex flex-wrap gap-3 my-4' }, seatCells),
    el('div', { class: 'flex gap-2' }, approveBtn, rejectBtn),
    status,
  )
  approveBtn.addEventListener('click', () => setStatus('approved', approveBtn, cardEl))
  rejectBtn.addEventListener('click', () => setStatus('rejected', rejectBtn, cardEl))
  return cardEl
}

// ---------------------------------------------------------------- 2 · parties

async function renderParties(host: HTMLElement): Promise<void> {
  const parties = await fetchParties()
  const status = el('div', {})
  const partyOption = (p: Party) => el('option', { value: String(p.id) }, `${partyName(p)} (${p.code})`)

  const table = wideTable(
    [t('admin.code'), t('admin.nameHe'), t('admin.nameEn'), t('admin.color'), t('admin.activeFrom'), t('admin.activeUntil'), t('admin.sortOrder')],
    parties.map((p) => [
      ltr(p.code),
      p.name_he,
      p.name_en,
      el('span', { class: 'inline-flex items-center gap-1.5' }, partyChip(p), ltr(p.color)),
      ltr(fmtDate(p.active_from)),
      p.active_until ? ltr(fmtDate(p.active_until)) : '–',
      String(p.sort_order),
    ]),
  )

  const run = async (action: string, payload: Record<string, unknown>, write: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await write()
    if (error) {
      status.replaceChildren(callout('red', t('admin.error', { msg: error.message })))
      return
    }
    await audit(action, payload)
    await renderParties(host) // refresh registry + forms
  }

  // add party
  const pCode = el('input', { type: 'text', dir: 'ltr', class: INPUT }) as HTMLInputElement
  const pHe = el('input', { type: 'text', dir: 'rtl', class: INPUT }) as HTMLInputElement
  const pEn = el('input', { type: 'text', dir: 'ltr', class: INPUT }) as HTMLInputElement
  const pColor = el('input', { type: 'color', value: '#64748b', class: 'h-10 w-16 border border-slate-300 rounded-xl bg-white' }) as HTMLInputElement
  const pFrom = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10), class: INPUT }) as HTMLInputElement
  const pSort = el('input', { type: 'number', dir: 'ltr', value: '100', class: INPUT + ' w-24' }) as HTMLInputElement
  const addPartyBtn = el('button', { class: BTN_SM }, t('admin.add'))
  addPartyBtn.addEventListener('click', () => {
    const row = { code: pCode.value.trim(), name_he: pHe.value.trim(), name_en: pEn.value.trim(), color: pColor.value, active_from: pFrom.value, sort_order: Number(pSort.value) }
    if (!row.code || !row.name_he || !row.name_en) return
    void run('party.add', row, () => supabase!.from('parties').insert(row))
  })

  // add alias
  const aParty = el('select', { class: INPUT }, parties.map(partyOption)) as HTMLSelectElement
  const aAlias = el('input', { type: 'text', dir: 'ltr', class: INPUT }) as HTMLInputElement
  const addAliasBtn = el('button', { class: BTN_SM }, t('admin.add'))
  addAliasBtn.addEventListener('click', () => {
    const row = { party_id: Number(aParty.value), alias: aAlias.value.trim() }
    if (!row.alias) return
    void run('party.alias.add', row, () => supabase!.from('party_aliases').insert(row))
  })

  // add transition
  const tOld = el('select', { class: INPUT }, parties.map(partyOption)) as HTMLSelectElement
  const tNew = el('select', { class: INPUT }, parties.map(partyOption)) as HTMLSelectElement
  const tDate = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10), class: INPUT }) as HTMLInputElement
  const addTransBtn = el('button', { class: BTN_SM }, t('admin.add'))
  addTransBtn.addEventListener('click', () => {
    const row = { old_party_id: Number(tOld.value), new_party_id: Number(tNew.value), effective_on: tDate.value }
    void run('party.transition.add', row, () => supabase!.from('party_transitions').insert(row))
  })

  host.replaceChildren(
    card(el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('admin.partiesTitle')), table),
    card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('admin.addParty')),
      el(
        'div',
        { class: 'flex flex-wrap gap-3 items-end' },
        field('admin.code', pCode), field('admin.nameHe', pHe), field('admin.nameEn', pEn),
        field('admin.color', pColor), field('admin.activeFrom', pFrom), field('admin.sortOrder', pSort),
        addPartyBtn,
      ),
    ),
    card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('admin.addAlias')),
      el('div', { class: 'flex flex-wrap gap-3 items-end' }, field('admin.party', aParty), field('admin.alias', aAlias), addAliasBtn),
    ),
    card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('admin.addTransition')),
      el('div', { class: 'flex flex-wrap gap-3 items-end' }, field('admin.oldParty', tOld), field('admin.newParty', tNew), field('admin.effectiveOn', tDate), addTransBtn),
    ),
    status,
  )
}

// ---------------------------------------------------------------- 3 · official results

async function renderResults(host: HTMLElement): Promise<void> {
  const [parties, { data, error }] = await Promise.all([
    fetchParties(),
    supabase!.from('official_results').select('*'),
  ])
  if (error) throw error
  const today = new Date().toISOString().slice(0, 10)
  const active = parties.filter((p) => p.active_from <= today && (p.active_until === null || p.active_until >= today))
  const byId = new Map(parties.map((p) => [p.id, p.code]))
  const initial: Record<string, number> = {}
  for (const r of (data ?? []) as OfficialResult[]) {
    const code = byId.get(r.party_id)
    if (code) initial[code] = r.seats
  }

  const form = seatForm(active, initial)
  const status = el('div', {})
  const saveBtn = el('button', { class: BTN }, t('admin.saveResults')) as HTMLButtonElement
  const update = () => (saveBtn.disabled = !form.valid())
  form.onChange(update)
  update()

  saveBtn.addEventListener('click', async () => {
    if (!window.confirm(t('admin.confirmResults'))) return
    saveBtn.disabled = true
    const codeToId = new Map(active.map((p) => [p.code, p.id]))
    const rows = Object.entries(form.values()).map(([code, seats]) => ({ party_id: codeToId.get(code)!, seats }))
    const { error: err } = await supabase!.from('official_results').upsert(rows, { onConflict: 'party_id' })
    update()
    if (err) {
      status.replaceChildren(callout('red', t('admin.error', { msg: err.message })))
      return
    }
    await audit('results.enter', { results: rows })
    status.replaceChildren(callout('emerald', t('admin.saved')))
  })

  host.replaceChildren(
    card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('admin.resultsTitle')),
      el('div', { class: 'mb-3' }, callout('amber', t('admin.resultsNote'))),
      form.root,
      el('div', { class: 'mt-4 space-y-3' }, saveBtn, status),
    ),
  )
}

// ---------------------------------------------------------------- 4 · users

async function renderUsers(host: HTMLElement): Promise<void> {
  const { data, error } = await supabase!.from('profiles').select('*').order('created_at')
  if (error) throw error
  const profiles = (data ?? []) as Profile[]
  const status = el('div', {})

  const rows = profiles.map((p): (string | Node)[] => {
    const toggle = el(
      'button',
      {
        class: p.is_banned ? BTN_SM : 'bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded-xl py-1.5 px-3 text-xs transition',
        onclick: async () => {
          const { error: err } = await supabase!.from('profiles').update({ is_banned: !p.is_banned }).eq('id', p.id)
          if (err) {
            status.replaceChildren(callout('red', t('admin.error', { msg: err.message })))
            return
          }
          await audit(p.is_banned ? 'user.unban' : 'user.ban', { user_id: p.id, handle: p.handle })
          await renderUsers(host)
        },
      },
      t(p.is_banned ? 'admin.unban' : 'admin.ban'),
    )
    const tags = el(
      'span',
      { class: 'inline-flex gap-1' },
      p.is_admin ? el('span', { class: 'bg-sky-100 text-blue-900 rounded px-1.5 py-0.5 text-xs font-bold' }, t('admin.adminTag')) : null,
      p.is_banned ? el('span', { class: 'bg-red-100 text-red-700 rounded px-1.5 py-0.5 text-xs font-bold' }, t('admin.bannedTag')) : null,
    )
    return [p.handle ?? '–', p.display_name ?? '–', tags, ltr(fmtDate(p.created_at)), toggle]
  })

  host.replaceChildren(
    card(
      el('h2', { class: 'text-blue-900 font-extrabold text-xl mb-3' }, t('admin.usersTitle')),
      wideTable([t('lb.colPlayer'), t('profile.displayName'), '', t('admin.joined'), ''], rows),
      status,
    ),
  )
}
