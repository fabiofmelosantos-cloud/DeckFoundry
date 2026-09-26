import type { Card, DeckAnalysis } from './types'
import { displayName, findCard, getCard, isBasic, price } from './cardDb'
import { synergyBetween } from './tags'
import type { CollectionEntry } from './types'

export interface Highlight {
  a: Card
  b: Card
  text: string
  combo: boolean
}

/** The most compelling interactions inside a deck, for "Why this deck?". */
export function deckHighlights(a: DeckAnalysis, max = 3): Highlight[] {
  const out: Highlight[] = []
  const used = new Set<string>()
  for (const cb of a.combos) {
    const [x, y] = cb.cards.map((n) => findCard(n)!)
    out.push({ a: x, b: y, text: cb.result, combo: true })
    used.add(x.name + y.name)
  }
  const key = a.deck.keyCards.map((n) => findCard(n)).filter(Boolean) as Card[]
  const pool = [...key, ...a.deck.cards.map((c) => c.card).filter((c) => !isBasic(c) && !key.includes(c))].slice(0, 12)
  const cand: (Highlight & { s: number })[] = []
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const l = synergyBetween(pool[i], pool[j])
      if (!l || l.kind === 'strategy') continue
      cand.push({ a: pool[i], b: pool[j], text: l.reason, combo: false, s: l.score + (i < key.length ? 1 : 0) + (j < key.length ? 1 : 0) })
    }
  cand.sort((x, y) => y.s - x.s)
  const seen = new Set<string>()
  for (const c of cand) {
    if (out.length >= max) break
    if (used.has(c.a.name + c.b.name) || seen.has(c.a.name) || seen.has(c.b.name)) continue
    seen.add(c.a.name)
    seen.add(c.b.name)
    out.push(c)
  }
  return out.slice(0, max)
}

export function collectionStats(col: CollectionEntry[]) {
  let total = 0
  let value = 0
  const unique = new Set<string>()
  for (const e of col) {
    const c = getCard(e.cardId)
    if (!c) continue
    total += e.qty
    if (!isBasic(c)) unique.add(c.name)
    value += price(c, e.foil) * e.qty
  }
  return { total, unique: unique.size, value }
}

export const hello = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export const shortName = (c: Card) => displayName(c).split(',')[0]
