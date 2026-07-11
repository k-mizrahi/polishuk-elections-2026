// Hand-written row types matching supabase/migrations/0001_init.sql.
// Will be replaced by `supabase gen types typescript` once a project exists.

export type BetKind = 'poll' | 'final'
export type WeekStatus = 'scheduled' | 'open' | 'locked' | 'scored'
export type PollStatus = 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  handle: string | null
  display_name: string | null
  twitter_handle: string | null
  lang: 'he' | 'en'
  is_admin: boolean
  is_banned: boolean
  created_at: string
}

export interface Party {
  id: number
  code: string
  name_he: string
  name_en: string
  color: string
  active_from: string
  active_until: string | null
  sort_order: number
}

export interface GameWeek {
  id: number
  week_start: string
  week_end: string
  lock_at: string
  status: WeekStatus
  is_final_week: boolean
  avg_computed_at: string | null
}

export interface Poll {
  id: number
  pollster: string
  publisher: string | null
  fieldwork_start: string | null
  fieldwork_end: string
  sample_size: number | null
  source_url: string | null
  row_fingerprint: string
  status: PollStatus
  game_week_id: number | null
  admin_note: string | null
  scraped_at: string
}

export interface PollResult {
  poll_id: number
  party_id: number
  seats: number
  below_threshold: boolean
  pct: number | null
}

export interface Bet {
  id: number
  user_id: string
  week_id: number
  kind: BetKind
  is_carried: boolean
  carried_from_bet_id: number | null
  needs_review: boolean
  created_at: string
  updated_at: string
}

export interface BetLine {
  bet_id: number
  party_id: number
  seats: number
}

export interface WeeklyAverage {
  week_id: number
  party_id: number
  avg_seats: number
  n_polls: number
}

export interface Score {
  user_id: string
  week_id: number
  kind: BetKind
  error: number
  score: number
  computed_at: string
}

export interface OfficialResult {
  party_id: number
  seats: number
}

export interface LeaderboardRow {
  id: string
  handle: string
  display_name: string | null
  twitter_handle: string | null
  total: number
  final_total: number
  poll_total: number
  final_error_total: number
  weeks_played: number
  first_bet_at: string | null
}
