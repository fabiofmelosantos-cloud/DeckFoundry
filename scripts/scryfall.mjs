// Shared Scryfall access + the compact card shape used by src/data/*.json.
const API = 'https://api.scryfall.com'
const HEADERS = { 'User-Agent': 'DeckFoundry/0.1', Accept: 'application/json' }
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper']

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function api(path, init, attempt = 0) {
  // Search is rate-limited harder than other endpoints; stay well under both limits
  await sleep(path.startsWith('/cards/search') ? 550 : 120)
  const res = await fetch(API + path, { ...init, headers: { ...HEADERS, ...(init?.headers ?? {}) } })
  if (res.status === 429 && attempt < 3) {
    console.warn('  rate limited — waiting 65s')
    await sleep(65_000)
    return api(path, init, attempt + 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`)
  return res.json()
}

/** Paginates a card search. `until(card)` returning true stops early. */
export async function searchAll(q, { order = 'edhrec', maxPages = 10, prefer, until } = {}) {
  const out = []
  let url = `/cards/search?q=${encodeURIComponent(q)}&order=${order}${prefer ? `&prefer=${prefer}` : ''}`
  for (let page = 0; url && page < maxPages; page++) {
    let res
    try {
      res = await api(url)
    } catch (e) {
      if (String(e.message).startsWith('404')) break // no results
      throw e
    }
    for (const c of res.data) {
      if (until?.(c)) return out
      out.push(c)
    }
    url = res.has_more ? res.next_page.replace(API, '') : null
  }
  return out
}

export function compact(c, { isNew = false } = {}) {
  const face = c.card_faces?.[0]
  const img = c.image_uris ?? face?.image_uris ?? {}
  const eur = c.prices?.eur ? Number(c.prices.eur) : null
  const usd = c.prices?.usd ? Number(c.prices.usd) : null
  const oracle = c.oracle_text ?? (c.card_faces ?? []).map((f) => f.oracle_text).join('\n//\n')
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
    oracleText: oracle ?? '',
    keywords: c.keywords ?? [],
    power: c.power ?? face?.power,
    toughness: c.toughness ?? face?.toughness,
    legalities: Object.fromEntries(FORMATS.map((f) => [f, c.legalities?.[f] ?? 'not_legal'])),
    prices: {
      eur: eur ?? (usd != null ? Math.round(usd * 0.92 * 100) / 100 : null),
      eurFoil: c.prices?.eur_foil ? Number(c.prices.eur_foil) : null,
      estimated: eur == null,
    },
    image: img.normal ?? null,
    imageSmall: img.small ?? null,
    artCrop: img.art_crop ?? null,
    releasedAt: c.released_at,
    edhrecRank: c.edhrec_rank ?? null,
    isNew,
  }
}
