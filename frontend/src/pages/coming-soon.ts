// Pre-launch landing page. Deliberately does NOT use initPage()/ui.ts —
// in coming-soon builds this is the only page deployed, so the site header
// would link to pages that don't exist.
import '../style.css'
import { applyI18n, getLang, switchLang, t } from '../lib/i18n'
import { supabase } from '../lib/supabase'

document.title = t('app.title')
applyI18n()

const langBtn = document.getElementById('lang-btn')!
langBtn.textContent = getLang() === 'he' ? 'EN' : 'עב'
langBtn.addEventListener('click', () => switchLang(getLang() === 'he' ? 'en' : 'he'))

const section = document.getElementById('signup-section')!
if (!supabase) {
  section.classList.add('hidden')
} else {
  const sb = supabase
  const form = document.getElementById('signup-form') as HTMLFormElement
  const input = document.getElementById('signup-email') as HTMLInputElement
  const msg = document.getElementById('signup-msg')!
  // classes match ui.ts callout(); not imported to keep ui.ts out of the graph
  const show = (kind: 'emerald' | 'red', key: string) => {
    msg.className =
      kind === 'emerald'
        ? 'bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm'
        : 'bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm'
    msg.textContent = t(key)
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = input.value.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      show('red', 'soon.invalid')
      return
    }
    const btn = form.querySelector('button')!
    btn.disabled = true
    const { error } = await sb.rpc('subscribe_email', { p_email: email })
    if (error) {
      show('red', 'soon.error')
      btn.disabled = false
    } else {
      form.classList.add('hidden')
      show('emerald', 'soon.success')
    }
  })
}
