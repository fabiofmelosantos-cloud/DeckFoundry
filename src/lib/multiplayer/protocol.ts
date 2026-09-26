import type { Color } from '../types'

// Wire format. Each player is the only writer of their own table; others receive
// a public snapshot (hand and library are counts only, never card identities).

export interface PresenceInfo {
  id: string
  name: string
  deckName: string
  colors: Color[]
  ready: boolean
  host: boolean
  joinedAt: number
  // Room settings travel with the host's presence
  size?: 2 | 4
  life?: number
}

/** A card as others see it on the table. */
export interface PubCard {
  u: number // instance id
  n: string // name
  i: string | null // small image
  t?: boolean // tapped
  l?: boolean // land
}

export interface PublicState {
  id: string
  life: number
  poison: number
  cmdDamage: Record<string, number>
  hand: number
  library: number
  mulligans: number
  phase: 'opening' | 'bottom' | 'play'
  battlefield: PubCard[]
  graveyard: PubCard[]
  exile: PubCard[]
  command: PubCard[]
}

export interface GameInfo {
  no: number
  order: string[] // seat order for this game
  active: string // whose turn it is
  turn: number
  lost: string[]
  winner?: string
}

export type Message =
  | { t: 'hello'; from: string }
  | { t: 'state'; from: string; s: PublicState }
  | { t: 'sync'; from: string; game: GameInfo | null; score: Record<string, number> }
  | { t: 'start'; from: string; game: GameInfo; score: Record<string, number> }
  | { t: 'pass'; from: string; active: string; turn: number }
  | { t: 'lost'; from: string; game: number }
  | { t: 'log'; from: string; text: string }
  | { t: 'roll'; from: string; label: string; value: string }

export interface LogEntry {
  at: number
  who: string
  text: string
}
