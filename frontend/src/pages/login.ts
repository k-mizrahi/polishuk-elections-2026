import { t } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { BTN, callout, el, initPage } from '../lib/ui'

const ctx = await initPage('login')

const msg = document.getElementById('login-msg')!
const googleBtn = document.getElementById('google-btn') as HTMLButtonElement
const magicForm = document.getElementById('magic-form') as HTMLFormElement
const emailInput = document.getElementById('email') as HTMLInputElement
const redirectTo = location.origin + import.meta.env.BASE_URL + 'login.html'

// surface OAuth/magic-link errors that Supabase returns in the URL hash
const hashErr = new URLSearchParams(location.hash.slice(1)).get('error_description')
if (hashErr) msg.replaceChildren(callout('red', t('login.authError', { msg: hashErr })))

if (!supabase) {
  googleBtn.disabled = true
  magicForm.querySelector('button')!.disabled = true
  msg.replaceChildren(callout('amber', t('login.notConfigured')))
} else if (ctx.session) {
  googleBtn.classList.add('hidden')
  magicForm.classList.add('hidden')
  if (ctx.profile?.is_banned) {
    msg.replaceChildren(callout('amber', t('common.banned')))
  } else if (!ctx.profile?.handle) {
    showOnboarding()
  } else {
    msg.replaceChildren(callout('emerald', t('login.alreadyIn')))
    setTimeout(() => (location.href = 'bets.html'), 900)
  }
} else {
  googleBtn.addEventListener('click', async () => {
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) msg.replaceChildren(callout('red', t('login.authError', { msg: error.message })))
  })
  magicForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const { error } = await supabase!.auth.signInWithOtp({
      email: emailInput.value.trim(),
      options: { emailRedirectTo: redirectTo },
    })
    msg.replaceChildren(
      error
        ? callout('red', t('login.authError', { msg: error.message }))
        : callout('emerald', t('login.linkSent')),
    )
  })
}

/** Blocking modal shown until profiles.handle is set (docs/01 login states). */
function showOnboarding(): void {
  const status = el('p', { class: 'text-sm min-h-5' })
  const handleInput = el('input', {
    type: 'text',
    dir: 'auto',
    maxlength: '20',
    class: 'w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800',
  })
  const displayInput = el('input', { type: 'text', dir: 'auto', class: 'w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800' })
  const twitterInput = el('input', { type: 'text', dir: 'ltr', class: 'w-full border border-slate-300 rounded-xl px-3 py-2 text-slate-800' })
  const saveBtn = el('button', { class: `${BTN} w-full`, disabled: true }, t('login.saveHandle')) as HTMLButtonElement

  let checkTimer: number | undefined
  let valid = false
  const setStatus = (text: string, cls: string, ok: boolean) => {
    status.textContent = text
    status.className = `text-sm min-h-5 ${cls}`
    valid = ok
    saveBtn.disabled = !ok
  }
  handleInput.addEventListener('input', () => {
    clearTimeout(checkTimer)
    const h = handleInput.value.trim()
    if (h.length < 3 || h.length > 20) {
      setStatus(h ? t('login.handleInvalid') : '', 'text-red-600', false)
      return
    }
    setStatus(t('login.handleChecking'), 'text-slate-500', false)
    checkTimer = window.setTimeout(async () => {
      const { data } = await supabase!.from('public_profiles').select('id').eq('handle', h).maybeSingle()
      if (handleInput.value.trim() !== h) return // stale response
      if (data) setStatus(t('login.handleTaken'), 'text-red-600', false)
      else setStatus(t('login.handleFree'), 'text-emerald-700', true)
    }, 400)
  })

  saveBtn.addEventListener('click', async () => {
    if (!valid) return
    saveBtn.disabled = true
    const { error } = await supabase!
      .from('profiles')
      .update({
        handle: handleInput.value.trim(),
        display_name: displayInput.value.trim() || null,
        twitter_handle: twitterInput.value.trim().replace(/^@/, '') || null,
      })
      .eq('id', ctx.session!.user.id)
    if (error) {
      setStatus(t('login.saveError', { msg: error.message }), 'text-red-600', false)
      return
    }
    location.href = 'bets.html'
  })

  const label = (key: string) => el('label', { class: 'block text-sm font-bold text-slate-700 mb-1' }, t(key))
  document.getElementById('onboard-root')!.replaceChildren(
    el(
      'div',
      { class: 'fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4' },
      el(
        'div',
        { class: 'bg-white rounded-2xl shadow-xl p-6 md:p-8 w-full max-w-md space-y-4' },
        el('h2', { class: 'text-blue-900 font-extrabold text-2xl' }, t('login.onboardTitle')),
        el('p', { class: 'text-slate-600 text-sm' }, t('login.onboardLead')),
        el('div', {}, label('login.handleLabel'), handleInput, status),
        el('div', {}, label('login.displayName'), displayInput),
        el('div', {}, label('login.twitter'), twitterInput),
        saveBtn,
      ),
    ),
  )
}
