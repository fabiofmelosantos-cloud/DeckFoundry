import { useEffect, useState } from 'react'
import type { Card } from './types'
import { CARDS, displayName, isBasic, registerExtraCards } from './cardDb'
import { DECK_TEMPLATES } from '../data/seed/templates.js'
import { synergyBetween, tagLabel, tagsOf, type TagId } from './tags'

// "Buy potential": which cards are likely to rise in price, and why.
// It reads strategies from three places — new/upcoming commanders, themes the
// latest sets push, and established archetypes — and weighs them against
// demand, supply and price signals. These are estimates, never guarantees.

export interface MarketSignal {
  edhrec: number | null
  prints: number // 1, 2, 4 (= 3–4) or 5 (= five or more)
  reserved: boolean
  eur: number | null
  usd: number | null
  lastPrinted: string
  upcomingReprint?: { set: string; setName: string; date: string }
  cm?: { trend: number; low: number; avg1: number; avg7: number; avg30: number } // Cardmarket price guide
  cmUrl?: string
}
interface CatalystCommander {
  oracleId: string
  set: string
  setName: string
  releasedAt: string
  upcoming: boolean
}
interface MarketFile {
  generatedAt: string
  cards: Card[]
  signals: Record<string, MarketSignal>
  commanders: CatalystCommander[]
}
interface HistoryFile {
  dates: string[]
  eur: Record<string, (number | null)[]>
}

export type Part = 'demand' | 'supply' | 'catalyst' | 'value'
export interface Reason {
  kind: Part | 'momentum' | 'risk'
  tone: 'up' | 'down'
  text: string
  weight: number // signal strength — the thesis leads with the heaviest
}
export type Category = 'catalyst' | 'undervalued' | 'supply' | 'gap' | 'avoid'

export interface Potential {
  card: Card
  price: number
  score: number
  parts: Record<Part, number> // 0..1
  momentum: number | null // % change across the stored history
  history: { date: string; eur: number }[]
  reasons: Reason[]
  thesis: string
  risk: 'Low' | 'Medium' | 'High'
  horizon: 'Before release' | 'Weeks' | 'Months' | 'Long term'
  categories: Category[]
  catalysts: { commander: Card; setName: string; upcoming: boolean; releasedAt: string; reason: string }[]
  signal: MarketSignal
}

export interface StrategyRead {
  commanders: { card: Card; setName: string; upcoming: boolean; releasedAt: string }[]
  themes: { tag: TagId; label: string; weight: number }[]
  archetypes: number
}

export interface Market {
  generatedAt: string
  snapshots: string[]
  potentials: Potential[]
  byOracle: Map<string, Potential>
  strategies: StrategyRead
}

const CATALYST_PICKS = 6 // cards each new commander 'wants'
const WEIGHTS: Record<Part, number> = { demand: 30, supply: 25, catalyst: 25, value: 20 }
// Tags too common to signal a strategy (incl. creature types on half the cards in the game)
const GENERIC = new Set<string>(['removal', 'draw', 'etb', 'protection', 'flying', 'haste', 'ramp', 'big', 'tribe:Human', 'tribe:Soldier', 'tribe:Wizard', 'tribe:Cleric'])
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const yearsSince = (d: string, now: string) => (Date.parse(now) - Date.parse(d)) / (365.25 * 864e5)
const eur = (n: number) => `€${n.toFixed(2)}`

function percentileRanker(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return (v: number) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < v) lo = mid + 1
      else hi = mid
    }
    return sorted.length ? lo / sorted.length : 0
  }
}

function analyze(file: MarketFile, hist: HistoryFile): Market {
  const now = file.generatedAt
  const byOracleCard = new Map<string, Card>()
  for (const c of [...CARDS, ...file.cards]) if (!byOracleCard.has(c.oracleId)) byOracleCard.set(c.oracleId, c)

  // --- Strategy read -----------------------------------------------------------
  const commanders = file.commanders
    .map((k) => ({ card: byOracleCard.get(k.oracleId)!, setName: k.setName, upcoming: k.upcoming, releasedAt: k.releasedAt }))
    .filter((k) => k.card)
  const themeCounts = new Map<TagId, number>()
  const pushers = [...commanders.map((k) => k.card), ...CARDS.filter((c) => c.isNew)]
  for (const c of pushers) for (const t of tagsOf(c)) if (!GENERIC.has(t)) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1)
  const themes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag, n]) => ({ tag, label: tagLabel(tag), weight: n / pushers.length }))
  const pushed = new Set(themes.slice(0, 4).map((t) => t.tag))
  // Established archetypes: each one's dominant theme (from its key cards) and colours
  const archetypes = DECK_TEMPLATES.map((t) => {
    const counts = new Map<TagId, number>()
    for (const n of t.keyCards) {
      const c = CARDS.find((x) => x.name === n)
      if (c) for (const tg of tagsOf(c)) if (!GENERIC.has(tg)) counts.set(tg, (counts.get(tg) ?? 0) + 1)
    }
    return { name: t.name, colors: t.colors, theme: [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] }
  }).filter((a): a is { name: string; colors: Card['colors']; theme: TagId } => !!a.theme)

  // --- Universe + distributions -----------------------------------------------------
  const entries = Object.entries(file.signals)
    .map(([oid, s]) => ({ oid, s, card: byOracleCard.get(oid) }))
    .filter((e): e is { oid: string; s: MarketSignal; card: Card } => !!e.card && !isBasic(e.card) && (e.s.eur ?? e.card.prices.eur) != null)
  const priceOf = (e: { s: MarketSignal; card: Card }) => e.s.eur ?? e.card.prices.eur ?? 0
  const pricePct = percentileRanker(entries.map(priceOf))
  const rankPct = percentileRanker(entries.map((e) => -(e.s.edhrec ?? 99999)))
  const ratios = entries.filter((e) => e.s.usd && priceOf(e) >= 1).map((e) => (e.s.usd! * 0.92) / priceOf(e))
  const medianRatio = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)] ?? 1

  // Catalysts, EDHREC-style: each new commander keeps only its most *specific* high-synergy
  // cards. Pass 1 counts how many commanders each card pairs with (breadth); pass 2 lets each
  // commander pick its top few, penalising cards that half the commanders want anyway.
  const hits = new Map<string, { k: (typeof commanders)[number]; reason: string; score: number }[]>()
  for (const { oid, card } of entries) {
    const tags = tagsOf(card)
    for (const k of commanders) {
      if (k.card.oracleId === oid || !card.colorIdentity.every((c) => k.card.colorIdentity.includes(c))) continue
      const l = synergyBetween(k.card, card)
      // Real enabler→payoff pairs, or a tribe the commander names (not Humans & co.)
      const tribal = l?.kind === 'tribal' && !tags.some((t) => GENERIC.has(t) && t.startsWith('tribe:') && l.reason.includes(t.slice(6)))
      if (l && (l.kind === 'synergy' || tribal)) hits.set(oid, [...(hits.get(oid) ?? []), { k, reason: l.reason, score: l.score }])
    }
  }
  const catalystMap = new Map<string, Potential['catalysts']>()
  for (const k of commanders) {
    const ranked = entries
      .flatMap((e) => {
        const h = hits.get(e.oid)?.find((x) => x.k === k)
        if (!h) return []
        const breadth = hits.get(e.oid)!.length / commanders.length
        const demand = 1 - Math.log10(Math.max(1, e.s.edhrec ?? 9999)) / Math.log10(5000)
        return [{ e, h, s: h.score + demand * 1.5 - breadth * 6 }]
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, CATALYST_PICKS)
    for (const { e, h } of ranked)
      catalystMap.set(e.oid, [...(catalystMap.get(e.oid) ?? []), { commander: k.card, setName: k.setName, upcoming: k.upcoming, releasedAt: k.releasedAt, reason: h.reason }])
  }
  // Hype matters most before and right after release; older commanders are mostly priced in
  const timing = (c: { upcoming: boolean; releasedAt: string }) => (c.upcoming ? 1 : yearsSince(c.releasedAt, now) < 0.17 ? 0.7 : 0.35)

  const potentials: Potential[] = entries.map(({ oid, s, card }) => {
    const price = priceOf({ s, card })
    const reasons: Reason[] = []
    const categories: Category[] = []

    // Demand — how much the card is actually played
    const rank = s.edhrec ?? 99999
    let demand = clamp01(1 - Math.log10(Math.max(1, rank)) / Math.log10(5000))
    if (rank <= 1500)
      reasons.push({
        kind: 'demand',
        tone: 'up',
        weight: rank <= 100 ? 0.45 : 0.25,
        text: rank <= 100 ? `Top ${Math.max(10, Math.ceil(rank / 10) * 10)} most-played Commander card` : `Played widely in Commander (EDHREC #${rank})`,
      })
    const constructed = (['modern', 'legacy', 'pioneer'] as const).filter((f) => card.legalities[f] === 'legal').length
    if (constructed >= 2 && ['rare', 'mythic'].includes(card.rarity)) demand = clamp01(demand + 0.08)
    const cardTags = tagsOf(card)
    const fits = archetypes.filter((a) => cardTags.includes(a.theme) && card.colorIdentity.every((c) => a.colors.includes(c))).map((a) => a.name)
    if (fits.length) {
      demand = clamp01(demand + 0.05 * Math.min(2, fits.length))
      reasons.push({ kind: 'demand', tone: 'up', weight: 0.35, text: `Core to ${fits.slice(0, 2).join(' and ')}${fits.length > 2 ? ` (+${fits.length - 2} more)` : ''}` })
    }

    // Supply — how many copies can exist
    let supply = s.reserved ? 1 : s.prints === 1 ? 0.85 : s.prints === 2 ? 0.65 : s.prints === 4 ? 0.4 : 0.1
    const age = yearsSince(s.lastPrinted, now)
    if (!s.reserved && s.prints <= 4 && age >= 3) supply = clamp01(supply + (age >= 5 ? 0.25 : 0.15))
    if (s.reserved) reasons.push({ kind: 'supply', tone: 'up', weight: 1, text: 'Reserved List — can never be reprinted' })
    else if (s.prints === 1) reasons.push({ kind: 'supply', tone: 'up', weight: 0.8, text: 'Only one printing so far' })
    else if (s.prints === 2) reasons.push({ kind: 'supply', tone: 'up', weight: 0.6, text: 'Printed only twice' })
    if (!s.reserved && s.prints <= 4 && age >= 3) reasons.push({ kind: 'supply', tone: 'up', weight: 0.5, text: `Not reprinted since ${s.lastPrinted.slice(0, 4)}` })

    // Catalyst — new commanders that picked this card as one of their best fits
    const catalysts = catalystMap.get(oid) ?? []
    let catalyst = catalysts.reduce((a, c) => a + 0.45 * timing(c), 0)
    catalyst = clamp01(catalyst)
    const themeHits = cardTags.filter((t) => pushed.has(t))
    catalyst = clamp01(catalyst + Math.min(0.2, themeHits.length * 0.1))
    if (catalysts.length) {
      const first = catalysts.find((c) => c.upcoming) ?? catalysts[0]
      reasons.push({
        kind: 'catalyst',
        tone: 'up',
        weight: 0.9,
        text: `${first.upcoming ? 'Upcoming' : 'New'} commander ${displayName(first.commander).split(',')[0]} (${first.setName}) wants it${catalysts.length > 1 ? ` — plus ${catalysts.length - 1} more` : ''}`,
      })
      categories.push('catalyst')
    }
    if (themeHits.length) reasons.push({ kind: 'catalyst', tone: 'up', weight: 0.3, text: `${tagLabel(themeHits[0])} is a theme the newest sets are pushing` })

    // Value — cheap for how much it's played; EU lagging the US
    let value = clamp01(rankPct(-rank) - pricePct(price) + 0.15)
    if (value >= 0.55 && rank <= 1500) reasons.push({ kind: 'value', tone: 'up', weight: 0.55, text: `Cheap for how much it's played (${eur(price)})` })
    const ratio = s.usd && price >= 1 ? (s.usd * 0.92) / price : null
    const gap = ratio != null && ratio > medianRatio * 1.35
    if (gap) {
      value = clamp01(value + 0.35)
      categories.push('gap')
      reasons.push({ kind: 'value', tone: 'up', weight: 0.7, text: `US price is ${Math.round((ratio! / medianRatio - 1) * 100)}% above the usual EU/US gap — EU prices tend to follow` })
    }
    const recentReprint = s.prints > 1 && yearsSince(s.lastPrinted, now) < 0.33
    if (recentReprint) {
      value = clamp01(value + 0.1)
      reasons.push({ kind: 'value', tone: 'up', weight: 0.5, text: 'Reprinted recently — price is likely near its low' })
    }

    // Momentum — Cardmarket's 30-day average → 7-day average → current trend. Our own weekly
    // snapshots take over once they cover a longer span than Cardmarket's 30 days.
    const row = hist.eur[oid] ?? []
    const own = hist.dates.map((date, i) => ({ date, eur: row[i] })).filter((p): p is { date: string; eur: number } => p.eur != null && p.eur > 0)
    const ownSpanDays = own.length >= 2 ? (Date.parse(own[own.length - 1].date) - Date.parse(own[0].date)) / 864e5 : 0
    const cm = s.cm && s.cm.avg30 >= 0.3 && s.cm.trend > 0 && s.cm.avg7 > 0 ? s.cm : undefined
    let history: Potential['history'] = []
    let momentum: number | null = null
    let since = ''
    if (ownSpanDays > 30) {
      history = own
      momentum = own[own.length - 1].eur / own[0].eur - 1
      since = `since ${own[0].date}`
    } else if (cm) {
      history = [
        { date: '30-day average', eur: cm.avg30 },
        { date: '7-day average', eur: cm.avg7 },
        { date: 'Current trend', eur: cm.trend },
      ]
      momentum = cm.trend / cm.avg30 - 1
      since = 'vs its 30-day average on Cardmarket'
    }
    if (momentum != null && Math.abs(momentum) > 3) momentum = null // thin-market noise
    let adj = 0
    if (momentum != null) {
      const pct = Math.round(momentum * 100)
      if (momentum > 0.6) {
        adj -= 8
        reasons.push({ kind: 'momentum', tone: 'down', weight: 0.6, text: `Already up ${pct}% ${since} — the spike may be priced in` })
      } else if (momentum > 0.08) {
        adj += 6
        reasons.push({ kind: 'momentum', tone: 'up', weight: 0.65, text: `Trending up ${pct}% ${since}` })
      } else if (momentum < -0.15 && demand > 0.4) {
        adj += 4
        reasons.push({ kind: 'momentum', tone: 'up', weight: 0.5, text: `Down ${-pct}% ${since} while demand holds — a possible dip` })
      } else if (momentum < -0.15) {
        adj -= 4
        reasons.push({ kind: 'momentum', tone: 'down', weight: 0.45, text: `Falling: down ${-pct}% ${since}` })
      }
    }

    // Risk
    let risk: Potential['risk'] = s.reserved || s.prints <= 2 ? 'Low' : 'Medium'
    let penalty = 0
    if (s.upcomingReprint && /Secret Lair/i.test(s.upcomingReprint.setName)) {
      // Limited-run reprints add little supply
      penalty += 10
      risk = 'Medium'
      reasons.push({ kind: 'risk', tone: 'down', weight: 0.7, text: `Limited reprint coming in ${s.upcomingReprint.setName} (${s.upcomingReprint.date}) — small supply impact` })
    } else if (s.upcomingReprint) {
      penalty += 30
      risk = 'High'
      categories.push('avoid')
      reasons.push({ kind: 'risk', tone: 'down', weight: 1, text: `Reprint announced in ${s.upcomingReprint.setName} (${s.upcomingReprint.date}) — prices usually drop on release` })
    } else if (!s.reserved && s.prints >= 5 && price >= 20) {
      risk = 'High'
      penalty += 8
      reasons.push({ kind: 'risk', tone: 'down', weight: 0.6, text: 'Frequently reprinted at this price point' })
    }
    if (price < 0.5) {
      penalty += 12
      reasons.push({ kind: 'risk', tone: 'down', weight: 0.4, text: 'Bulk price — the upside is small in absolute terms' })
    }

    const parts = { demand, supply, catalyst, value }
    const raw = (Object.keys(WEIGHTS) as Part[]).reduce((a, p) => a + WEIGHTS[p] * parts[p], 0)
    const score = Math.round(Math.max(0, Math.min(100, raw + adj - penalty)))
    if (value >= 0.55 && demand >= 0.35 && !s.upcomingReprint) categories.push('undervalued')
    if (supply >= 0.6) categories.push('supply')

    reasons.sort((a, b) => b.weight - a.weight)
    const ups = reasons.filter((r) => r.tone === 'up')
    const horizon: Potential['horizon'] =
      catalyst >= 0.5 && catalysts.some((c) => c.upcoming) ? 'Before release' : catalyst >= 0.5 ? 'Weeks' : supply >= 0.6 ? 'Long term' : 'Months'
    return {
      card,
      price,
      score,
      parts,
      momentum,
      history,
      reasons,
      thesis: categories.includes('avoid') ? reasons.find((r) => r.kind === 'risk')!.text : ups.slice(0, 2).map((r) => r.text).join(' · ') || 'No strong upside signals right now.',
      risk,
      horizon,
      categories,
      catalysts,
      signal: s,
    }
  })

  potentials.sort((a, b) => b.score - a.score)
  return {
    generatedAt: file.generatedAt,
    snapshots: hist.dates,
    potentials,
    byOracle: new Map(potentials.map((p) => [p.card.oracleId, p])),
    strategies: { commanders, themes, archetypes: DECK_TEMPLATES.length },
  }
}

// ---- Lazy loading (market data is ~1.6 MB, so it's a separate chunk) ------------------
let cache: Market | null = null
let pending: Promise<Market> | null = null

export function loadMarket(): Promise<Market> {
  if (cache) return Promise.resolve(cache)
  pending ??= Promise.all([import('../data/market.json'), import('../data/price-history.json')]).then(([m, h]) => {
    const file = (m.default ?? m) as unknown as MarketFile
    registerExtraCards(file.cards)
    cache = analyze(file, (h.default ?? h) as unknown as HistoryFile)
    return cache
  })
  return pending
}

export function useMarket(): Market | null {
  const [m, setM] = useState<Market | null>(cache)
  useEffect(() => {
    if (!m) loadMarket().then(setM)
  }, [m])
  return m
}
