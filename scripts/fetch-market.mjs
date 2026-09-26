// Builds the market snapshot used by "Buy potential" (src/data/market.json) and
// appends today's prices to src/data/price-history.json.
//
// Signals gathered per card (keyed by oracle id):
//   demand  – EDHREC rank (how much the card is played in Commander)
//   supply  – number of paper printings (bucketed), Reserved List, last printing date
//   price   – EUR (Cardmarket) and USD (TCGplayer) for the EU/US gap signal
//   reprint – a printing in a set that hasn't released yet (announced reprint)
// Strategy catalysts: commanders from recent and upcoming sets.
//
// Run: npm run fetch-market   (weekly runs build up the price history)
import { readFile, writeFile } from 'node:fs/promises'
import { api, compact, searchAll } from './scryfall.mjs'

const OUT = new URL('../src/data/', import.meta.url)
const UNIVERSE_PAGES = 8 // 175 cards per page → ~1,400 most-played Commander cards
const RESERVED_TOP = 120
const COMMANDERS_PER_SET = 8
const RECENT_DAYS = 200
const UPCOMING_DAYS = 60
const BASE = 'game:paper -t:basic -is:funny'

const day = (d) => d.toISOString().slice(0, 10)

async function main() {
  const today = day(new Date())
  const core = JSON.parse(await readFile(new URL('cards.json', OUT), 'utf8'))
  const coreOracle = new Set(core.map((c) => c.oracleId))

  // 1. Universe: most-played Commander cards (default printing → reliable prices)
  const universe = await searchAll(`f:commander ${BASE}`, { maxPages: UNIVERSE_PAGES })
  const maxRank = Math.max(...universe.map((c) => c.edhrec_rank ?? 0))
  console.log(`universe: ${universe.length} cards (EDHREC rank ≤ ${maxRank})`)

  // Reserved List: can never be reprinted
  const reserved = await searchAll(`is:reserved f:commander ${BASE}`, { maxPages: 1 })
  const all = new Map()
  for (const c of [...universe, ...reserved.slice(0, RESERVED_TOP)]) all.set(c.oracle_id, c)

  // 2. Supply buckets. Filtered searches are also ordered by EDHREC, so we can stop past the universe.
  const beyond = (c) => (c.edhrec_rank ?? Infinity) > maxRank
  const bucket = new Map()
  for (const [q, n] of [['paperprints<=4', 4], ['paperprints<=2', 2], ['paperprints=1', 1]]) {
    const hits = await searchAll(`f:commander ${BASE} ${q}`, { maxPages: 12, until: beyond })
    for (const c of hits) bucket.set(c.oracle_id, n)
    console.log(`  ${q}: ${hits.length}`)
  }

  // 3. Newest printing → last printed date and announced (unreleased) reprints
  const newest = await searchAll(`f:commander ${BASE}`, { maxPages: UNIVERSE_PAGES, prefer: 'newest' })
  const newestBy = new Map(newest.map((c) => [c.oracle_id, c]))

  // 4. Strategy catalysts: commanders from recent + upcoming sets
  const sets = (await api('/sets')).data
  const horizonStart = day(new Date(Date.now() - RECENT_DAYS * 864e5))
  const horizonEnd = day(new Date(Date.now() + UPCOMING_DAYS * 864e5))
  const catalystSets = sets.filter(
    (s) => ['expansion', 'core', 'commander', 'draft_innovation'].includes(s.set_type) && !s.digital && s.released_at >= horizonStart && s.released_at <= horizonEnd,
  )
  const commanders = []
  for (const s of catalystSets) {
    const hits = await searchAll(`e:${s.code} is:commander game:paper`, { maxPages: 1 })
    for (const c of hits.slice(0, COMMANDERS_PER_SET)) {
      commanders.push({ oracleId: c.oracle_id, set: s.code, setName: s.name, releasedAt: s.released_at, upcoming: s.released_at > today })
      all.set(c.oracle_id, all.get(c.oracle_id) ?? c)
    }
  }
  console.log(`catalyst commanders: ${commanders.length} from ${catalystSets.map((s) => s.code).join(', ')}`)

  // 5. Fill missing EUR prices from the cheapest priced printing
  for (const [oid, c] of all) {
    if (c.prices?.eur) continue
    try {
      const prints = await searchAll(`oracleid:${oid} game:paper -is:promo`, { order: 'eur', maxPages: 1 })
      const priced = prints.find((p) => p.prices?.eur)
      if (priced) all.set(oid, { ...priced, edhrec_rank: c.edhrec_rank })
    } catch {
      /* keep as is */
    }
  }

  // 6. Cardmarket's public daily price guide: trend, low and 1/7/30-day averages per product.
  //    Scryfall gives each printing's Cardmarket product id, so the 30-day trend is available
  //    immediately — no need to wait for our own snapshots to accumulate.
  const guide = new Map()
  try {
    const res = await fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json')
    const json = await res.json()
    for (const g of json.priceGuides) guide.set(g.idProduct, g)
    console.log(`cardmarket price guide: ${guide.size} products (${json.createdAt})`)
  } catch (e) {
    console.warn('cardmarket price guide unavailable:', e.message)
  }

  // 7. Assemble
  const signals = {}
  const marketCards = []
  for (const [oid, c] of all) {
    const nw = newestBy.get(oid)
    const prints = bucket.get(oid) ?? 5 // 5 = five or more (reserved cards beyond the universe fall here too)
    const upcoming = nw && nw.released_at > today && prints > 1 ? { set: nw.set, setName: nw.set_name, date: nw.released_at } : undefined
    const g = c.cardmarket_id ? guide.get(c.cardmarket_id) : undefined
    signals[oid] = {
      edhrec: c.edhrec_rank ?? null,
      prints,
      reserved: !!c.reserved,
      eur: g?.trend || (c.prices?.eur ? Number(c.prices.eur) : null),
      usd: c.prices?.usd ? Number(c.prices.usd) : null,
      lastPrinted: nw && nw.released_at <= today ? nw.released_at : c.released_at,
      ...(g ? { cm: { trend: g.trend, low: g.low, avg1: g.avg1, avg7: g.avg7, avg30: g.avg30 } } : {}),
      ...(c.purchase_uris?.cardmarket ? { cmUrl: c.purchase_uris.cardmarket } : {}),
      ...(upcoming ? { upcomingReprint: upcoming } : {}),
    }
    if (!coreOracle.has(oid)) marketCards.push(compact(c))
  }
  await writeFile(new URL('market.json', OUT), JSON.stringify({ generatedAt: today, cards: marketCards, signals, commanders }))

  // 8. Price history (one column per run)
  const histUrl = new URL('price-history.json', OUT)
  let hist = { dates: [], eur: {} }
  try {
    hist = JSON.parse(await readFile(histUrl, 'utf8'))
  } catch {
    /* first run */
  }
  let col = hist.dates.indexOf(today)
  if (col === -1) {
    hist.dates.push(today)
    col = hist.dates.length - 1
  }
  const priceOf = new Map(Object.entries(signals).map(([oid, s]) => [oid, s.eur]))
  for (const c of core) if (!priceOf.has(c.oracleId)) priceOf.set(c.oracleId, c.prices.eur)
  for (const [oid, eur] of priceOf) {
    const row = hist.eur[oid] ?? []
    while (row.length < hist.dates.length) row.push(null)
    row[col] = eur
    hist.eur[oid] = row
  }
  await writeFile(histUrl, JSON.stringify(hist))
  console.log(`market.json: ${Object.keys(signals).length} signals, ${marketCards.length} extra cards · history: ${hist.dates.length} snapshot(s)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
