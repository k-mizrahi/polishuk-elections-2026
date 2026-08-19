import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { GameWeek, Party, Profile } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when env vars are absent — pages must degrade to skeleton/empty states. */
export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon) : null

export async function getProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  return (data as Profile | null) ?? null
}

/** All game weeks ordered by week_start — week "number" is 1-based position here. */
export async function fetchWeeks(): Promise<GameWeek[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('game_weeks').select('*').order('week_start')
  if (error) throw error
  return (data ?? []) as GameWeek[]
}

export function weekNumber(weeks: GameWeek[], weekId: number): number {
  return weeks.findIndex((w) => w.id === weekId) + 1
}

export async function fetchParties(): Promise<Party[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('parties').select('*').order('sort_order')
  if (error) throw error
  return (data ?? []) as Party[]
}

/** docs/04: active in week w iff active_from <= week_end and (active_until is null or >= week_start). */
export function activeParties(parties: Party[], week: GameWeek): Party[] {
  return parties.filter(
    (p) =>
      p.active_from <= week.week_end &&
      (p.active_until === null || p.active_until >= week.week_start),
  )
}
