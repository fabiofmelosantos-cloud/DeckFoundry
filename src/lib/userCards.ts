import type { Card, Format } from './types'
import { registerUserCards } from './cardDb'

// Cards resolved from Scryfall at import time (anything outside the bundled database).
// They're kept in IndexedDB — a real collection can mean thousands of cards, far more
// than localStorage holds — and registered into the card database on startup.

const DB = 'deckfoundry'
const STORE = 'cards'
const FORMATS: Format[] = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper']

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadUserCards(): Promise<number> {
  try {
    const db = await open()
    const cards = await new Promise<Card[]>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as Card[])
      req.onerror = () => reject(req.error)
    })
    registerUserCards(cards)
    return cards.length
  } catch {
    return 0 // private mode / storage blocked: the app still works with the bundled database
  }
}

async function saveUserCards(cards: Card[]) {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      for (const c of cards) tx.objectStore(STORE).put(c)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* cards stay registered for this session */
  }
}

// ---- Scryfall -----------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
function compact(c: any): Card {
  const face = c.card_faces?.[0]
  const img = c.image_uris ?? face?.image_uris ?? {}
  const eur = c.prices?.eur ? Number(c.prices.eur) : null
  const usd = c.prices?.usd ? Number(c.prices.usd) : null
  return {
    id: c.id,
    oracleId: c.oracle_id ?? face?.oracle_id,
    name: c.name,
    set: c.set,
    setName: c.set_name,
    collectorNumber: c.collector_number,
    rarity: c.rarity,
    manaCost: c.mana_cost ?? face?.mana_cost ?? '',
    cmc: c.cmc ?? 0,
    colors: c.colors ?? face?.colors ?? [],
    colorIdentity: c.color_identity ?? [],
    typeLine: c.type_line ?? face?.type_line ?? '',
    oracleText: c.oracle_text ?? (c.card_faces ?? []).map((f: any) => f.oracle_text).join('\n//\n'),
    keywords: c.keywords ?? [],
    power: c.power ?? face?.power,
    toughness: c.toughness ?? face?.toughness,
    legalities: Object.fromEntries(FORMATS.map((f) => [f, c.legalities?.[f] ?? 'not_legal'])) as Card['legalities'],
    prices: { eur: eur ?? (usd != null ? Math.round(usd * 0.92 * 100) / 100 : null), eurFoil: c.prices?.eur_foil ? Number(c.prices.eur_foil) : null, estimated: eur == null },
    image: img.normal ?? null,
    imageSmall: img.small ?? null,
    artCrop: img.art_crop ?? null,
    releasedAt: c.released_at,
    edhrecRank: c.edhrec_rank ?? null,
    isNew: false,
  }
}

const norm = (s: string) => s.toLowerCase().trim()
function matches(c: Card, idf: Identifier): boolean {
  if ('id' in idf) return c.id === idf.id
  if ('collector_number' in idf) return c.set === norm(idf.set) && c.collectorNumber === idf.collector_number
  const nameOk = norm(c.name) === norm(idf.name) || norm(c.name.split(' // ')[0]) === norm(idf.name)
  return 'set' in idf ? nameOk && c.set === norm(idf.set) : nameOk
}

export type Identifier = { id: string } | { set: string; collector_number: string } | { name: string; set: string } | { name: string }

/**
 * Resolves identifiers against Scryfall's /cards/collection (75 per request).
 * Returns one entry per input: the card, or null if Scryfall doesn't know it.
 */
export async function resolveOnline(ids: Identifier[], onProgress?: (done: number, total: number) => void): Promise<(Card | null)[]> {
  const out: (Card | null)[] = []
  const fresh: Card[] = []
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75)
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: chunk }),
    })
    if (!res.ok) throw new Error(`Scryfall lookup failed (${res.status}). Try again in a minute.`)
    const json = await res.json()
    const found: Card[] = json.data.map(compact)
    fresh.push(...found)
    for (const idf of chunk) out.push(found.find((c) => matches(c, idf)) ?? null)
    onProgress?.(Math.min(ids.length, i + 75), ids.length)
    await new Promise((r) => setTimeout(r, 120))
  }
  registerUserCards(fresh)
  await saveUserCards(fresh)
  return out
}
