import type { Card } from '../types'
import { CARDS, displayName, findCard } from '../cardDb'
import { adoptScryfall, scryfallGet } from '../userCards'

// Turns OCR text into a real card. The collector line (set code + number +
// language) pins the exact printing; the title confirms it. Old cards without
// a set code fall back to the name.



// ---- known set codes (so OCR slips like "M1S" can be corrected to "M15") ----------------------
let setCodes: Promise<Set<string>> | null = null
export function knownSets(): Promise<Set<string>> {
  setCodes ??= (async () => {
    try {
      const cached = JSON.parse(localStorage.getItem('deckfoundry:setcodes') ?? 'null') as { at: number; codes: string[] } | null
      if (cached && Date.now() - cached.at < 7 * 864e5) return new Set(cached.codes)
    } catch {
      /* ignore */
    }
    const res = await scryfallGet<{ data: { code: string }[] }>('/sets')
    if (!res) throw new Error('Could not load the set list')
    const codes: string[] = res.data.map((s) => s.code.toUpperCase())
    try {
      localStorage.setItem('deckfoundry:setcodes', JSON.stringify({ at: Date.now(), codes }))
    } catch {
      /* ignore */
    }
    return new Set(codes)
  })()
  return setCodes
}

const LOOKALIKE: Record<string, string[]> = { '0': ['O', 'D'], O: ['0', 'D'], D: ['0', 'O'], '1': ['I', 'L', 'T'], I: ['1', 'L'], L: ['1', 'I'], '5': ['S'], S: ['5'], '8': ['B'], B: ['8'], '2': ['Z'], Z: ['2'], '6': ['G'], G: ['6'], '4': ['A'], A: ['4'] }

/** The nearest valid set code, trying OCR look-alike substitutions. */
function fixSetCode(raw: string, codes: Set<string>): string | null {
  if (codes.has(raw)) return raw
  let frontier = [raw]
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = []
    for (const s of frontier)
      for (let i = 0; i < s.length; i++)
        for (const alt of LOOKALIKE[s[i]] ?? []) {
          const v = s.slice(0, i) + alt + s.slice(i + 1)
          if (codes.has(v)) return v
          next.push(v)
        }
    frontier = next.slice(0, 200)
  }
  return null
}

const PRINTED_LANG: Record<string, string> = { EN: 'en', DE: 'de', FR: 'fr', IT: 'it', ES: 'es', SP: 'es', PT: 'pt', JP: 'ja', JA: 'ja', KR: 'ko', KO: 'ko', RU: 'ru', CS: 'zhs', CT: 'zht', PH: 'ph' }

export interface CollectorInfo {
  set: string
  number: string // best guess
  numbers: string[] // every plausible reading, best first
  lang: string
}

/**
 * Parses the bottom-left collector line. Handles both frames:
 *   "146/269 R" + "M15 • EN"   (2014–2022)
 *   "U 0209"    + "SOC • EN"   (2023+)
 */
export async function parseCollector(text: string): Promise<CollectorInfo | null> {
  const lines = text.toUpperCase().split(/\n+/)
  const t = lines.join(' ')
  const codes = await knownSets()
  // set + language: a 2–5 char code, then a known 2-letter language. The • between
  // them is often read as * . · - or dropped entirely, so the separator is optional.
  const langs = Object.keys(PRINTED_LANG).join('|')
  const m = [...t.matchAll(new RegExp(`\\b([A-Z0-9]{2,5})\\s*[•*.·\\-]?\\s*(${langs})\\b`, 'g'))]
  let set: string | null = null
  let raw = ''
  let lang = 'en'
  for (const x of m) {
    const fixed = fixSetCode(x[1], codes)
    if (fixed) {
      set = fixed
      raw = x[0]
      lang = PRINTED_LANG[x[2]] ?? 'en'
      break
    }
  }
  if (!set) return null
  // Collector number. It sits on the line just above the set code, so that line is
  // searched first; within a line the most specific format wins:
  //   "140/271" (2014–2022) · "R 0260" / "0260 R" (2023+) · a zero-padded run · any 1–4 digits
  const clean = (x: string) => x.replace(raw, ' ').replace(/(?<=\d)[OD]|[OD](?=\d)/g, '0').replace(/(?<=\d)[IL]|[IL](?=\d)/g, '1')
  const at = lines.findIndex((l) => l.includes(raw.trim().slice(0, 3)))
  const ordered = at > 0 ? [lines[at - 1], lines[at], ...lines.filter((_, i) => i !== at && i !== at - 1)] : [t]
  const patterns = [
    /\b0*(\d{1,4})\s*\/\s*\d{2,4}\b/g, // 140/271
    /\b[CURMSTLP]\s*0*(\d{1,4})\b/g, // R 0260 · M0123 (rarity glued on)
    /\b0*(\d{1,4})\s+[CURMSTLP]\b/g, // 0260 R
    /(?<!\d)0+(\d{1,3})(?!\d)/g, // any zero-padded run
    /(?<!\d)(\d{1,4})(?!\d)/g, // anything else
  ]
  const numbers: string[] = []
  for (const line of ordered.map(clean))
    for (const re of patterns)
      for (const x of line.matchAll(re)) {
        const num = String(Number(x[1])) // Scryfall numbers have no leading zeros
        if (num !== '0' && !numbers.includes(num)) numbers.push(num)
      }
  if (!numbers.length) return null
  return { set: set.toLowerCase(), number: numbers[0], numbers: numbers.slice(0, 4), lang }
}

// ---- lookups (cached) -------------------------------------------------------------------------
const byPrinting = new Map<string, Promise<Card | null>>()
const scryfallJson = (path: string) => scryfallGet(path)

/** Exact printing by set + number (+ language when not English). */
export function lookupPrinting(ci: CollectorInfo): Promise<Card | null> {
  const key = `${ci.set}/${ci.number}/${ci.lang}`
  if (!byPrinting.has(key))
    byPrinting.set(
      key,
      (async () => {
        let json = ci.lang !== 'en' ? await scryfallJson(`/cards/${ci.set}/${ci.number}/${ci.lang}`) : null
        json ??= await scryfallJson(`/cards/${ci.set}/${ci.number}`)
        if (!json?.id) return null
        // Keep it like any imported card so the collection can reference it
        const [card] = adoptScryfall([json])
        if (card && json.printed_name) (card as Card & { printedName?: string }).printedName = json.printed_name
        return card
      })(),
    )
  return byPrinting.get(key)!
}

// ---- names ------------------------------------------------------------------------------------------
export const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** 0..1 similarity (Levenshtein ratio). */
export function similarity(a: string, b: string): number {
  a = normalise(a)
  b = normalise(b)
  if (!a || !b) return 0
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

export const nameMatches = (card: Card, ocr: string) =>
  Math.max(similarity(displayName(card), ocr), similarity(card.name, ocr), similarity((card as Card & { printedName?: string }).printedName ?? '', ocr))

// ---- every card name in the game (~33k), fetched once and cached --------------------------------
let namesPromise: Promise<string[]> | null = null
function allNames(): Promise<string[]> {
  namesPromise ??= (async () => {
    try {
      const cached = JSON.parse(localStorage.getItem('deckfoundry:cardnames') ?? 'null') as { at: number; names: string[] } | null
      if (cached && Date.now() - cached.at < 14 * 864e5) return cached.names
    } catch {
      /* ignore */
    }
    const res = await scryfallGet<{ data: string[] }>('/catalog/card-names')
    const names = res?.data ?? []
    try {
      localStorage.setItem('deckfoundry:cardnames', JSON.stringify({ at: Date.now(), names }))
    } catch {
      /* storage full: keep in memory only */
    }
    return names
  })()
  return namesPromise
}

/**
 * Closest real card name to a garbled OCR title. Any correctly read word (4+ letters)
 * narrows the search to names containing it — "BIEHoTY, Lapse" → names with "lapse" →
 * Memory Lapse. Otherwise a length-filtered pass over every name.
 */
async function closestName(ocr: string): Promise<{ name: string; score: number } | null> {
  const names = await allNames()
  if (!names.length) return null
  const target = normalise(ocr)
  const words = target.split(' ').filter((w) => w.length >= 4)
  let pool = words.length ? names.filter((n) => normalise(n).split(' ').some((w) => words.includes(w))) : []
  const fromWords = pool.length > 0 && pool.length <= 60
  if (!fromWords) pool = names.filter((n) => Math.abs(n.length - target.length) <= 3)
  let best: { name: string; score: number } | null = null
  for (const n of pool) {
    const s = similarity(n.split(' // ')[0], target)
    if (!best || s > best.score) best = { name: n, score: s }
  }
  if (!best) return null
  // A shared exact word is strong evidence even when the rest is noise
  if (fromWords) best.score = Math.max(best.score, 0.5 + 0.5 * best.score)
  return best
}

/** Best card for an OCR'd title: local database first, then Scryfall's fuzzy search. */
export async function lookupName(ocr: string): Promise<{ card: Card; score: number } | null> {
  const clean = ocr.replace(/[^\p{L}\p{N} ,'’-]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length < 3) return null
  const exact = findCard(clean)
  if (exact) return { card: exact, score: 1 }
  let best: Card | null = null
  let score = 0
  const target = normalise(clean)
  for (const c of CARDS) {
    const n = normalise(displayName(c))
    if (Math.abs(n.length - target.length) > 6) continue
    const s = similarity(n, target)
    if (s > score) {
      score = s
      best = c
    }
  }
  if (best && score >= 0.8) return { card: best, score }
  const json = await scryfallJson(`/cards/named?fuzzy=${encodeURIComponent(clean)}`)
  if (json?.id) {
    const [card] = adoptScryfall([json])
    return { card, score: Math.max(0.7, similarity(json.name, clean)) }
  }
  // Scryfall's fuzzy search gives up on heavy OCR noise; compare against every real name
  const near = await closestName(clean)
  if (near && near.score >= 0.6 && (!best || near.score > score)) {
    const exact = await scryfallJson(`/cards/named?exact=${encodeURIComponent(near.name)}`)
    if (exact?.id) return { card: adoptScryfall([exact])[0], score: near.score }
  }
  return best && score >= 0.65 ? { card: best, score } : null
}

/** Every printing of a card, for "which edition is this?" when the scan couldn't tell. */
export async function printingsOf(card: Card): Promise<Card[]> {
  const json = await scryfallJson(`/cards/search?q=${encodeURIComponent(`oracleid:${card.oracleId}`)}&unique=prints&order=released`)
  if (!json?.data) return [card]
  return adoptScryfall(json.data.slice(0, 40))
}

// ---- the whole identification ---------------------------------------------------------------------------
export interface ScanResult {
  card: Card
  confidence: number // 0..1
  how: 'collector+name' | 'collector' | 'name'
  exactPrinting: boolean
  collector?: CollectorInfo
}

export async function identify(info: string, title: string): Promise<ScanResult | null> {
  const ci = await parseCollector(info)
  if (ci) {
    // Try each plausible number until the printed name agrees with the title
    let card: Card | null = null
    for (const number of ci.numbers) {
      const c = await lookupPrinting({ ...ci, number })
      if (!c) continue
      if (nameMatches(c, title) >= 0.55) return { card: c, confidence: 0.97, how: 'collector+name', exactPrinting: true, collector: { ...ci, number } }
      card ??= c
    }
    if (card) {
      // The number may have been misread. If the title names a card, look for it in the set we read
      const named = await lookupName(title)
      if (named && named.score >= 0.75) {
        const inSet = await scryfallJson(`/cards/named?exact=${encodeURIComponent(named.card.name)}&set=${ci.set}`)
        if (inSet?.id) return { card: adoptScryfall([inSet])[0], confidence: 0.9, how: 'collector+name', exactPrinting: true, collector: ci }
      }
      // …or trust the title if it clearly names another card
      const byName = await lookupName(title)
      if (byName && byName.score >= 0.85 && byName.card.name !== card.name) return { card: byName.card, confidence: 0.75, how: 'name', exactPrinting: false }
      return { card, confidence: title.length > 3 ? 0.7 : 0.85, how: 'collector', exactPrinting: true, collector: ci }
    }
  }
  const byName = await lookupName(title)
  if (!byName) return null
  return { card: byName.card, confidence: Math.min(0.85, byName.score * 0.9), how: 'name', exactPrinting: false }
}

/** Best match over several readings of the title (used for cards without a collector line). */
export async function identifyByTitles(titles: string[]): Promise<ScanResult | null> {
  let best: { card: Card; score: number } | null = null
  for (const t of titles) {
    const r = await lookupName(t).catch(() => null)
    if (r && (!best || r.score > best.score)) best = r
    if (best && best.score >= 0.92) break
  }
  return best ? { card: best.card, confidence: Math.min(0.85, best.score * 0.9), how: 'name', exactPrinting: false } : null
}
