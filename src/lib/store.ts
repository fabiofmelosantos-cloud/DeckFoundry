import { useSyncExternalStore } from 'react'
import type { CollectionEntry, Deck, Preferences, Card, Color } from './types'
import { CARDS, getCard, findCard, isBasic } from './cardDb'
import { DECK_TEMPLATES, SEED_OWNED_OVERRIDES } from '../data/seed/templates.js'
import type { DeckTemplate } from './types'
import { mulberry32 } from './random'

// Personal data lives here, fully separate from the card database.
// Persisted to localStorage; the shape is what a backend would store per user.

interface SerializedDeck extends Omit<Deck, 'cards' | 'commander'> {
  cards: [string, number, boolean?][]
  commanderId?: string
}

interface State {
  version: number
  collection: CollectionEntry[]
  prefs: Preferences
  saved: SerializedDeck[] // decks the user saved (curated or AI)
  generated: SerializedDeck[] // AI / lab decks created in this profile
  experimentCounter: number
  lastScan?: { at: string; count: number }
  isDemo?: boolean // true while the collection is generated demo data
}

const KEY = 'deckfoundry:v1'

export const DEFAULT_PREFS: Preferences = {
  username: 'Planeswalker',
  formats: ['modern', 'commander'],
  competition: 'balanced',
  budget: 30,
  colors: ['B', 'G'],
  styles: ['graveyard', 'midrange', 'combo'],
  gameTypes: ['commander', 'casual', 'constructed'],
  novelty: 55,
  lastPlayed: '2025-06-01',
}

function seedCollection(): CollectionEntry[] {
  const rand = mulberry32(4827)
  const entries = new Map<string, CollectionEntry>()
  const date = (from: number, to: number) => {
    const t = from + rand() * (to - from)
    return new Date(t).toISOString().slice(0, 10)
  }
  const OLD = Date.parse('2019-03-01')
  const MID = Date.parse('2024-06-01')
  const NOW = Date.parse('2026-09-20')
  const add = (c: Card, qty: number, acquiredAt: string, foil = false) => {
    if (qty <= 0) return
    const key = c.id + (foil ? ':f' : '')
    const e = entries.get(key)
    if (e) e.qty += qty
    else entries.set(key, { cardId: c.id, qty, foil, acquiredAt })
  }

  // Cards used by curated archetypes (so discovery has something to find)
  const need = new Map<string, number>()
  for (const t of DECK_TEMPLATES as DeckTemplate[]) {
    for (const [q, n] of [...t.spells, ...t.lands]) need.set(n, Math.max(need.get(n) ?? 0, q))
  }
  const overrides = SEED_OWNED_OVERRIDES as Record<string, number>
  for (const [name, q] of need) {
    const c = findCard(name)!
    const qty = overrides[name] ?? q
    // Split a few copies into foil for realism
    if (qty >= 3 && rand() < 0.15) {
      add(c, qty - 1, date(OLD, MID))
      add(c, 1, date(OLD, MID), true)
    } else add(c, qty, date(OLD, MID))
  }
  const templateNames = new Set(need.keys())

  // Bulk of the collection: a random ~65% of the broader pool
  for (const c of CARDS) {
    if (templateNames.has(c.name)) continue
    if (isBasic(c)) {
      add(c, 24 + Math.floor(rand() * 40), date(OLD, MID))
      continue
    }
    if (c.isNew) {
      if (rand() < 0.18) add(c, 1, date(Date.parse(c.releasedAt), NOW))
      continue
    }
    if (rand() > 0.66) continue
    const r = c.rarity
    const qty = r === 'common' ? 1 + Math.floor(rand() * 7) : r === 'uncommon' ? 1 + Math.floor(rand() * 4) : r === 'rare' ? 1 + Math.floor(rand() * 2) : 1
    add(c, qty, date(OLD, NOW), rand() < 0.07)
  }
  return [...entries.values()]
}

function initial(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as State
      if (s.version === 1) return { ...s, isDemo: s.isDemo ?? true, prefs: { ...DEFAULT_PREFS, ...s.prefs } }
    }
  } catch {
    /* storage unavailable — fall through to seed */
  }
  return { version: 1, collection: seedCollection(), prefs: DEFAULT_PREFS, saved: [], generated: [], experimentCounter: 20, isDemo: true }
}

let state: State = initial()
const listeners = new Set<() => void>()
let ownedCache: { ref: CollectionEntry[]; map: Map<string, number> } | null = null

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore quota / private mode */
  }
  listeners.forEach((l) => l())
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sel(state),
  )
}
export const getState = () => state

/** Owned copies per card name (all printings, foil + non-foil). */
export function ownedMap(collection = state.collection): Map<string, number> {
  if (ownedCache?.ref === collection) return ownedCache.map
  const map = new Map<string, number>()
  for (const e of collection) {
    const c = getCard(e.cardId)
    if (c) map.set(c.name, (map.get(c.name) ?? 0) + e.qty)
  }
  ownedCache = { ref: collection, map }
  return map
}
export const useOwned = () => ownedMap(useStore((s) => s.collection))

// ---- Collection actions ----------------------------------------------------
export function addToCollection(items: { cardId: string; qty: number; foil?: boolean }[]) {
  set((s) => {
    const col = s.collection.map((e) => ({ ...e }))
    const today = new Date().toISOString().slice(0, 10)
    for (const it of items) {
      const e = col.find((x) => x.cardId === it.cardId && x.foil === !!it.foil)
      if (e) e.qty += it.qty
      else col.push({ cardId: it.cardId, qty: it.qty, foil: !!it.foil, acquiredAt: today })
    }
    const count = items.reduce((a, i) => a + i.qty, 0)
    return { collection: col, lastScan: { at: new Date().toISOString(), count } }
  })
}
export function setEntryQty(cardId: string, foil: boolean, qty: number) {
  set((s) => ({
    collection:
      qty <= 0
        ? s.collection.filter((e) => !(e.cardId === cardId && e.foil === foil))
        : s.collection.map((e) => (e.cardId === cardId && e.foil === foil ? { ...e, qty } : e)),
  }))
}
/** Replace the whole collection (e.g. importing your real one over the demo data). */
export function replaceCollection(items: { cardId: string; qty: number; foil?: boolean; acquiredAt?: string }[]) {
  const today = new Date().toISOString().slice(0, 10)
  const merged = new Map<string, CollectionEntry>()
  for (const it of items) {
    const key = it.cardId + (it.foil ? ':f' : '')
    const e = merged.get(key)
    if (e) e.qty += it.qty
    else merged.set(key, { cardId: it.cardId, qty: it.qty, foil: !!it.foil, acquiredAt: it.acquiredAt ?? today })
  }
  // Decks generated from the demo cards no longer describe this collection
  set({ collection: [...merged.values()], isDemo: false, generated: [] })
}
export const clearCollection = () => set({ collection: [], isDemo: false, generated: [] })

export const setPrefs = (p: Partial<Preferences>) => set((s) => ({ prefs: { ...s.prefs, ...p } }))
export function resetDemo() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
  state = { version: 1, collection: seedCollection(), prefs: DEFAULT_PREFS, saved: [], generated: [], experimentCounter: 20, isDemo: true }
  listeners.forEach((l) => l())
}

// ---- Deck persistence -------------------------------------------------------
export function serializeDeck(d: Deck): SerializedDeck {
  const { cards, commander, ...rest } = d
  return { ...rest, cards: cards.map((c) => [c.card.id, c.qty, c.commander] as [string, number, boolean?]), commanderId: commander?.id }
}
export function hydrateDeck(s: SerializedDeck): Deck {
  const { cards, commanderId, ...rest } = s
  return {
    ...rest,
    cards: cards.flatMap(([id, qty, commander]) => {
      const card = getCard(id)
      return card ? [{ card, qty, commander }] : []
    }),
    commander: commanderId ? getCard(commanderId) : undefined,
  }
}
export function saveDeck(d: Deck) {
  set((s) => ({ saved: [serializeDeck(d), ...s.saved.filter((x) => x.id !== d.id)] }))
}
export const unsaveDeck = (id: string) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) }))
export function storeGenerated(d: Deck) {
  set((s) => ({ generated: [serializeDeck(d), ...s.generated.filter((x) => x.id !== d.id)].slice(0, 40) }))
}
export function nextExperimentNumber() {
  const n = state.experimentCounter + 1
  set({ experimentCounter: n })
  return n
}

export const colorsOf = (entries: CollectionEntry[]) => {
  const out: Record<Color | 'C' | 'M', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0 }
  for (const e of entries) {
    const c = getCard(e.cardId)
    if (!c || isBasic(c)) continue
    if (c.colors.length > 1) out.M += e.qty
    else if (c.colors.length === 0) out.C += e.qty
    else out[c.colors[0]] += e.qty
  }
  return out
}
