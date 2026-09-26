// ---- Card database (external, read-only) ----------------------------------
export type Color = 'W' | 'U' | 'B' | 'R' | 'G'
export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus'
export type Format = 'standard' | 'pioneer' | 'modern' | 'legacy' | 'vintage' | 'commander' | 'pauper'

export interface Card {
  id: string
  oracleId: string
  name: string
  set: string
  setName: string
  collectorNumber: string
  rarity: Rarity
  manaCost: string
  cmc: number
  colors: Color[]
  colorIdentity: Color[]
  typeLine: string
  oracleText: string
  keywords: string[]
  power?: string
  toughness?: string
  legalities: Record<Format, 'legal' | 'not_legal' | 'banned' | 'restricted'>
  prices: { eur: number | null; eurFoil: number | null; estimated: boolean }
  image: string | null
  imageSmall: string | null
  artCrop: string | null
  releasedAt: string
  edhrecRank: number | null
  isNew: boolean
}

export interface CardSet {
  code: string
  name: string
  releasedAt: string
  icon: string
  cardCount: number
  recent: boolean
}

// ---- Personal data (user-owned, persisted separately) ----------------------
export interface CollectionEntry {
  cardId: string
  qty: number
  foil: boolean
  acquiredAt: string // ISO date
}

export type PlayStyle = 'aggro' | 'midrange' | 'control' | 'combo' | 'tribal' | 'graveyard' | 'tokens' | 'weird'

export interface Preferences {
  username: string
  formats: Format[]
  competition: 'casual' | 'balanced' | 'competitive'
  budget: number // € per deck to complete
  colors: Color[]
  styles: PlayStyle[]
  gameTypes: ('commander' | 'casual' | 'constructed')[]
  novelty: number // 0 = known lists, 100 = original experiments
  lastPlayed: string // ISO date, drives "What did I miss?"
}

// ---- Decks ------------------------------------------------------------------
export type DeckMode = 'meta' | 'kitchen' | 'lab' | 'commander'
export type Power = 'Competitive' | 'High Power' | 'Mid Power' | 'Casual'

export interface DeckTemplate {
  id: string
  name: string
  colors: Color[]
  targetFormat: Format
  mode: DeckMode
  power: Power
  strategy: string
  tagline: string
  description: string
  keyCards: string[]
  winCondition: string
  strengths: string[]
  weaknesses: string[]
  spells: [number, string][]
  lands: [number, string][]
}

export interface DeckCard {
  card: Card
  qty: number
  commander?: boolean
}

/** A deck definition — either a curated template or AI-generated. */
export interface Deck {
  id: string
  name: string
  colors: Color[]
  format: Format | 'casual'
  mode: DeckMode
  power: Power
  strategy: string
  tagline: string
  description: string
  cards: DeckCard[]
  commander?: Card
  keyCards: string[]
  winCondition: string
  strengths: string[]
  weaknesses: string[]
  origin: 'curated' | 'ai' | 'imported'
  prompt?: string
  reasoning?: string[]
  experiment?: number
}

export interface MissingCard {
  card: Card
  need: number
  owned: number
  cost: number
  impact: number // 0..100
  role: string
}

/** A deck evaluated against the user's collection. */
export interface DeckAnalysis {
  deck: Deck
  total: number
  owned: number
  pct: number
  missing: MissingCard[]
  costToComplete: number
  deckValue: number
  legalIn: Format[]
  combos: { cards: string[]; result: string }[]
  curve: number[] // index 0..7 (7 = 7+), non-land only
  types: Record<string, number>
}
