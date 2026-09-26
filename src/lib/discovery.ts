import { useMemo } from 'react'
import type { Card, Deck, DeckAnalysis, Preferences } from './types'
import { DECK_TEMPLATES } from '../data/seed/templates.js'
import { analyzeDeck, templateToDeck } from './analysis'
import { buildDeck, commanderCandidates } from './builder'
import { CARDS, SETS, isBasic, isLand, price } from './cardDb'
import { hydrateDeck, useOwned, useStore } from './store'
import { synergyBetween, tagsOf } from './tags'

const CURATED: Deck[] = DECK_TEMPLATES.map(templateToDeck)

/** Commander strategies the collection supports right now (owned cards only). */
function commanderStrategies(owned: Map<string, number>, prefs: Preferences): Deck[] {
  const cmds = commanderCandidates(owned)
    .map((c) => ({ c, n: CARDS.filter((x) => !isLand(x) && (owned.get(x.name) ?? 0) > 0 && x.colorIdentity.every((k) => c.colorIdentity.includes(k))).length }))
    .filter((x) => x.c.colorIdentity.length >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
  return cmds.map(({ c }, i) => {
    const d = buildDeck(
      { kind: 'commander', onlyOwned: false, budget: 12, aroundCard: c, themes: [], weird: false, competitive: false, seed: 1000 + i, mode: 'commander' },
      owned,
      prefs,
    )
    return { ...d, id: `cmd-${c.id.slice(0, 8)}` }
  })
}

export function useDiscovery() {
  const owned = useOwned()
  const prefs = useStore((s) => s.prefs)
  const generatedRaw = useStore((s) => s.generated)
  const savedRaw = useStore((s) => s.saved)

  const commander = useMemo(() => commanderStrategies(owned, prefs), [owned, prefs])
  const generated = useMemo(() => generatedRaw.map(hydrateDeck), [generatedRaw])
  const saved = useMemo(() => savedRaw.map(hydrateDeck), [savedRaw])

  return useMemo(() => {
    const seen = new Set<string>()
    const all: DeckAnalysis[] = []
    for (const d of [...CURATED, ...commander, ...generated, ...saved]) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      all.push(analyzeDeck(d, owned))
    }
    const fit = (a: DeckAnalysis) => {
      let s = a.pct
      if (a.deck.colors.some((c) => prefs.colors.includes(c))) s += 4
      if (a.deck.format !== 'casual' && prefs.formats.includes(a.deck.format)) s += 3
      if (prefs.competition === 'competitive' && a.deck.mode === 'meta') s += 4
      if (prefs.competition === 'casual' && a.deck.mode === 'kitchen') s += 4
      if (a.costToComplete > prefs.budget) s -= 6
      if (prefs.styles.some((st) => `${a.deck.strategy} ${a.deck.name}`.toLowerCase().includes(st))) s += 3
      return s
    }
    const ranked = [...all].sort((a, b) => fit(b) - fit(a))
    const byId = new Map(all.map((a) => [a.deck.id, a]))
    return {
      all: ranked,
      byId,
      ready: all.filter((a) => a.pct === 100),
      curated: ranked.filter((a) => a.deck.origin === 'curated'),
      commander: ranked.filter((a) => a.deck.mode === 'commander'),
      lab: generated.map((d) => byId.get(d.id)!).filter(Boolean),
      saved: saved.map((d) => byId.get(d.id)!).filter(Boolean),
      savedIds: new Set(saved.map((d) => d.id)),
      hero: ranked.filter((a) => a.pct < 100 && a.pct >= 85 && a.deck.origin === 'curated').sort((a, b) => fit(b) - fit(a))[0] ?? ranked[0],
      owned,
    }
  }, [owned, commander, generated, saved, prefs])
}

export type Discovery = ReturnType<typeof useDiscovery>

// ---- Smart buy list ---------------------------------------------------------
export interface BuyAdvice {
  card: Card
  price: number
  unlocks: DeckAnalysis[] // decks this single card completes
  improves: DeckAnalysis[] // decks it moves closer to completion
  competitive: number
  casual: number
  commander: number
  score: number
}

export function buyList(analyses: DeckAnalysis[]): BuyAdvice[] {
  const map = new Map<string, BuyAdvice>()
  for (const a of analyses) {
    const distinctMissing = a.missing.length
    for (const m of a.missing) {
      const e = map.get(m.card.name) ?? { card: m.card, price: price(m.card), unlocks: [], improves: [], competitive: 0, casual: 0, commander: 0, score: 0 }
      if (distinctMissing === 1) e.unlocks.push(a)
      else e.improves.push(a)
      if (a.deck.mode === 'meta') e.competitive++
      else if (a.deck.mode === 'commander') e.commander++
      else e.casual++
      e.score += (m.impact / 100) * (1 + 3 / distinctMissing) * m.need
      map.set(m.card.name, e)
    }
  }
  // Value per euro, but a card that touches many decks always floats up
  return [...map.values()]
    .map((e) => ({ ...e, score: (e.score * Math.pow(e.unlocks.length + e.improves.length, 1.3)) / Math.pow(Math.max(0.5, e.price), 0.35) }))
    .sort((a, b) => b.score - a.score)
}

// ---- What did I miss? -----------------------------------------------------------
export interface NewCardInsight {
  card: Card
  synergies: { card: Card; reason: string }[]
  competitive: number // 0..100
  kitchen: number // 0..100
}

// Top 8, at most 3 per set, so one synergy-heavy set doesn't crowd out the rest
const spread = (list: NewCardInsight[]) => {
  const per = new Map<string, number>()
  return list
    .filter((i) => {
      const n = per.get(i.card.set) ?? 0
      per.set(i.card.set, n + 1)
      return n < 3
    })
    .slice(0, 8)
}

export function whatsNew(since: string, owned: Map<string, number>) {
  const sets = SETS.filter((s) => s.releasedAt > since).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))
  const codes = new Set(sets.map((s) => s.code))
  const ownedCards = [...owned.entries()].filter(([, q]) => q > 0).flatMap(([n]) => CARDS.filter((c) => c.name === n && !isBasic(c) && !c.isNew))
  const newCards = CARDS.filter((c) => c.isNew && codes.has(c.set))

  const insights: NewCardInsight[] = newCards.map((card) => {
    const synergies = ownedCards
      .map((o) => ({ card: o, l: synergyBetween(card, o) }))
      .filter((x) => x.l && x.l.score >= 2)
      .sort((a, b) => b.l!.score - a.l!.score)
      .map((x) => ({ card: x.card, reason: x.l!.reason }))
    const constructedLegal = ['standard', 'pioneer', 'modern'].some((f) => card.legalities[f as 'modern'] === 'legal')
    const competitive = Math.min(100, Math.round((constructedLegal ? 30 : 0) + Math.min(50, price(card) * 4) + (card.rarity === 'mythic' ? 12 : 6)))
    const kitchen = Math.min(100, Math.round(Math.sqrt(synergies.length) * 10 + (card.edhrecRank ? Math.max(0, 20 - card.edhrecRank / 500) : 0)))
    return { card, synergies, competitive, kitchen }
  })

  // Mechanics: keywords introduced in the new sets that none of your cards have
  const ownedKw = new Set(ownedCards.flatMap((c) => c.keywords))
  const mechanics = new Map<string, { set: string; cards: Card[] }>()
  for (const c of newCards)
    for (const k of c.keywords)
      if (!ownedKw.has(k)) {
        const m = mechanics.get(k) ?? { set: c.setName, cards: [] }
        m.cards.push(c)
        mechanics.set(k, m)
      }

  // Owned cards that gained relevance: most new synergy partners
  const relevance = new Map<string, { card: Card; partners: Card[] }>()
  for (const ins of insights)
    for (const s of ins.synergies) {
      const r = relevance.get(s.card.name) ?? { card: s.card, partners: [] }
      r.partners.push(ins.card)
      relevance.set(s.card.name, r)
    }

  // New archetype signals: themes the new cards push hardest
  const themeCounts = new Map<string, number>()
  for (const c of newCards) for (const t of tagsOf(c)) if (!['removal', 'draw', 'etb', 'protection', 'flying', 'haste'].includes(t)) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1)

  return {
    sets,
    insights,
    competitive: spread([...insights].sort((a, b) => b.competitive - a.competitive)),
    kitchen: spread([...insights].sort((a, b) => b.kitchen - a.kitchen)),
    mechanics: [...mechanics.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cards.length - a.cards.length).slice(0, 8),
    risers: [...relevance.values()].sort((a, b) => b.partners.length - a.partners.length).slice(0, 8),
    themes: [...themeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  }
}

