import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LayoutGrid, List, Minus, Plus, ScanLine, Search, SlidersHorizontal, Upload, X } from 'lucide-react'
import { DemoBanner } from '../components/DemoBanner'
import type { Card, CollectionEntry, Color, Format, Rarity } from '../lib/types'
import { addToCollection, colorsOf, setEntryQty, useStore } from '../lib/store'
import { getCard, isBasic, price, primaryType, searchCards, SETS } from '../lib/cardDb'
import { collectionStats } from '../lib/insights'
import { FORMAT_LABEL } from '../lib/analysis'
import { CardImage, ManaCost, PageHeader, Pip, Sheet, cx, eur, int, toast } from '../components/ui'

type Sort = 'name' | 'value' | 'price' | 'qty' | 'recent' | 'cmc'
interface Filters {
  colors: (Color | 'C' | 'M')[]
  types: string[]
  rarity: Rarity[]
  cmcMax: number
  priceMin: number
  qtyMin: number
  format: Format | ''
  foil: 'any' | 'foil' | 'nonfoil'
  commander: boolean
  sets: string[]
  since: string
}
const EMPTY: Filters = { colors: [], types: [], rarity: [], cmcMax: 16, priceMin: 0, qtyMin: 1, format: '', foil: 'any', commander: false, sets: [], since: '' }
const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land']
const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic']
const RARITY_DOT: Record<string, string> = { common: '#9a9893', uncommon: '#b8c7d6', rare: '#e7c67f', mythic: '#f0875a', special: '#a78bfa', bonus: '#a78bfa' }

interface Row {
  e: CollectionEntry
  c: Card
}

export default function Collection() {
  const collection = useStore((s) => s.collection)
  const [params] = useSearchParams()
  const [q, setQ] = useState('')
  const [f, setF] = useState<Filters>(EMPTY)
  const [sort, setSort] = useState<Sort>((params.get('sort') as Sort) ?? 'value')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [showFilters, setShowFilters] = useState(false)
  const [adding, setAdding] = useState(false)
  const [limit, setLimit] = useState(60)
  const stats = useMemo(() => collectionStats(collection), [collection])
  const colorDist = useMemo(() => colorsOf(collection), [collection])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out: Row[] = []
    for (const e of collection) {
      const c = getCard(e.cardId)
      if (!c || isBasic(c)) continue
      if (s && !c.name.toLowerCase().includes(s) && !c.typeLine.toLowerCase().includes(s) && !c.setName.toLowerCase().includes(s)) continue
      if (f.colors.length) {
        const key = c.colors.length > 1 ? 'M' : c.colors.length === 0 ? 'C' : c.colors[0]
        if (!f.colors.includes(key) && !(f.colors as string[]).some((x) => c.colors.includes(x as Color))) continue
      }
      if (f.types.length && !f.types.some((t) => c.typeLine.includes(t))) continue
      if (f.rarity.length && !f.rarity.includes(c.rarity)) continue
      if (c.cmc > f.cmcMax) continue
      if (price(c, e.foil) < f.priceMin) continue
      if (e.qty < f.qtyMin) continue
      if (f.format && c.legalities[f.format] !== 'legal') continue
      if (f.foil === 'foil' && !e.foil) continue
      if (f.foil === 'nonfoil' && e.foil) continue
      if (f.commander && c.legalities.commander !== 'legal') continue
      if (f.sets.length && !f.sets.includes(c.set)) continue
      if (f.since && e.acquiredAt < f.since) continue
      out.push({ e, c })
    }
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      name: (a, b) => a.c.name.localeCompare(b.c.name),
      value: (a, b) => price(b.c, b.e.foil) * b.e.qty - price(a.c, a.e.foil) * a.e.qty,
      price: (a, b) => price(b.c, b.e.foil) - price(a.c, a.e.foil),
      qty: (a, b) => b.e.qty - a.e.qty,
      recent: (a, b) => b.e.acquiredAt.localeCompare(a.e.acquiredAt),
      cmc: (a, b) => a.c.cmc - b.c.cmc || a.c.name.localeCompare(b.c.name),
    }
    return out.sort(by[sort])
  }, [collection, q, f, sort])

  const activeCount =
    f.types.length + f.rarity.length + (f.cmcMax < 16 ? 1 : 0) + (f.priceMin ? 1 : 0) + (f.qtyMin > 1 ? 1 : 0) + (f.format ? 1 : 0) + (f.foil !== 'any' ? 1 : 0) + (f.commander ? 1 : 0) + f.sets.length + (f.since ? 1 : 0)
  const toggle = <K extends keyof Filters>(k: K, v: Filters[K] extends (infer U)[] ? U : never) =>
    setF((p) => {
      const arr = p[k] as unknown[]
      return { ...p, [k]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }
    })
  const setsInCollection = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of collection) {
      const c = getCard(e.cardId)
      if (c && !isBasic(c)) m.set(c.set, c.setName)
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [collection])

  const colorTotal = Object.values(colorDist).reduce((a, b) => a + b, 0)

  return (
    <div>
      <PageHeader
        eyebrow="Collection"
        title={
          <>
            <span className="num">{int(stats.total)}</span> <span className="italic text-fg-3">cards</span>
          </>
        }
        subtitle={
          <>
            {int(stats.unique)} unique · worth <span className="text-fg">{eur(stats.value, 0)}</span>
          </>
        }
        action={
          <div className="flex gap-2">
            <Link to="/import" className="btn btn-ghost">
              <Upload size={16} /> Import
            </Link>
            <button className="btn btn-ghost" onClick={() => setAdding(true)}>
              <Plus size={16} /> Add card
            </button>
            <Link to="/scan" className="btn btn-primary">
              <ScanLine size={16} /> Scan
            </Link>
          </div>
        }
      />

      <DemoBanner />
      <div className="grid xl:grid-cols-[1fr_280px] gap-6">
        <div className="min-w-0">
          {/* Search + controls */}
          <div className="sticky top-14 lg:top-0 z-20 -mx-4 px-4 md:mx-0 md:px-0 py-3 bg-ink-950/85 backdrop-blur-xl">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" />
                <input className="input pl-10" placeholder="Search name, type or set…" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && (
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" onClick={() => setQ('')} aria-label="Clear">
                    <X size={16} />
                  </button>
                )}
              </div>
              <button className={cx('btn btn-ghost px-3.5 relative', activeCount && 'border-gold/40 text-gold')} onClick={() => setShowFilters(true)} aria-label="Filters">
                <SlidersHorizontal size={17} />
                <span className="hidden sm:inline">Filters</span>
                {activeCount > 0 && <span className="num text-xs">{activeCount}</span>}
              </button>
              <div className="hidden sm:flex rounded-full border border-white/10 p-1">
                <button onClick={() => setView('grid')} className={cx('w-9 h-9 rounded-full flex items-center justify-center', view === 'grid' && 'bg-white/10')} aria-label="Grid">
                  <LayoutGrid size={16} />
                </button>
                <button onClick={() => setView('list')} className={cx('w-9 h-9 rounded-full flex items-center justify-center', view === 'list' && 'bg-white/10')} aria-label="List">
                  <List size={16} />
                </button>
              </div>
            </div>
            <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar items-center">
              {(['W', 'U', 'B', 'R', 'G', 'C', 'M'] as const).map((c) => (
                <button key={c} className="chip px-2.5" data-on={f.colors.includes(c)} onClick={() => toggle('colors', c)} aria-label={`Filter ${c}`}>
                  {c === 'M' ? <span className="w-4 h-4 rounded-full" style={{ background: 'conic-gradient(#efe6c8,#6aaee8,#a898b8,#eb7a5c,#62c28e,#efe6c8)' }} /> : <Pip c={c} size={16} />}
                </button>
              ))}
              <span className="w-px h-6 bg-white/10 mx-1 shrink-0" />
              <select className="chip bg-transparent pr-2 outline-none cursor-pointer" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                <option value="value">Sort: Total value</option>
                <option value="price">Sort: Price</option>
                <option value="name">Sort: Name</option>
                <option value="qty">Sort: Quantity</option>
                <option value="recent">Sort: Recently added</option>
                <option value="cmc">Sort: Mana value</option>
              </select>
              <span className="text-xs text-fg-3 ml-auto shrink-0 num">{rows.length} results</span>
            </div>
          </div>

          {/* Results */}
          {view === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 gap-x-3 gap-y-5 mt-3">
              {rows.slice(0, limit).map(({ e, c }) => (
                <Link key={c.id + e.foil} to={`/card/${c.id}`} className="group">
                  <CardImage card={c} className="lift group-hover:shadow-xl group-hover:shadow-black/50">
                    <span className="absolute top-2 left-2 num text-xs font-semibold h-6 min-w-6 px-1.5 rounded-full bg-black/75 backdrop-blur flex items-center justify-center border border-white/10">×{e.qty}</span>
                    {e.foil && (
                      <span className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-60" style={{ background: 'linear-gradient(125deg, transparent 20%, rgb(255 180 255/.5) 35%, rgb(140 220 255/.5) 50%, rgb(255 240 150/.5) 65%, transparent 80%)' }} />
                    )}
                  </CardImage>
                  <div className="mt-2 px-0.5">
                    <div className="text-[13px] font-medium truncate">{c.name.split(' // ')[0]}</div>
                    <div className="flex items-center justify-between text-[12px] text-fg-3 gap-2">
                      <span className="truncate flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: RARITY_DOT[c.rarity] }} />
                        {c.set.toUpperCase()}
                        {e.foil && <span className="text-disc">· Foil</span>}
                      </span>
                      <span className="num text-fg-2 shrink-0">{eur(price(c, e.foil))}</span>
                    </div>
                    {e.qty > 1 && <div className="text-[11px] text-fg-3 num">Total {eur(price(c, e.foil) * e.qty)}</div>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="panel mt-3 divide-y divide-white/5 overflow-hidden">
              {rows.slice(0, limit).map(({ e, c }) => (
                <div key={c.id + e.foil} className="flex items-center gap-3 px-3 md:px-4 py-2.5 hover:bg-white/[.02]">
                  <Link to={`/card/${c.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                    <CardImage card={c} small className="w-9 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {c.name.split(' // ')[0]} {e.foil && <span className="text-disc text-xs">Foil</span>}
                      </div>
                      <div className="text-xs text-fg-3 truncate">{c.typeLine}</div>
                    </div>
                  </Link>
                  <span className="hidden md:block">
                    <ManaCost cost={c.manaCost} size={14} />
                  </span>
                  <span className="hidden md:flex items-center gap-1.5 text-xs text-fg-3 w-40 truncate">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: RARITY_DOT[c.rarity] }} />
                    {c.setName}
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-fg-3" onClick={() => setEntryQty(c.id, e.foil, e.qty - 1)} aria-label="Remove one">
                      <Minus size={14} />
                    </button>
                    <span className="num w-6 text-center text-sm">{e.qty}</span>
                    <button className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-fg-3" onClick={() => setEntryQty(c.id, e.foil, e.qty + 1)} aria-label="Add one">
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="text-right w-20 md:w-24 shrink-0">
                    <div className="num text-sm">{eur(price(c, e.foil) * e.qty)}</div>
                    <div className="num text-[11px] text-fg-3">{eur(price(c, e.foil))} ea</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {rows.length > limit && (
            <div className="flex justify-center mt-8">
              <button className="btn btn-ghost" onClick={() => setLimit((l) => l + 60)}>
                Show more ({rows.length - limit})
              </button>
            </div>
          )}
          {rows.length === 0 && <div className="text-center text-fg-3 py-16">No cards match these filters.</div>}
        </div>

        {/* Desktop analysis rail */}
        <aside className="hidden xl:block space-y-4 sticky top-6 self-start">
          <div className="panel p-5">
            <div className="eyebrow mb-4">Colour spread</div>
            <div className="space-y-2.5">
              {(['W', 'U', 'B', 'R', 'G', 'M', 'C'] as const).map((k) => (
                <div key={k} className="flex items-center gap-3 text-sm" title={`${colorDist[k]} cards`}>
                  {k === 'M' ? <span className="w-4 h-4 rounded-full shrink-0" style={{ background: 'conic-gradient(#efe6c8,#6aaee8,#a898b8,#eb7a5c,#62c28e,#efe6c8)' }} /> : <Pip c={k} size={16} />}
                  <div className="flex-1 h-2 rounded-full bg-white/[.05] overflow-hidden">
                    <div className="h-full rounded-full bg-fg-2/70" style={{ width: `${(colorDist[k] / colorTotal) * 100}%` }} />
                  </div>
                  <span className="num text-xs text-fg-3 w-10 text-right">{colorDist[k]}</span>
                </div>
              ))}
            </div>
          </div>
          <TopValue />
        </aside>
      </div>

      {/* Filters sheet */}
      <Sheet open={showFilters} onClose={() => setShowFilters(false)} title="Filters">
        <div className="space-y-6">
          <FilterGroup label="Type">
            {TYPES.map((t) => (
              <button key={t} className="chip" data-on={f.types.includes(t)} onClick={() => toggle('types', t)}>
                {t}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label="Rarity">
            {RARITIES.map((r) => (
              <button key={r} className="chip capitalize" data-on={f.rarity.includes(r)} onClick={() => toggle('rarity', r)}>
                <span className="w-2 h-2 rounded-full" style={{ background: RARITY_DOT[r] }} />
                {r}
              </button>
            ))}
          </FilterGroup>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="eyebrow">Max mana value</span>
              <div className="flex items-center gap-3 mt-2">
                <input type="range" min={0} max={16} value={f.cmcMax} onChange={(e) => setF({ ...f, cmcMax: +e.target.value })} className="flex-1 accent-[#e7c67f]" />
                <span className="num text-sm w-6">{f.cmcMax === 16 ? 'Any' : f.cmcMax}</span>
              </div>
            </label>
            <label className="block">
              <span className="eyebrow">Min price (€)</span>
              <input type="number" min={0} className="input mt-2 h-10" value={f.priceMin || ''} placeholder="0" onChange={(e) => setF({ ...f, priceMin: +e.target.value })} />
            </label>
            <label className="block">
              <span className="eyebrow">Min quantity</span>
              <input type="number" min={1} className="input mt-2 h-10" value={f.qtyMin} onChange={(e) => setF({ ...f, qtyMin: Math.max(1, +e.target.value) })} />
            </label>
            <label className="block">
              <span className="eyebrow">Acquired since</span>
              <input type="date" className="input mt-2 h-10" value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} />
            </label>
          </div>
          <FilterGroup label="Format legality">
            {(['standard', 'pioneer', 'modern', 'legacy', 'pauper'] as Format[]).map((fm) => (
              <button key={fm} className="chip" data-on={f.format === fm} onClick={() => setF({ ...f, format: f.format === fm ? '' : fm })}>
                {FORMAT_LABEL[fm]}
              </button>
            ))}
            <button className="chip" data-on={f.commander} onClick={() => setF({ ...f, commander: !f.commander })}>
              Commander legal
            </button>
          </FilterGroup>
          <FilterGroup label="Finish">
            {(['any', 'nonfoil', 'foil'] as const).map((v) => (
              <button key={v} className="chip capitalize" data-on={f.foil === v} onClick={() => setF({ ...f, foil: v })}>
                {v === 'any' ? 'Any' : v === 'foil' ? 'Foil' : 'Non-foil'}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label="Set">
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {setsInCollection.map(([code, name]) => (
                <button key={code} className="chip" data-on={f.sets.includes(code)} onClick={() => toggle('sets', code)}>
                  {SETS.find((s) => s.code === code) && <img src={SETS.find((s) => s.code === code)!.icon} alt="" className="w-3.5 h-3.5 invert opacity-70" />}
                  {name}
                </button>
              ))}
            </div>
          </FilterGroup>
          <div className="flex gap-3 pt-2">
            <button className="btn btn-ghost flex-1" onClick={() => setF(EMPTY)}>
              Reset
            </button>
            <button className="btn btn-primary flex-1" onClick={() => setShowFilters(false)}>
              Show {rows.length} cards
            </button>
          </div>
        </div>
      </Sheet>

      <AddCardSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2.5">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function TopValue() {
  const collection = useStore((s) => s.collection)
  const top = useMemo(
    () =>
      collection
        .map((e) => ({ e, c: getCard(e.cardId)! }))
        .filter((x) => x.c)
        .sort((a, b) => price(b.c, b.e.foil) - price(a.c, a.e.foil))
        .slice(0, 6),
    [collection],
  )
  return (
    <div className="panel p-5">
      <div className="eyebrow mb-3">Most valuable</div>
      <ul className="space-y-2.5">
        {top.map(({ e, c }) => (
          <li key={c.id + e.foil}>
            <Link to={`/card/${c.id}`} className="flex items-center gap-3 text-sm hover:text-gold">
              <CardImage card={c} small className="w-8 shrink-0" />
              <span className="flex-1 truncate">{c.name.split(' // ')[0]}</span>
              <span className="num text-fg-2">{eur(price(c, e.foil), 0)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AddCardSheet({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Card }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Card | undefined>(initial)
  const [qty, setQty] = useState(1)
  const [foil, setFoil] = useState(false)
  const results = useMemo(() => searchCards(q, 8), [q])
  const close = () => {
    setQ('')
    setSel(initial)
    setQty(1)
    setFoil(false)
    onClose()
  }
  return (
    <Sheet open={open} onClose={close} title="Add a card">
      {!sel ? (
        <>
          <div className="relative">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" />
            <input autoFocus className="input pl-10" placeholder="Card name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="mt-3 space-y-1">
            {results.map((c) => (
              <li key={c.id}>
                <button className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left" onClick={() => setSel(c)}>
                  <CardImage card={c} small className="w-9 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-xs text-fg-3 truncate">
                      {c.setName} · {primaryType(c)}
                    </div>
                  </div>
                  <span className="num text-sm text-fg-2">{eur(price(c))}</span>
                </button>
              </li>
            ))}
            {q && results.length === 0 && <li className="text-sm text-fg-3 p-3">No card with that name in the database.</li>}
          </ul>
          <p className="text-xs text-fg-3 mt-4">Only cards that exist in the card database can be added.</p>
        </>
      ) : (
        <div className="flex gap-5">
          <CardImage card={sel} className="w-32 shrink-0" />
          <div className="flex-1 space-y-4">
            <div>
              <div className="font-semibold">{sel.name}</div>
              <div className="text-sm text-fg-3">{sel.setName}</div>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn btn-ghost w-11 px-0" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less">
                <Minus size={16} />
              </button>
              <span className="num text-xl w-8 text-center">{qty}</span>
              <button className="btn btn-ghost w-11 px-0" onClick={() => setQty(qty + 1)} aria-label="More">
                <Plus size={16} />
              </button>
            </div>
            <div className="flex gap-2">
              <button className="chip" data-on={!foil} onClick={() => setFoil(false)}>
                Non-foil
              </button>
              <button className="chip" data-on={foil} onClick={() => setFoil(true)}>
                Foil
              </button>
            </div>
            <div className="text-sm text-fg-3 num">Value {eur(price(sel, foil) * qty)}</div>
            <div className="flex gap-2">
              {!initial && (
                <button className="btn btn-ghost" onClick={() => setSel(undefined)}>
                  Back
                </button>
              )}
              <button
                className="btn btn-primary flex-1"
                onClick={() => {
                  addToCollection([{ cardId: sel.id, qty, foil }])
                  toast(
                    <>
                      Added {qty}× <b>{sel.name.split(' // ')[0]}</b>
                    </>,
                    { label: 'See what changed', to: '/discover' },
                  )
                  close()
                }}
              >
                Add to collection
              </button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}
