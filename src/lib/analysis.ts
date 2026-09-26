import type { Card, Color, Deck, DeckAnalysis, DeckTemplate, Format, MissingCard } from './types'
import { BASICS, cardByName, isBasic, isCreature, isLand, price, primaryType } from './cardDb'
import { COMBOS } from '../data/seed/templates.js'
import { tagsOf } from './tags'

export const FORMAT_LABEL: Record<Format | 'casual', string> = {
  standard: 'Standard', pioneer: 'Pioneer', modern: 'Modern', legacy: 'Legacy', vintage: 'Vintage',
  commander: 'Commander', pauper: 'Pauper', casual: 'Casual',
}

export const GUILDS: Record<string, string> = {
  W: 'Mono-White', U: 'Mono-Blue', B: 'Mono-Black', R: 'Mono-Red', G: 'Mono-Green',
  WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', GW: 'Selesnya', WB: 'Orzhov', UR: 'Izzet',
  BG: 'Golgari', RW: 'Boros', GU: 'Simic', WUB: 'Esper', UBR: 'Grixis', BRG: 'Jund', RGW: 'Naya',
  GWU: 'Bant', WBG: 'Abzan', URW: 'Jeskai', BGU: 'Sultai', RWB: 'Mardu', GUR: 'Temur',
}
const ORDER: Color[] = ['W', 'U', 'B', 'R', 'G']
export const sortColors = (cs: Color[]) => [...new Set(cs)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
export function guildName(cs: Color[]) {
  const s = sortColors(cs)
  if (s.length === 0) return 'Colorless'
  if (s.length >= 4) return s.length === 5 ? 'Five-Color' : 'Four-Color'
  const key = s.join('')
  // Wedge/pair keys are cyclic; try every rotation
  for (let i = 0; i < s.length; i++) {
    const rot = [...s.slice(i), ...s.slice(0, i)].join('')
    if (GUILDS[rot]) return GUILDS[rot]
  }
  return GUILDS[key] ?? key
}

/** Fill basics so a list reaches `size`, split by coloured pips in the spells. */
export function fillBasics(cards: { card: Card; qty: number }[], colors: Color[], size: number) {
  const current = cards.reduce((a, c) => a + c.qty, 0)
  const need = size - current
  if (need <= 0 || colors.length === 0) return cards
  const pips: Record<string, number> = {}
  for (const { card, qty } of cards) {
    for (const col of colors) pips[col] = (pips[col] ?? 0) + (card.manaCost.split(`{${col}}`).length - 1) * qty
  }
  const totalPips = colors.reduce((a, c) => a + (pips[c] || 1), 0)
  const out = [...cards]
  let left = need
  colors.forEach((col, i) => {
    const n = i === colors.length - 1 ? left : Math.round((need * (pips[col] || 1)) / totalPips)
    left -= n
    if (n > 0) out.push({ card: cardByName(BASICS[col]), qty: n })
  })
  return out
}

export function templateToDeck(t: DeckTemplate): Deck {
  const listed = [...t.spells, ...t.lands].map(([qty, name]) => ({ card: cardByName(name), qty }))
  return {
    id: t.id,
    name: t.name,
    colors: t.colors,
    format: t.targetFormat,
    mode: t.mode,
    power: t.power,
    strategy: t.strategy,
    tagline: t.tagline,
    description: t.description,
    cards: fillBasics(listed, t.colors, 60),
    keyCards: t.keyCards,
    winCondition: t.winCondition,
    strengths: t.strengths,
    weaknesses: t.weaknesses,
    origin: 'curated',
  }
}

export function roleOf(c: Card, deck: Deck): string {
  if (deck.commander?.id === c.id) return 'Commander'
  if (deck.keyCards.includes(c.name)) return 'Key card'
  if (isLand(c)) return 'Mana base'
  const tags = tagsOf(c)
  if (tags.includes('removal') || tags.includes('counterspell') || tags.includes('wipe')) return 'Interaction'
  if (tags.includes('ramp')) return 'Ramp'
  if (tags.includes('draw')) return 'Card advantage'
  if (isCreature(c)) return 'Threat'
  return 'Support'
}

const ROLE_IMPACT: Record<string, number> = {
  Commander: 100, 'Key card': 92, Interaction: 70, Threat: 64, 'Card advantage': 60, Ramp: 56, Support: 48, 'Mana base': 38,
}

export function analyzeDeck(deck: Deck, owned: Map<string, number>): DeckAnalysis {
  let total = 0
  let have = 0
  let deckValue = 0
  const missing: MissingCard[] = []
  const curve = Array(8).fill(0)
  const types: Record<string, number> = {}
  const names = new Set(deck.cards.map((c) => c.card.name))

  for (const { card, qty } of deck.cards) {
    total += qty
    deckValue += price(card) * qty
    const t = primaryType(card)
    types[t] = (types[t] ?? 0) + qty
    if (!isLand(card)) curve[Math.min(7, Math.floor(card.cmc))] += qty
    // Basic lands are always considered available.
    const o = isBasic(card) ? qty : Math.min(qty, owned.get(card.name) ?? 0)
    have += o
    if (o < qty) {
      const role = roleOf(card, deck)
      const needN = qty - o
      // Impact grows with the role, with how many copies the list plays, and with synergy density
      const synergyBonus = Math.min(8, tagsOf(card).filter((tg) => deck.cards.some((d) => d.card.id !== card.id && tagsOf(d.card).includes(tg))).length * 2)
      missing.push({
        card,
        need: needN,
        owned: o,
        cost: Math.round(price(card) * needN * 100) / 100,
        role,
        impact: Math.min(100, (ROLE_IMPACT[role] ?? 50) + (qty >= 4 ? 4 : 0) + synergyBonus),
      })
    }
  }
  missing.sort((a, b) => b.impact - a.impact || b.need - a.need)

  const formats: Format[] = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander']
  const legalIn = formats.filter((f) => {
    if (f === 'commander') return !!deck.commander && deck.cards.every((c) => c.card.legalities.commander === 'legal')
    if (deck.commander) return false
    return total >= 60 && deck.cards.every((c) => ['legal', 'restricted'].includes(c.card.legalities[f]))
  })

  return {
    deck,
    total,
    owned: have,
    pct: total ? Math.round((have / total) * 100) : 0,
    missing,
    costToComplete: Math.round(missing.reduce((a, m) => a + m.cost, 0) * 100) / 100,
    deckValue: Math.round(deckValue * 100) / 100,
    legalIn,
    combos: COMBOS.filter((cb) => cb.cards.every((n) => names.has(n))),
    curve,
    types,
  }
}

export const cardsAway = (a: DeckAnalysis) => a.missing.reduce((s, m) => s + m.need, 0)
