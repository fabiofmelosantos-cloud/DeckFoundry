// Builds the local card database snapshot (src/data/cards.json + sets.json) from Scryfall.
// The app never invents cards: everything it shows must exist in this file.
// Run: npm run fetch-cards
import { writeFile, mkdir } from 'node:fs/promises'
import { DECK_TEMPLATES } from '../src/data/seed/templates.js'
import { CARD_POOL } from '../src/data/seed/pool.js'
import { COMBOS } from '../src/data/seed/templates.js'
import { api, compact } from './scryfall.mjs'

const OUT = new URL('../src/data/', import.meta.url)
const RECENT_SET_COUNT = 8
const CARDS_PER_RECENT_SET = 10

async function main() {
  const names = new Set(CARD_POOL)
  for (const t of DECK_TEMPLATES) for (const [, n] of [...t.spells, ...t.lands]) names.add(n)
  for (const c of COMBOS) c.cards.forEach((n) => names.add(n))

  const list = [...names]
  const cards = new Map()
  const notFound = []
  for (let i = 0; i < list.length; i += 75) {
    const chunk = list.slice(i, i + 75)
    const res = await api('/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
    })
    for (const c of res.data) cards.set(c.name, compact(c))
    for (const nf of res.not_found ?? []) notFound.push(nf.name)
    process.stdout.write(`  resolved ${cards.size}/${list.length}\r`)
  }
  console.log()
  // Some default printings (promos, Secret Lair) carry no price — use the canonical printing instead.
  for (const [name, c] of cards) {
    if (c.prices.eur != null) continue
    try {
      const q = encodeURIComponent(`!"${name}" -is:promo game:paper`)
      const prints = (await api(`/cards/search?q=${q}&unique=prints&order=eur&dir=asc`)).data
      const alt = compact(prints.find((p) => p.prices?.eur || p.prices?.usd) ?? prints[0])
      if (alt.prices.eur != null) cards.set(name, alt)
    } catch (e) {
      console.warn('no price for', name)
    }
  }
  if (notFound.length) {
    console.error('NOT FOUND:', notFound)
    process.exitCode = 1
  }

  // Recent sets for "What did I miss?"
  const today = new Date().toISOString().slice(0, 10)
  const sets = (await api('/sets')).data
    .filter((s) => ['expansion', 'core'].includes(s.set_type) && s.released_at && s.released_at <= today && !s.digital)
    .sort((a, b) => b.released_at.localeCompare(a.released_at))
  const recent = sets.slice(0, RECENT_SET_COUNT)
  for (const s of recent) {
    const q = encodeURIComponent(`e:${s.code} (r:rare or r:mythic) -t:basic game:paper`)
    try {
      const res = await api(`/cards/search?q=${q}&order=edhrec&unique=cards`)
      for (const c of res.data.slice(0, CARDS_PER_RECENT_SET)) if (!cards.has(c.name)) cards.set(c.name, compact(c, { isNew: true }))
    } catch (e) {
      console.warn('skip set', s.code, e.message)
    }
  }

  await mkdir(OUT, { recursive: true })
  await writeFile(new URL('cards.json', OUT), JSON.stringify([...cards.values()]))
  await writeFile(
    new URL('sets.json', OUT),
    JSON.stringify(
      sets.slice(0, 24).map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at, icon: s.icon_svg_uri, cardCount: s.card_count, recent: recent.includes(s) })),
    ),
  )
  console.log(`Wrote ${cards.size} cards, ${recent.length} recent sets.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
