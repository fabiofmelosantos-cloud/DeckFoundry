import type { Card } from './types'
import { findCard, getCard } from './cardDb'
import { resolveOnline, type Identifier } from './userCards'

// Collection / deck importers. Everything becomes ImportRow[]; resolution then
// maps rows to real cards — locally first, Scryfall for the rest. Rows that
// Scryfall doesn't recognise are reported, never guessed.

export type Source = 'arena' | 'manabox' | 'moxfield' | 'deckbox' | 'archidekt' | 'tcgplayer' | 'dragonshield' | 'csv' | 'text'

export const SOURCES: { id: Source; label: string; how: string }[] = [
  { id: 'arena', label: 'MTG Arena', how: 'In Arena open a deck and choose Export — it copies the list. Paste it here. Arena itself has no full-collection export; tools that track your Arena collection usually export CSV, which also works here.' },
  { id: 'manabox', label: 'ManaBox', how: 'Collection → ⋯ → Export → CSV.' },
  { id: 'moxfield', label: 'Moxfield', how: 'Collection → More → Export → CSV.' },
  { id: 'deckbox', label: 'Deckbox', how: 'Inventory → Tools → Export → CSV.' },
  { id: 'archidekt', label: 'Archidekt', how: 'Collection → Export → CSV.' },
  { id: 'tcgplayer', label: 'TCGplayer', how: 'App → Collection → Export → CSV.' },
  { id: 'dragonshield', label: 'Dragon Shield', how: 'MTG Card Manager → Export → CSV.' },
  { id: 'text', label: 'Text list', how: 'One card per line: "4 Lightning Bolt", "1x Sol Ring (C21) 263", "*F*" for foil.' },
]

export interface ImportRow {
  qty: number
  name: string
  set?: string
  number?: string
  foil: boolean
  scryfallId?: string
  section?: 'commander' | 'deck' | 'sideboard'
  line: number
}

export interface ParseResult {
  source: Source
  rows: ImportRow[]
  skipped: string[] // lines we couldn't read
  looksLikeDeck: boolean
  hasCommander: boolean
}

// ---- CSV ------------------------------------------------------------------------------
function splitCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').replace(/^sep=.\r?\n/i, '')
  const first = lines.split(/\r?\n/, 1)[0]
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < lines.length; i++) {
    const ch = lines[i]
    if (quoted) {
      if (ch === '"' && lines[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && lines[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

const ALIASES = {
  qty: ['quantity', 'count', 'qty', 'amount', 'copies', 'have'],
  name: ['name', 'card name', 'card', 'cardname', 'card_name', 'simple name'],
  set: ['set code', 'setcode', 'set_code', 'edition code', 'expansion code', 'set', 'edition'],
  number: ['collector number', 'collector_number', 'card number', 'collectornumber', 'number', 'cn', 'collector #'],
  foil: ['foil', 'printing', 'finish', 'is foil', 'foil/non-foil'],
  scryfall: ['scryfall id', 'scryfall_id', 'scryfallid', 'scryfall uuid'],
}

function detectSource(header: string[]): Source {
  const h = header.join('|')
  if (h.includes('manabox')) return 'manabox'
  if (h.includes('folder name')) return 'dragonshield'
  if (h.includes('simple name')) return 'tcgplayer'
  if (h.includes('tradelist count') && h.includes('card number')) return 'deckbox'
  if (h.includes('tradelist count')) return 'moxfield'
  if (h.includes('scryfall')) return 'archidekt'
  return 'csv'
}

function parseCsv(text: string): ParseResult {
  const table = splitCsv(text)
  const header = table[0].map((h) => h.trim().toLowerCase())
  const col = (k: keyof typeof ALIASES) => {
    for (const a of ALIASES[k]) {
      const i = header.indexOf(a)
      if (i !== -1) return i
    }
    return -1
  }
  const ci = { qty: col('qty'), name: col('name'), set: col('set'), number: col('number'), foil: col('foil'), scryfall: col('scryfall') }
  const rows: ImportRow[] = []
  const skipped: string[] = []
  table.slice(1).forEach((r, i) => {
    const name = r[ci.name]?.trim()
    const qty = ci.qty === -1 ? 1 : parseInt(r[ci.qty] ?? '1', 10)
    if (!name || !(qty > 0)) {
      skipped.push(r.join(', '))
      return
    }
    const setVal = ci.set === -1 ? undefined : r[ci.set]?.trim()
    const foilVal = ci.foil === -1 ? '' : (r[ci.foil] ?? '').trim().toLowerCase()
    rows.push({
      qty,
      name,
      // Some exports put the set *name* in the edition column — only use short codes
      set: setVal && /^[a-z0-9]{2,6}$/i.test(setVal) ? setVal.toLowerCase() : undefined,
      number: ci.number === -1 ? undefined : r[ci.number]?.trim() || undefined,
      foil: ['foil', 'true', 'yes', '1', 'etched', 'y'].includes(foilVal),
      scryfallId: ci.scryfall === -1 ? undefined : r[ci.scryfall]?.trim() || undefined,
      line: i + 2,
    })
  })
  return { source: detectSource(header), rows, skipped, looksLikeDeck: false, hasCommander: false }
}

// ---- Text / Arena ---------------------------------------------------------------------------
const LINE = /^(\d+)\s*x?\s+(.+?)(?:\s+[([]([A-Za-z0-9]{2,6})[)\]](?:\s+([\w-]+★?))?)?(\s+\*[FE]\*)?\s*$/

function parseText(text: string): ParseResult {
  const rows: ImportRow[] = []
  const skipped: string[] = []
  let section: ImportRow['section'] = 'deck'
  let arena = false
  let sawSection = false
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) return
    const header = line.toLowerCase().replace(/:$/, '')
    if (['deck', 'main', 'maindeck', 'mainboard'].includes(header)) return void ((section = 'deck'), (sawSection = true))
    if (['sideboard', 'side'].includes(header)) return void ((section = 'sideboard'), (sawSection = true))
    if (['commander', 'companion'].includes(header)) return void ((section = 'commander'), (sawSection = true), (arena = true))
    if (header === 'about' || header.startsWith('name ')) return
    const m = line.match(LINE)
    if (!m) {
      // A bare card name counts as one copy
      if (/^[A-Za-z][\w ,'’\-/!?]+$/.test(line) && findCard(line)) rows.push({ qty: 1, name: line, foil: false, section, line: i + 1 })
      else skipped.push(line)
      return
    }
    if (m[3]) arena = true
    rows.push({ qty: +m[1], name: m[2].trim(), set: m[3]?.toLowerCase(), number: m[4]?.replace('★', ''), foil: !!m[5], section, line: i + 1 })
  })
  const total = rows.reduce((a, r) => a + r.qty, 0)
  return {
    source: arena ? 'arena' : 'text',
    rows,
    skipped,
    looksLikeDeck: sawSection || (total >= 40 && total <= 120 && rows.length <= 100),
    hasCommander: rows.some((r) => r.section === 'commander'),
  }
}

export function parseImport(text: string): ParseResult {
  const firstLine = text.replace(/^﻿/, '').replace(/^sep=.\r?\n/i, '').split(/\r?\n/, 1)[0].toLowerCase()
  const isCsv = /(,|;|\t)/.test(firstLine) && /(name|card)/.test(firstLine) && !LINE.test(firstLine.trim())
  return isCsv ? parseCsv(text) : parseText(text)
}

// ---- Resolution ---------------------------------------------------------------------------
export interface Resolved {
  row: ImportRow
  card: Card | null
  via: 'local' | 'online' | 'missing'
}

/** Local exact printing if we have it, else local by name only when no printing was asked for. */
function localMatch(r: ImportRow): Card | undefined {
  if (r.scryfallId) return getCard(r.scryfallId)
  const byName = findCard(r.name)
  if (!byName) return undefined
  if (r.set && byName.set !== r.set) return undefined // a specific printing was requested
  return byName
}

export function resolveLocal(rows: ImportRow[]): Resolved[] {
  return rows.map((row) => {
    const card = localMatch(row)
    return { row, card: card ?? null, via: card ? 'local' : 'missing' }
  })
}

export async function resolveRemaining(res: Resolved[], onProgress?: (d: number, t: number) => void): Promise<Resolved[]> {
  const todo = res.filter((r) => !r.card)
  if (!todo.length) return res
  const ident = (r: ImportRow): Identifier =>
    r.scryfallId ? { id: r.scryfallId } : r.set && r.number ? { set: r.set, collector_number: r.number } : r.set ? { name: r.name, set: r.set } : { name: r.name }
  // A set/number or id lookup must still return the card that was named — never swap cards
  const sameName = (c: Card | null, r: ImportRow) => {
    if (!c) return false
    const n = r.name.toLowerCase().trim()
    return c.name.toLowerCase() === n || c.name.split(' // ')[0].toLowerCase() === n || !r.name
  }
  const found = new Map<Resolved, Card | null>()
  const first = (await resolveOnline(todo.map((t) => ident(t.row)), onProgress)).map((c, i) => (sameName(c, todo[i].row) ? c : null))
  todo.forEach((t, i) => found.set(t, first[i]))
  // Fallbacks for a wrong number or an unknown set code (Arena's codes don't always match):
  // same name in the requested set, then the name alone
  const stages: ((r: ImportRow) => Identifier | null)[] = [(r) => (r.set && r.number ? { name: r.name, set: r.set } : null), (r) => ({ name: r.name })]
  for (const stage of stages) {
    const retry = todo.filter((t) => !found.get(t) && (t.row.set || t.row.scryfallId)).map((t) => [t, stage(t.row)] as const).filter(([, id]) => id)
    if (!retry.length) continue
    const got = await resolveOnline(retry.map(([, id]) => id!))
    retry.forEach(([t], i) => sameName(got[i], t.row) && found.set(t, got[i]))
  }
  return res.map((r) => (r.card ? r : { ...r, card: found.get(r) ?? null, via: found.get(r) ? 'online' : 'missing' }))
}
