import he from '../i18n/he.json'
import en from '../i18n/en.json'
import type { Party } from './database.types'

export type Lang = 'he' | 'en'

const dicts: Record<Lang, Record<string, string>> = {
  he: he as Record<string, string>,
  en: en as Record<string, string>,
}

export function getLang(): Lang {
  return localStorage.getItem('lang') === 'en' ? 'en' : 'he'
}

/** Persist and reload — MPA pages re-render fully in the new language. */
export function switchLang(lang: Lang): void {
  localStorage.setItem('lang', lang)
  location.reload()
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[getLang()][key] ?? dicts.he[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

/** Translate static markup: data-i18n → textContent, data-i18n-placeholder → placeholder. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((n) => {
    n.textContent = t(n.dataset.i18n!)
  })
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((n) => {
    n.placeholder = t(n.dataset.i18nPlaceholder!)
  })
}

export function partyName(p: Party): string {
  return getLang() === 'he' ? p.name_he : p.name_en
}
