import { t } from '../lib/i18n'
import { BTN, callout, card, el, initPage, ltr } from '../lib/ui'

const root = document.getElementById('root')!
await initPage('rules')

/** A rules section: a card with a heading and body content. */
function section(titleKey: string, ...body: (Node | string)[]): HTMLElement {
  return card(
    el('h2', { class: 'text-blue-900 font-extrabold text-2xl mb-4' }, t(titleKey)),
    el('div', { class: 'space-y-3 text-slate-700 leading-relaxed' }, ...body),
  )
}

const p = (key: string) => el('p', {}, t(key))

// The two-bets highlight boxes.
const betBox = (kind: 'emerald' | 'amber', titleKey: string, bodyKey: string) =>
  callout(
    kind,
    el('p', { class: 'font-bold text-base mb-1' }, t(titleKey)),
    el('p', {}, t(bodyKey)),
  )

// Worked example table (integer bet vs. fractional average). Reuses the party
// names already defined for the home-page example.
function exampleTable(): HTMLElement {
  const rows: [string, string, string, string, boolean][] = [
    ['index.exLikud', '26', '24.67', '1.33', false],
    ['index.exTogether', '21', '22.33', '1.33', false],
    ['index.exDems', '12', '12.00', '0', true],
    ['index.exShas', '10', '9.67', '0.33', false],
    ['rules.exampleRest', '…', '…', '7.7', false],
  ]
  const th = (key: string) => el('th', { class: 'px-3 py-2 text-start font-bold text-blue-900' }, t(key))
  const trs = rows.map(([nameKey, bet, avg, err, exact]) =>
    el(
      'tr',
      { class: 'border-t border-slate-100' },
      el('td', { class: 'px-3 py-2 font-medium' }, t(nameKey)),
      el('td', { class: 'px-3 py-2' }, ltr(bet)),
      el('td', { class: 'px-3 py-2' }, ltr(avg)),
      el('td', { class: `px-3 py-2 ${exact ? 'text-emerald-600' : 'text-red-600'}` }, ltr(err)),
    ),
  )
  return el(
    'div',
    { class: 'overflow-x-auto' },
    el(
      'table',
      { class: 'w-full text-sm text-slate-700' },
      el('thead', {}, el('tr', {}, th('rules.colParty'), th('rules.colBet'), th('rules.colAvg'), th('rules.colErr'))),
      el('tbody', {}, trs),
    ),
  )
}

root.replaceChildren(
  section('rules.aboutTitle', p('rules.aboutBody')),

  section(
    'rules.betsTitle',
    p('rules.betsIntro'),
    betBox('emerald', 'rules.finalTitle', 'rules.finalBody'),
    betBox('amber', 'rules.pollTitle', 'rules.pollBody'),
  ),

  section('rules.seatsTitle', p('rules.seatsBody'), callout('emerald', t('rules.seatsThreshold'))),

  section('rules.cycleTitle', p('rules.cycleBody')),

  section('rules.carriedTitle', p('rules.carriedBody')),

  section(
    'rules.scoreTitle',
    p('rules.scoreIntro'),
    p('rules.scoreErr'),
    el(
      'ul',
      { class: 'space-y-2' },
      el('li', { class: 'flex gap-2' }, el('span', {}, '📊'), el('span', {}, t('rules.scorePollFormula'))),
      el('li', { class: 'flex gap-2' }, el('span', {}, '🏛️'), el('span', {}, t('rules.scoreFinalFormula'))),
    ),
  ),

  section(
    'rules.exampleTitle',
    p('rules.exampleIntro'),
    exampleTable(),
    callout('emerald', el('span', { class: 'font-bold' }, t('rules.exampleTotal'))),
  ),

  section('rules.lbTitle', p('rules.lbBody')),

  section('rules.pollsTitle', p('rules.pollsBody')),

  section('rules.voidTitle', p('rules.voidBody')),

  el(
    'div',
    { class: 'text-center pt-2 pb-4' },
    el('a', { href: 'login.html', class: `inline-block ${BTN}` }, t('rules.cta')),
  ),
)
