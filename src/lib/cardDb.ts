import rawCards from '../data/cards.json'
import rawSets from '../data/sets.json'
import type { Card, CardSet, Color } from './types'

// The external card database. Swapping this for a live API only needs these accessors.
export const CARDS = rawCards as Card[]
export const SETS = rawSets as CardSet[]

const byId = new Map(CARDS.map((c) => [c.id, c]))
const inPool = new Set(CARDS.map((c) => c.id)) // ids that are part of CARDS (the builder's pool)
const poolNames = new Set(CARDS.map((c) => c.name))
const byName = new Map<string, Card>()
for (const c of CARDS) {
  byName.set(c.name.toLowerCase(), c)
  // Double-faced cards are also addressable by their front face.
  if (c.name.includes(' // ')) byName.set(c.name.split(' // ')[0].toLowerCase(), c)
}

/**
 * Cards loaded on demand (the market universe). They become addressable by id/name
 * for card pages, but stay out of CARDS so the deck builder only uses the core set.
 */
export function registerExtraCards(cards: Card[]) {
  for (const c of cards) {
    if (byId.has(c.id)) continue
    byId.set(c.id, c)
    const key = c.name.toLowerCase()
    if (!byName.has(key)) byName.set(key, c)
  }
}

/**
 * Cards from the user's imports. Unlike market cards they join CARDS, because
 * cards you own must be usable by the deck builder and discovery.
 */
export function registerUserCards(cards: Card[]) {
  for (const c of cards) {
    if (inPool.has(c.id)) continue
    const known = byId.get(c.id) // may already be registered as a market card
    if (!known) byId.set(c.id, c)
    // One printing per card name in the pool — ownership is counted by name, and the
    // builder must never see two "Sol Ring"s (Commander is singleton)
    if (poolNames.has(c.name)) continue
    CARDS.push(known ?? c)
    inPool.add(c.id)
    poolNames.add(c.name)
    if (known) continue
    const key = c.name.toLowerCase()
    if (!byName.has(key)) byName.set(key, c)
    if (c.name.includes(' // ')) {
      const front = c.name.split(' // ')[0].toLowerCase()
      if (!byName.has(front)) byName.set(front, c)
    }
  }
}

export const getCard = (id: string) => byId.get(id)
export const findCard = (name: string) => byName.get(name.toLowerCase())

export function cardByName(name: string): Card {
  const c = findCard(name)
  if (!c) throw new Error(`Card not in database: ${name}`)
  return c
}

export const displayName = (c: Card) => c.name.split(' // ')[0]
export const price = (c: Card, foil = false) => (foil ? c.prices.eurFoil ?? c.prices.eur ?? 0 : c.prices.eur ?? 0)

export const BASICS: Record<Color, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
export const isBasic = (c: Card) => /^Basic Land/.test(c.typeLine)
export const isLand = (c: Card) => /\bLand\b/.test(c.typeLine.split(' // ')[0])
export const isCreature = (c: Card) => /\bCreature\b/.test(c.typeLine.split(' // ')[0])
export const isLegendaryCreature = (c: Card) => /Legendary.*Creature/.test(c.typeLine.split(' // ')[0])

export function primaryType(c: Card): string {
  const t = c.typeLine.split(' // ')[0]
  for (const k of ['Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']) {
    if (t.includes(k)) return k
  }
  return 'Other'
}

export function searchCards(q: string, limit = 12): Card[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const starts: Card[] = []
  const contains: Card[] = []
  for (const c of CARDS) {
    const n = c.name.toLowerCase()
    if (n.startsWith(s)) starts.push(c)
    else if (n.includes(s)) contains.push(c)
  }
  return [...starts, ...contains].slice(0, limit)
}

export function setName(code: string) {
  return SETS.find((s) => s.code === code)?.name ?? CARDS.find((c) => c.set === code)?.setName ?? code.toUpperCase()
}
